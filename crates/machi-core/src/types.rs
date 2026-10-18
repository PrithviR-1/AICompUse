//! Domain types shared by the store, the chat service and the UI bindings.
//!
//! Every type here is serialized with camelCase field names and exported to
//! TypeScript by tauri-specta, so the front end never hand-writes duplicates (§1.1).

use std::collections::BTreeMap;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use specta::Type;

use crate::error::ErrorInfo;

/// Milliseconds since the Unix epoch.
pub type Millis = i64;

pub fn now_ms() -> Millis {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| i64::try_from(d.as_millis()).unwrap_or(i64::MAX))
        .unwrap_or(0)
}

pub fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum Role {
    User,
    Assistant,
}

impl Role {
    pub fn as_str(self) -> &'static str {
        match self {
            Role::User => "user",
            Role::Assistant => "assistant",
        }
    }

    pub fn parse(value: &str) -> Option<Role> {
        match value {
            "user" => Some(Role::User),
            "assistant" => Some(Role::Assistant),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum MessageStatus {
    Complete,
    Streaming,
    Stopped,
    Error,
}

impl MessageStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            MessageStatus::Complete => "complete",
            MessageStatus::Streaming => "streaming",
            MessageStatus::Stopped => "stopped",
            MessageStatus::Error => "error",
        }
    }

    pub fn parse(value: &str) -> Option<MessageStatus> {
        match value {
            "complete" => Some(MessageStatus::Complete),
            "streaming" => Some(MessageStatus::Streaming),
            "stopped" => Some(MessageStatus::Stopped),
            "error" => Some(MessageStatus::Error),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum AttachmentKind {
    /// Stored as a `data:` URL; sent to vision models as an image part.
    Image,
    /// UTF-8 text file content; inlined into the prompt.
    Text,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Attachment {
    pub id: String,
    pub kind: AttachmentKind,
    pub name: String,
    pub mime: String,
    pub size: u32,
    pub data: String,
}

/// An attachment as submitted by the UI (the store assigns the id).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct NewAttachment {
    pub kind: AttachmentKind,
    pub name: String,
    pub mime: String,
    pub size: u32,
    pub data: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    pub id: String,
    pub conversation_id: String,
    pub parent_id: Option<String>,
    pub role: Role,
    pub content: String,
    /// The model that produced an assistant message (`provider:modelId`).
    pub model_key: Option<String>,
    pub status: MessageStatus,
    pub error: Option<ErrorInfo>,
    pub tokens_in: Option<u32>,
    pub tokens_out: Option<u32>,
    pub cost_usd: Option<f64>,
    pub elapsed_ms: Option<u32>,
    pub created_at: Millis,
    pub attachments: Vec<Attachment>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum ReasoningEffort {
    Low,
    Medium,
    High,
}

impl ReasoningEffort {
    pub fn as_str(self) -> &'static str {
        match self {
            ReasoningEffort::Low => "low",
            ReasoningEffort::Medium => "medium",
            ReasoningEffort::High => "high",
        }
    }
}

/// Per-chat generation settings (the composer's sliders popover, §15.7).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", default)]
pub struct ChatSettings {
    pub system_prompt: Option<String>,
    pub temperature: Option<f32>,
    pub max_tokens: Option<u32>,
    pub reasoning_effort: Option<ReasoningEffort>,
}

impl ChatSettings {
    /// Clamps values to ranges every provider accepts.
    pub fn sanitized(mut self) -> Self {
        self.temperature = self.temperature.map(|t| t.clamp(0.0, 2.0));
        self.max_tokens = self.max_tokens.map(|m| m.clamp(1, 200_000));
        self.system_prompt = self
            .system_prompt
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        self
    }
}

/// One column of compare mode (§11.7): a model and the leaf of its branch.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CompareColumn {
    pub model_key: String,
    pub leaf_id: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum TitleSource {
    /// Truncated first message, replaced by a generated title.
    Auto,
    /// Generated by a model after the first exchange.
    Generated,
    /// Renamed by the user; never overwritten.
    User,
}

impl TitleSource {
    pub fn as_str(self) -> &'static str {
        match self {
            TitleSource::Auto => "auto",
            TitleSource::Generated => "generated",
            TitleSource::User => "user",
        }
    }

    pub fn parse(value: &str) -> Option<TitleSource> {
        match value {
            "auto" => Some(TitleSource::Auto),
            "generated" => Some(TitleSource::Generated),
            "user" => Some(TitleSource::User),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Conversation {
    pub id: String,
    pub title: String,
    pub title_source: TitleSource,
    pub pinned: bool,
    /// Temporary chats are hidden from history and deleted on the next launch.
    pub temporary: bool,
    pub current_leaf_id: Option<String>,
    pub compare: Option<Vec<CompareColumn>>,
    pub settings: ChatSettings,
    pub created_at: Millis,
    pub updated_at: Millis,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ConversationSummary {
    pub id: String,
    pub title: String,
    pub pinned: bool,
    pub created_at: Millis,
    pub updated_at: Millis,
}

/// A conversation with its whole message tree; the UI derives the visible branch.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ConversationDetail {
    pub conversation: Conversation,
    pub messages: Vec<Message>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub conversation_id: String,
    pub title: String,
    /// Short excerpt around the first match (title or message content).
    pub snippet: String,
    pub updated_at: Millis,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum Theme {
    System,
    Light,
    Dark,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum FontSize {
    Small,
    Default,
    Large,
}

/// App-wide preferences, persisted as one JSON document (§11.9, §15.0 item 12).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", default)]
pub struct AppSettings {
    pub theme: Theme,
    pub font_size: FontSize,
    /// Model used for new chats (`provider:modelId`).
    pub default_model: String,
    /// Most recently used models, newest first (home chips).
    pub recent_models: Vec<String>,
    /// Favorite models in the user's order.
    pub favorites: Vec<String>,
    /// Models hidden from the picker and the Models page.
    pub hidden_models: Vec<String>,
    pub flyout_pinned: bool,
    /// Base-URL overrides keyed by provider slug.
    pub base_urls: BTreeMap<String, String>,
    /// Generate chat titles with a cheap model after the first exchange.
    pub auto_title: bool,
}

pub const DEFAULT_CHAT_MODEL: &str = "mixroute:gpt-4.1-nano";

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            theme: Theme::System,
            font_size: FontSize::Default,
            default_model: DEFAULT_CHAT_MODEL.to_string(),
            recent_models: Vec::new(),
            favorites: Vec::new(),
            hidden_models: Vec::new(),
            flyout_pinned: false,
            base_urls: BTreeMap::new(),
            auto_title: true,
        }
    }
}

impl AppSettings {
    /// Moves a model to the front of the recent list (max 8 entries).
    pub fn note_recent(&mut self, model_key: &str) {
        self.recent_models.retain(|m| m != model_key);
        self.recent_models.insert(0, model_key.to_string());
        self.recent_models.truncate(8);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn enums_round_trip_through_strings() {
        for r in [Role::User, Role::Assistant] {
            assert_eq!(Role::parse(r.as_str()), Some(r));
        }
        for s in [
            MessageStatus::Complete,
            MessageStatus::Streaming,
            MessageStatus::Stopped,
            MessageStatus::Error,
        ] {
            assert_eq!(MessageStatus::parse(s.as_str()), Some(s));
        }
        for t in [TitleSource::Auto, TitleSource::Generated, TitleSource::User] {
            assert_eq!(TitleSource::parse(t.as_str()), Some(t));
        }
    }

    #[test]
    fn chat_settings_are_clamped() {
        let s = ChatSettings {
            system_prompt: Some("   ".into()),
            temperature: Some(9.0),
            max_tokens: Some(0),
            reasoning_effort: None,
        }
        .sanitized();
        assert_eq!(s.system_prompt, None);
        assert_eq!(s.temperature, Some(2.0));
        assert_eq!(s.max_tokens, Some(1));
    }

    #[test]
    fn recent_models_are_deduplicated_and_capped() {
        let mut s = AppSettings::default();
        for i in 0..10 {
            s.note_recent(&format!("m{i}"));
        }
        s.note_recent("m5");
        assert_eq!(s.recent_models.len(), 8);
        assert_eq!(s.recent_models[0], "m5");
        assert_eq!(s.recent_models.iter().filter(|m| *m == "m5").count(), 1);
    }

    #[test]
    fn settings_tolerate_missing_fields() {
        let s: AppSettings = serde_json::from_str(r#"{"theme":"dark"}"#).unwrap();
        assert_eq!(s.theme, Theme::Dark);
        assert_eq!(s.default_model, DEFAULT_CHAT_MODEL);
        assert!(s.auto_title);
    }
}
