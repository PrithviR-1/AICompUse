//! Identifiers and static facts for every provider Machi can talk to.
//!
//! Every provider speaks the OpenAI-compatible `/chat/completions` wire format
//! (§0.3, §1.3), so a provider is fully described by its base URL and key.

use serde::{Deserialize, Serialize};
use specta::Type;

/// A provider endpoint. Mixroute is primary and the only one required.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum ProviderId {
    Mixroute,
    OpenAi,
    Anthropic,
    Gemini,
    DeepSeek,
    OpenRouter,
}

impl ProviderId {
    pub const ALL: [ProviderId; 6] = [
        ProviderId::Mixroute,
        ProviderId::OpenAi,
        ProviderId::Anthropic,
        ProviderId::Gemini,
        ProviderId::DeepSeek,
        ProviderId::OpenRouter,
    ];

    /// Stable lowercase slug used in model keys, keychain accounts and the database.
    pub fn slug(self) -> &'static str {
        match self {
            ProviderId::Mixroute => "mixroute",
            ProviderId::OpenAi => "openai",
            ProviderId::Anthropic => "anthropic",
            ProviderId::Gemini => "gemini",
            ProviderId::DeepSeek => "deepseek",
            ProviderId::OpenRouter => "openrouter",
        }
    }

    pub fn from_slug(slug: &str) -> Option<ProviderId> {
        ProviderId::ALL.into_iter().find(|p| p.slug() == slug)
    }

    /// Human-readable name for settings and error messages.
    pub fn display_name(self) -> &'static str {
        match self {
            ProviderId::Mixroute => "Mixroute",
            ProviderId::OpenAi => "OpenAI",
            ProviderId::Anthropic => "Anthropic",
            ProviderId::Gemini => "Google Gemini",
            ProviderId::DeepSeek => "DeepSeek",
            ProviderId::OpenRouter => "OpenRouter",
        }
    }

    /// Default OpenAI-compatible base URL (no trailing slash).
    pub fn default_base_url(self) -> &'static str {
        match self {
            ProviderId::Mixroute => "https://api.mixroute.ai/v1",
            ProviderId::OpenAi => "https://api.openai.com/v1",
            ProviderId::Anthropic => "https://api.anthropic.com/v1",
            ProviderId::Gemini => "https://generativelanguage.googleapis.com/v1beta/openai",
            ProviderId::DeepSeek => "https://api.deepseek.com/v1",
            ProviderId::OpenRouter => "https://openrouter.ai/api/v1",
        }
    }

    /// Environment variable read by the debug-only development fallback (§1.3).
    pub fn env_key_var(self) -> &'static str {
        match self {
            ProviderId::Mixroute => "MIXROUTE_API_KEY",
            ProviderId::OpenAi => "OPENAI_API_KEY",
            ProviderId::Anthropic => "ANTHROPIC_API_KEY",
            ProviderId::Gemini => "GEMINI_API_KEY",
            ProviderId::DeepSeek => "DEEPSEEK_API_KEY",
            ProviderId::OpenRouter => "OPENROUTER_API_KEY",
        }
    }

    /// Environment variable for a base-URL override in the development fallback.
    pub fn env_base_url_var(self) -> Option<&'static str> {
        match self {
            ProviderId::Mixroute => Some("MIXROUTE_BASE_URL"),
            _ => None,
        }
    }

    /// Authenticated endpoint used to verify a key. `/models` rejects bad keys on every
    /// provider except OpenRouter, whose model list is public.
    pub fn key_check_path(self) -> &'static str {
        match self {
            ProviderId::OpenRouter => "key",
            _ => "models",
        }
    }

    /// Extra headers some OpenAI-compatible endpoints need besides `Authorization: Bearer`.
    pub fn extra_headers(self, key: &str) -> Vec<(&'static str, String)> {
        match self {
            // Anthropic's native /v1/models expects x-api-key and a version header; its
            // OpenAI-compatible /v1/chat/completions accepts the bearer token.
            ProviderId::Anthropic => vec![
                ("x-api-key", key.to_string()),
                ("anthropic-version", "2023-06-01".to_string()),
            ],
            _ => Vec::new(),
        }
    }

    /// Where to create a key, shown as plain text in settings and the first-run card.
    pub fn key_hint(self) -> &'static str {
        match self {
            ProviderId::Mixroute => "Create a key in the Mixroute dashboard at mixroute.ai.",
            ProviderId::OpenAi => "Create a key at platform.openai.com.",
            ProviderId::Anthropic => "Create a key at console.anthropic.com.",
            ProviderId::Gemini => "Create a key in Google AI Studio.",
            ProviderId::DeepSeek => "Create a key at platform.deepseek.com.",
            ProviderId::OpenRouter => "Create a key at openrouter.ai.",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slugs_round_trip() {
        for id in ProviderId::ALL {
            assert_eq!(ProviderId::from_slug(id.slug()), Some(id));
        }
        assert_eq!(ProviderId::from_slug("nope"), None);
    }

    #[test]
    fn base_urls_have_no_trailing_slash() {
        for id in ProviderId::ALL {
            assert!(!id.default_base_url().ends_with('/'), "{id:?}");
            assert!(id.default_base_url().starts_with("https://"), "{id:?}");
        }
    }
}
