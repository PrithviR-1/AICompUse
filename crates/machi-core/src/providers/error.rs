//! Provider errors and their plain-language projection for the UI (§11.5 errors).

use crate::error::{ErrorInfo, ErrorKind};

use super::ProviderId;

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ProviderError {
    #[error("no API key configured for {0:?}")]
    MissingKey(ProviderId),
    #[error("the provider rejected the API key ({status})")]
    Unauthorized { status: u16 },
    #[error("rate limited")]
    RateLimited { retry_after_ms: Option<u32> },
    #[error("model unavailable: {0}")]
    ModelUnavailable(String),
    #[error("bad request ({status}): {message}")]
    BadRequest { status: u16, message: String },
    #[error("provider error ({status}): {message}")]
    Upstream { status: u16, message: String },
    #[error("network error: {0}")]
    Network(String),
    #[error("could not decode provider response: {0}")]
    Decode(String),
    #[error("cancelled")]
    Cancelled,
}

impl From<&ProviderError> for ErrorInfo {
    fn from(err: &ProviderError) -> Self {
        match err {
            ProviderError::MissingKey(p) => ErrorInfo::new(
                ErrorKind::MissingKey,
                format!("Add your {} API key in Settings to send messages.", p.display_name()),
            ),
            ProviderError::Unauthorized { .. } => ErrorInfo::new(
                ErrorKind::InvalidKey,
                "The provider rejected your API key. Check it in Settings → Providers.",
            ),
            ProviderError::RateLimited { retry_after_ms } => ErrorInfo {
                kind: ErrorKind::RateLimited,
                message: "This model is rate limited right now. Retry in a moment or switch to another model.".into(),
                retry_after_ms: *retry_after_ms,
            },
            ProviderError::ModelUnavailable(_) => ErrorInfo::new(
                ErrorKind::ModelUnavailable,
                "This model isn't available from the provider right now. Try another model.",
            ),
            ProviderError::BadRequest { message, .. } => ErrorInfo::new(
                ErrorKind::BadRequest,
                format!("The provider couldn't process this request: {}", short(message)),
            ),
            ProviderError::Upstream { .. } => ErrorInfo::new(
                ErrorKind::ProviderDown,
                "The provider is having problems. Retry, or switch to another model.",
            ),
            ProviderError::Network(_) => ErrorInfo::new(
                ErrorKind::Network,
                "Machi couldn't reach the provider. Check your internet connection and retry.",
            ),
            ProviderError::Decode(_) => ErrorInfo::new(
                ErrorKind::ProviderDown,
                "The provider sent a response Machi couldn't read. Retry, or switch to another model.",
            ),
            ProviderError::Cancelled => ErrorInfo::new(ErrorKind::Cancelled, "Stopped."),
        }
    }
}

/// Keeps upstream messages short and single-line for inline display.
fn short(message: &str) -> String {
    let single: String = message.split_whitespace().collect::<Vec<_>>().join(" ");
    if single.chars().count() > 160 {
        let cut: String = single.chars().take(157).collect();
        format!("{cut}…")
    } else if single.is_empty() {
        "no details were given.".to_string()
    } else {
        single
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rate_limit_maps_to_rate_limited_with_wait() {
        let info = ErrorInfo::from(&ProviderError::RateLimited {
            retry_after_ms: Some(2000),
        });
        assert_eq!(info.kind, ErrorKind::RateLimited);
        assert_eq!(info.retry_after_ms, Some(2000));
        assert!(info.message.contains("switch"));
    }

    #[test]
    fn long_upstream_messages_are_shortened() {
        let long = "x ".repeat(200);
        let info = ErrorInfo::from(&ProviderError::BadRequest {
            status: 400,
            message: long,
        });
        assert!(info.message.chars().count() < 220);
        assert!(info.message.ends_with('…'));
    }
}
