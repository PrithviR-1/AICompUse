//! Chat export (§11.9 Data, §15.4 row menu): Markdown of the visible branch, or a full
//! JSON dump of every conversation tree. Files are written with unique names.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use specta::Type;

use crate::chat::context::Tree;
use crate::directory::ModelDirectory;
use crate::error::{CoreError, CoreResult};
use crate::store::Store;
use crate::types::{AttachmentKind, ConversationDetail, Millis, Role};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum ExportFormat {
    Markdown,
    Json,
}

impl ExportFormat {
    fn extension(self) -> &'static str {
        match self {
            ExportFormat::Markdown => "md",
            ExportFormat::Json => "json",
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct JsonExport<'a> {
    app: &'static str,
    format_version: u32,
    exported_at: Millis,
    conversations: &'a [ConversationDetail],
}

/// Markdown of the branch currently shown in a conversation.
pub fn conversation_markdown(detail: &ConversationDetail, directory: &ModelDirectory) -> String {
    let tree = Tree::new(&detail.messages);
    let path = detail
        .conversation
        .current_leaf_id
        .as_deref()
        .map(|leaf| tree.path_to(leaf))
        .unwrap_or_default();
    let mut out = format!("# {}\n\n", escape_heading(&detail.conversation.title));
    out.push_str(&format!(
        "_Exported from Machi on {}_\n\n",
        format_date(detail.conversation.updated_at)
    ));
    for message in path {
        let speaker = match message.role {
            Role::User => "You".to_string(),
            Role::Assistant => message
                .model_key
                .as_deref()
                .map(|key| {
                    directory
                        .find(key)
                        .map(|m| m.name)
                        .unwrap_or_else(|| key.to_string())
                })
                .unwrap_or_else(|| "Assistant".to_string()),
        };
        out.push_str(&format!("### {speaker}\n\n"));
        for attachment in &message.attachments {
            let kind = match attachment.kind {
                AttachmentKind::Image => "Image",
                AttachmentKind::Text => "File",
            };
            out.push_str(&format!("_{kind}: {}_\n\n", attachment.name));
        }
        if message.content.trim().is_empty() {
            out.push_str("_(no text)_\n\n");
        } else {
            out.push_str(message.content.trim_end());
            out.push_str("\n\n");
        }
    }
    out
}

pub fn all_markdown(details: &[ConversationDetail], directory: &ModelDirectory) -> String {
    details
        .iter()
        .map(|d| conversation_markdown(d, directory))
        .collect::<Vec<_>>()
        .join("\n---\n\n")
}

pub fn all_json(details: &[ConversationDetail], now: Millis) -> CoreResult<String> {
    serde_json::to_string_pretty(&JsonExport {
        app: "Machi",
        format_version: 1,
        exported_at: now,
        conversations: details,
    })
    .map_err(|e| CoreError::Invalid(format!("Export failed: {e}")))
}

/// Every non-temporary conversation with its full message tree.
pub fn load_all(store: &Store) -> CoreResult<Vec<ConversationDetail>> {
    let mut out = Vec::new();
    for summary in store.list_conversations()? {
        if let Some(conversation) = store.get_conversation(&summary.id)? {
            let messages = store.list_messages(&summary.id)?;
            out.push(ConversationDetail {
                conversation,
                messages,
            });
        }
    }
    Ok(out)
}

/// Writes `content` to `dir/<base> <date>.<ext>`, adding " (2)", " (3)"… if taken.
pub fn write_file(
    dir: &Path,
    base: &str,
    format: ExportFormat,
    content: &str,
    now: Millis,
) -> CoreResult<PathBuf> {
    std::fs::create_dir_all(dir)?;
    let stem = format!("{} {}", sanitize_file_name(base), format_date(now));
    let ext = format.extension();
    let mut path = dir.join(format!("{stem}.{ext}"));
    let mut n = 2;
    while path.exists() {
        path = dir.join(format!("{stem} ({n}).{ext}"));
        n += 1;
    }
    std::fs::write(&path, content)?;
    Ok(path)
}

fn escape_heading(title: &str) -> String {
    title.replace('\n', " ")
}

fn sanitize_file_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| {
            if matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') || c.is_control() {
                ' '
            } else {
                c
            }
        })
        .collect();
    let trimmed = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    let short: String = trimmed.chars().take(60).collect();
    if short.is_empty() {
        "Machi chat".to_string()
    } else {
        short
    }
}

/// `YYYY-MM-DD` (UTC) from epoch milliseconds, without a date library.
pub fn format_date(ms: Millis) -> String {
    let days = ms.div_euclid(86_400_000);
    // Civil-from-days (Howard Hinnant's algorithm).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!("{y:04}-{m:02}-{d:02}")
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use super::*;
    use crate::models::Catalog;
    use crate::providers::mock::MockFactory;
    use crate::types::{ChatSettings, Conversation, Message, MessageStatus, TitleSource};

    fn detail() -> ConversationDetail {
        let msg =
            |id: &str, parent: Option<&str>, role: Role, content: &str, model: Option<&str>| {
                Message {
                    id: id.into(),
                    conversation_id: "c".into(),
                    parent_id: parent.map(str::to_string),
                    role,
                    content: content.into(),
                    model_key: model.map(str::to_string),
                    status: MessageStatus::Complete,
                    error: None,
                    tokens_in: None,
                    tokens_out: None,
                    cost_usd: None,
                    elapsed_ms: None,
                    created_at: 1,
                    attachments: vec![],
                }
            };
        ConversationDetail {
            conversation: Conversation {
                id: "c".into(),
                title: "Trip".into(),
                title_source: TitleSource::User,
                pinned: false,
                temporary: false,
                current_leaf_id: Some("a2".into()),
                compare: None,
                settings: ChatSettings::default(),
                created_at: 0,
                updated_at: 1_760_745_600_000,
            },
            messages: vec![
                msg("u1", None, Role::User, "Plan a trip", None),
                msg(
                    "a1",
                    Some("u1"),
                    Role::Assistant,
                    "Old branch",
                    Some("mixroute:gpt-4.1-nano"),
                ),
                msg(
                    "a2",
                    Some("u1"),
                    Role::Assistant,
                    "Day 1: beach",
                    Some("mixroute:gpt-4.1"),
                ),
            ],
        }
    }

    fn directory() -> ModelDirectory {
        ModelDirectory::new(
            Arc::new(Catalog::embedded().unwrap()),
            Arc::new(Store::open_in_memory().unwrap()),
            Arc::new(MockFactory::default()),
            None,
        )
    }

    #[test]
    fn markdown_follows_the_visible_branch_with_model_names() {
        let md = conversation_markdown(&detail(), &directory());
        assert!(md.starts_with("# Trip\n"));
        assert!(md.contains("### You\n\nPlan a trip"));
        assert!(md.contains("### GPT-4.1\n\nDay 1: beach"));
        assert!(!md.contains("Old branch"));
        assert!(md.contains("2025-10-18"));
    }

    #[test]
    fn json_export_contains_whole_trees() {
        let json = all_json(&[detail()], 5).unwrap();
        let value: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(value["app"], "Machi");
        assert_eq!(
            value["conversations"][0]["messages"]
                .as_array()
                .unwrap()
                .len(),
            3
        );
    }

    #[test]
    fn files_get_unique_safe_names() {
        let dir = tempfile::tempdir().unwrap();
        let a = write_file(dir.path(), "a/b: c?", ExportFormat::Markdown, "x", 0).unwrap();
        let b = write_file(dir.path(), "a/b: c?", ExportFormat::Markdown, "y", 0).unwrap();
        assert_eq!(
            a.file_name().unwrap().to_str().unwrap(),
            "a b c 1970-01-01.md"
        );
        assert_eq!(
            b.file_name().unwrap().to_str().unwrap(),
            "a b c 1970-01-01 (2).md"
        );
    }

    #[test]
    fn dates_format_correctly() {
        assert_eq!(format_date(0), "1970-01-01");
        assert_eq!(format_date(951_782_400_000), "2000-02-29");
        assert_eq!(format_date(1_792_281_600_000), "2026-10-18");
    }
}
