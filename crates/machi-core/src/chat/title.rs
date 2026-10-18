//! Chat titles: a provisional title from the first message, then a short generated one
//! from the cheap title model after the first exchange (§11.3 header title).

use std::time::Duration;

use tokio_util::sync::CancellationToken;

use crate::models::parse_model_key;
use crate::providers::ProviderFactory;
use crate::providers::types::{ChatMessage, ChatRequest, ChatRole, StreamEvent};
use crate::types::NewAttachment;

const MAX_TITLE_CHARS: usize = 60;
const TITLE_TIMEOUT: Duration = Duration::from_secs(45);

/// The first line of the message, shortened at a word boundary.
pub fn provisional(content: &str, attachments: &[NewAttachment]) -> String {
    let line = content
        .lines()
        .map(str::trim)
        .find(|l| !l.is_empty())
        .unwrap_or("");
    if line.is_empty() {
        return attachments
            .first()
            .map(|a| a.name.clone())
            .unwrap_or_else(|| "New chat".to_string());
    }
    shorten(line, MAX_TITLE_CHARS)
}

fn shorten(text: &str, max: usize) -> String {
    let collapsed = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed.chars().count() <= max {
        return collapsed;
    }
    let cut: String = collapsed.chars().take(max).collect();
    let at_word = match cut.rfind(' ') {
        Some(i) if i > max / 2 => &cut[..i],
        _ => cut.as_str(),
    };
    format!("{}…", at_word.trim_end_matches([',', '.', ';', ':', ' ']))
}

/// Normalizes a model-written title: one line, no quotes or trailing punctuation.
pub fn clean(raw: &str) -> Option<String> {
    let line = raw.lines().map(str::trim).find(|l| !l.is_empty())?;
    let line = line.trim_start_matches(|c: char| c == '#' || c.is_whitespace());
    let line = line.strip_prefix("Title:").unwrap_or(line).trim();
    let line =
        line.trim_matches(|c: char| matches!(c, '"' | '\'' | '“' | '”' | '‘' | '’' | '*' | '`'));
    let line = line.trim_end_matches(['.', '!', '?', ':', ';']).trim();
    (!line.is_empty()).then(|| shorten(line, MAX_TITLE_CHARS))
}

/// Asks the title model for a title. Returns `None` on any failure (the provisional
/// title simply stays).
pub async fn generate(
    factory: &dyn ProviderFactory,
    title_model: &str,
    first_message: &str,
) -> Option<String> {
    let (provider_id, model_id) = parse_model_key(title_model)?;
    let provider = factory.provider(provider_id).ok()?;
    let excerpt: String = first_message.chars().take(1500).collect();
    let mut request = ChatRequest::new(
        model_id,
        vec![
            ChatMessage::text(
                ChatRole::System,
                "You write short, specific titles for chat conversations. Reply with the title only: at most six words, sentence case, no quotes, no final punctuation.",
            ),
            ChatMessage::text(
                ChatRole::User,
                format!("Conversation's first message:\n\n{excerpt}"),
            ),
        ],
    );
    request.max_tokens = Some(24);
    request.temperature = Some(0.2);

    let mut text = String::new();
    let cancel = CancellationToken::new();
    let mut on_event = |e: StreamEvent| {
        if let StreamEvent::Delta(d) = e {
            text.push_str(&d);
        }
    };
    let result = tokio::time::timeout(
        TITLE_TIMEOUT,
        provider.stream_chat(&request, &mut on_event, &cancel),
    )
    .await;
    match result {
        Ok(Ok(_)) => clean(&text),
        Ok(Err(err)) => {
            tracing::info!(error = %err, "title generation failed");
            None
        }
        Err(_) => {
            cancel.cancel();
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::AttachmentKind;

    #[test]
    fn provisional_uses_first_non_empty_line_and_shortens_at_words() {
        assert_eq!(provisional("\n  Hello there \nsecond", &[]), "Hello there");
        let long =
            "Explain the difference between ownership and borrowing in Rust with examples please";
        let title = provisional(long, &[]);
        assert!(title.ends_with('…'));
        assert!(title.chars().count() <= MAX_TITLE_CHARS + 1);
        assert!(!title.contains("  "));
    }

    #[test]
    fn provisional_falls_back_to_attachment_name() {
        let a = NewAttachment {
            kind: AttachmentKind::Image,
            name: "diagram.png".into(),
            mime: "image/png".into(),
            size: 1,
            data: "data:image/png;base64,AA".into(),
        };
        assert_eq!(provisional("   ", &[a]), "diagram.png");
        assert_eq!(provisional("", &[]), "New chat");
    }

    #[test]
    fn clean_strips_quotes_prefixes_and_punctuation() {
        assert_eq!(
            clean("\"Rust ownership basics.\"").as_deref(),
            Some("Rust ownership basics")
        );
        assert_eq!(
            clean("Title: Trip planning\nextra").as_deref(),
            Some("Trip planning")
        );
        assert_eq!(
            clean("## **Bread recipe**").as_deref(),
            Some("Bread recipe")
        );
        assert_eq!(clean("   \n "), None);
    }
}
