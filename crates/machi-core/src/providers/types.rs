//! Provider-neutral request/response types for chat completions.

use crate::types::ReasoningEffort;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChatRole {
    System,
    User,
    Assistant,
}

impl ChatRole {
    pub fn as_str(self) -> &'static str {
        match self {
            ChatRole::System => "system",
            ChatRole::User => "user",
            ChatRole::Assistant => "assistant",
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum ContentPart {
    Text(String),
    /// A `data:` URL (or https URL) for vision models.
    ImageUrl(String),
}

#[derive(Debug, Clone, PartialEq)]
pub struct ChatMessage {
    pub role: ChatRole,
    pub content: Vec<ContentPart>,
}

impl ChatMessage {
    pub fn text(role: ChatRole, text: impl Into<String>) -> Self {
        Self {
            role,
            content: vec![ContentPart::Text(text.into())],
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ChatRequest {
    pub model: String,
    pub messages: Vec<ChatMessage>,
    pub temperature: Option<f32>,
    pub max_tokens: Option<u32>,
    pub reasoning_effort: Option<ReasoningEffort>,
}

impl ChatRequest {
    pub fn new(model: impl Into<String>, messages: Vec<ChatMessage>) -> Self {
        Self {
            model: model.into(),
            messages,
            temperature: None,
            max_tokens: None,
            reasoning_effort: None,
        }
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Usage {
    pub prompt_tokens: u32,
    pub completion_tokens: u32,
}

/// Incremental events emitted while a completion streams.
#[derive(Debug, Clone, PartialEq)]
pub enum StreamEvent {
    /// Visible answer text.
    Delta(String),
    /// Token usage, usually in the final chunk.
    Usage(Usage),
}

/// How a successful stream ended.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StreamOutcome {
    pub finish_reason: Option<String>,
    pub usage: Option<Usage>,
}

/// One model ID reported by a provider's `/models` endpoint.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteModel {
    pub id: String,
    pub owned_by: Option<String>,
    /// `supported_endpoint_types` (e.g. `["openai"]`, `["gemini","openai"]`); may be empty.
    pub endpoint_types: Vec<String>,
}
