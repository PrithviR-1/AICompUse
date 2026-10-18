//! Error types shared across machi-core and the serializable error shape sent to the UI.
//!
//! Internal errors keep full detail for logs (never including secrets or message
//! content); `ErrorInfo` is the plain-language projection the UI renders inline (§11.5).

use serde::{Deserialize, Serialize};
use specta::Type;

use crate::providers::ProviderError;
use crate::secrets::SecretsError;
use crate::store::StoreError;

/// Top-level error for core operations.
#[derive(Debug, thiserror::Error)]
pub enum CoreError {
    #[error(transparent)]
    Store(#[from] StoreError),
    #[error(transparent)]
    Secrets(#[from] SecretsError),
    #[error(transparent)]
    Provider(#[from] ProviderError),
    #[error("{0}")]
    Invalid(String),
    #[error("{0} not found")]
    NotFound(&'static str),
    #[error("file error: {0}")]
    Io(#[from] std::io::Error),
}

pub type CoreResult<T> = Result<T, CoreError>;

/// Error categories the UI distinguishes (inline card copy, retry and "switch model").
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum ErrorKind {
    MissingKey,
    InvalidKey,
    RateLimited,
    ProviderDown,
    Network,
    BadRequest,
    ModelUnavailable,
    Cancelled,
    NotFound,
    Invalid,
    Storage,
    Keychain,
    Internal,
}

/// Serializable error shown to the user: a category plus a plain-language sentence.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ErrorInfo {
    pub kind: ErrorKind,
    pub message: String,
    /// Suggested wait before retrying, when the provider sent one.
    pub retry_after_ms: Option<u32>,
}

impl ErrorInfo {
    pub fn new(kind: ErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
            retry_after_ms: None,
        }
    }
}

impl From<&CoreError> for ErrorInfo {
    fn from(err: &CoreError) -> Self {
        match err {
            CoreError::Provider(p) => ErrorInfo::from(p),
            CoreError::Store(_) => ErrorInfo::new(
                ErrorKind::Storage,
                "Machi couldn't read or write its local database.",
            ),
            CoreError::Secrets(_) => ErrorInfo::new(
                ErrorKind::Keychain,
                "Machi couldn't access the system keychain.",
            ),
            CoreError::Invalid(msg) => ErrorInfo::new(ErrorKind::Invalid, msg.clone()),
            CoreError::NotFound(what) => ErrorInfo::new(
                ErrorKind::NotFound,
                format!("That {what} no longer exists."),
            ),
            CoreError::Io(_) => {
                ErrorInfo::new(ErrorKind::Internal, "Machi couldn't write the file.")
            }
        }
    }
}

impl From<CoreError> for ErrorInfo {
    fn from(err: CoreError) -> Self {
        ErrorInfo::from(&err)
    }
}
