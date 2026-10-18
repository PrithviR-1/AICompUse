//! API-key storage (§1.3 `secrets`).
//!
//! Keys live in the OS keychain (macOS Keychain / Windows Credential Manager) through
//! the `keyring` crate. They are never written to files or logs and never sent to the
//! UI: the UI only ever sees a [`KeyStatus`].
//!
//! Debug builds only: when the keychain has no key for a provider, a development
//! fallback reads `MIXROUTE_API_KEY` (and the other providers' variables) from the
//! project's `.env` file, then from the process environment. Release builds compile
//! the fallback out entirely.

use std::collections::HashMap;
use std::fmt;
use std::sync::{Arc, Mutex};

use serde::Serialize;
use specta::Type;

use crate::providers::ProviderId;

/// Keychain service name; matches the bundle identifier.
pub const KEYCHAIN_SERVICE: &str = "com.machi.app";

#[derive(Debug, thiserror::Error)]
pub enum SecretsError {
    #[error("keychain unavailable: {0}")]
    Unavailable(String),
    #[error("keychain operation failed: {0}")]
    Backend(String),
    #[error("the key is empty")]
    Empty,
}

/// An API key. Debug and Display never reveal the value.
#[derive(Clone, PartialEq, Eq)]
pub struct SecretString(String);

impl SecretString {
    pub fn new(value: impl Into<String>) -> Self {
        SecretString(value.into())
    }

    /// Exposes the raw value. Only provider adapters building auth headers call this.
    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for SecretString {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("SecretString(***)")
    }
}

impl fmt::Display for SecretString {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("***")
    }
}

/// Where a provider's key came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum KeySource {
    Keychain,
    /// Debug builds only: the project `.env` file or the process environment.
    Development,
}

/// What the UI is allowed to know about a key.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct KeyStatus {
    pub provider: ProviderId,
    pub configured: bool,
    pub source: Option<KeySource>,
}

/// Backend that stores one secret per account name.
pub trait SecretStore: Send + Sync {
    fn get(&self, account: &str) -> Result<Option<String>, SecretsError>;
    fn set(&self, account: &str, secret: &str) -> Result<(), SecretsError>;
    fn delete(&self, account: &str) -> Result<(), SecretsError>;
}

/// The OS keychain via the `keyring` crate.
pub struct KeychainStore {
    service: String,
}

impl KeychainStore {
    pub fn new(service: impl Into<String>) -> Self {
        Self {
            service: service.into(),
        }
    }

    fn entry(&self, account: &str) -> Result<keyring::Entry, SecretsError> {
        keyring::Entry::new(&self.service, account).map_err(map_keyring_error)
    }
}

fn map_keyring_error(err: keyring::Error) -> SecretsError {
    match err {
        keyring::Error::NoStorageAccess(inner) => SecretsError::Unavailable(inner.to_string()),
        keyring::Error::NoDefaultStore => {
            SecretsError::Unavailable("no credential store on this platform".into())
        }
        other => SecretsError::Backend(other.to_string()),
    }
}

impl SecretStore for KeychainStore {
    fn get(&self, account: &str) -> Result<Option<String>, SecretsError> {
        match self.entry(account)?.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(err) => Err(map_keyring_error(err)),
        }
    }

    fn set(&self, account: &str, secret: &str) -> Result<(), SecretsError> {
        self.entry(account)?
            .set_password(secret)
            .map_err(map_keyring_error)
    }

    fn delete(&self, account: &str) -> Result<(), SecretsError> {
        match self.entry(account)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(err) => Err(map_keyring_error(err)),
        }
    }
}

/// In-memory store for tests and for environments without a keychain.
#[derive(Default)]
pub struct MemoryStore {
    values: Mutex<HashMap<String, String>>,
}

impl SecretStore for MemoryStore {
    fn get(&self, account: &str) -> Result<Option<String>, SecretsError> {
        let values = self
            .values
            .lock()
            .map_err(|_| SecretsError::Backend("lock poisoned".into()))?;
        Ok(values.get(account).cloned())
    }

    fn set(&self, account: &str, secret: &str) -> Result<(), SecretsError> {
        let mut values = self
            .values
            .lock()
            .map_err(|_| SecretsError::Backend("lock poisoned".into()))?;
        values.insert(account.to_string(), secret.to_string());
        Ok(())
    }

    fn delete(&self, account: &str) -> Result<(), SecretsError> {
        let mut values = self
            .values
            .lock()
            .map_err(|_| SecretsError::Backend("lock poisoned".into()))?;
        values.remove(account);
        Ok(())
    }
}

/// Development-only key values (debug builds). Holds variables from `.env` and the
/// process environment; never logged.
#[derive(Default, Clone)]
pub struct DevEnv {
    values: HashMap<String, String>,
}

impl fmt::Debug for DevEnv {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("DevEnv")
            .field("variables", &self.values.len())
            .finish()
    }
}

impl DevEnv {
    /// Builds a development environment from explicit pairs (used by tests).
    pub fn from_pairs<I, K, V>(pairs: I) -> Self
    where
        I: IntoIterator<Item = (K, V)>,
        K: Into<String>,
        V: Into<String>,
    {
        let values = pairs
            .into_iter()
            .map(|(k, v)| (k.into(), v.into()))
            .filter(|(_, v)| !v.trim().is_empty())
            .collect();
        Self { values }
    }

    /// Loads `<project_root>/.env` (if present), then fills gaps from the process
    /// environment. Only compiled into debug builds; release builds never read `.env`.
    #[cfg(debug_assertions)]
    pub fn load(project_root: &std::path::Path) -> Self {
        let mut values = HashMap::new();
        if let Ok(iter) = dotenvy::from_path_iter(project_root.join(".env")) {
            for (key, value) in iter.flatten() {
                values.insert(key, value);
            }
        }
        for id in ProviderId::ALL {
            let mut names = vec![id.env_key_var()];
            names.extend(id.env_base_url_var());
            for name in names {
                if !values.contains_key(name)
                    && let Ok(value) = std::env::var(name)
                {
                    values.insert(name.to_string(), value);
                }
            }
        }
        Self::from_pairs(values)
    }

    pub fn get(&self, name: &str) -> Option<&str> {
        self.values.get(name).map(String::as_str)
    }
}

/// Key access for all providers: keychain first, then the debug-only fallback.
#[derive(Clone)]
pub struct Secrets {
    store: Arc<dyn SecretStore>,
    dev: Option<DevEnv>,
}

impl Secrets {
    /// `dev` must be `None` in release builds; callers pass `DevEnv::load` only under
    /// `cfg(debug_assertions)`.
    pub fn new(store: Arc<dyn SecretStore>, dev: Option<DevEnv>) -> Self {
        Self { store, dev }
    }

    fn account(provider: ProviderId) -> String {
        format!("{}-api-key", provider.slug())
    }

    /// The key for a provider and where it came from, if any.
    pub fn api_key(
        &self,
        provider: ProviderId,
    ) -> Result<Option<(SecretString, KeySource)>, SecretsError> {
        let stored = self.store.get(&Self::account(provider));
        match stored {
            Ok(Some(value)) if !value.trim().is_empty() => {
                return Ok(Some((SecretString::new(value), KeySource::Keychain)));
            }
            Ok(_) => {}
            // A keychain failure must not hide a working development key.
            Err(err) if self.dev.is_none() => return Err(err),
            Err(err) => {
                tracing::warn!(provider = provider.slug(), error = %err, "keychain read failed; using development fallback");
            }
        }
        Ok(self
            .dev
            .as_ref()
            .and_then(|dev| dev.get(provider.env_key_var()))
            .map(|value| (SecretString::new(value), KeySource::Development)))
    }

    /// Base-URL override from the development environment, if any.
    pub fn dev_base_url(&self, provider: ProviderId) -> Option<String> {
        let var = provider.env_base_url_var()?;
        self.dev.as_ref()?.get(var).map(str::to_string)
    }

    pub fn status(&self, provider: ProviderId) -> KeyStatus {
        let found = self.api_key(provider).ok().flatten();
        KeyStatus {
            provider,
            configured: found.is_some(),
            source: found.map(|(_, source)| source),
        }
    }

    pub fn save(&self, provider: ProviderId, key: &str) -> Result<(), SecretsError> {
        let trimmed = key.trim();
        if trimmed.is_empty() {
            return Err(SecretsError::Empty);
        }
        self.store.set(&Self::account(provider), trimmed)
    }

    pub fn delete(&self, provider: ProviderId) -> Result<(), SecretsError> {
        self.store.delete(&Self::account(provider))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn secrets(dev: Option<DevEnv>) -> Secrets {
        Secrets::new(Arc::new(MemoryStore::default()), dev)
    }

    #[test]
    fn secret_string_never_prints_its_value() {
        let key = SecretString::new("sk-live-123");
        assert_eq!(format!("{key}"), "***");
        assert_eq!(format!("{key:?}"), "SecretString(***)");
        assert_eq!(key.expose(), "sk-live-123");
    }

    #[test]
    fn dev_env_debug_does_not_print_values() {
        let dev = DevEnv::from_pairs([("MIXROUTE_API_KEY", "sk-secret")]);
        let printed = format!("{dev:?}");
        assert!(!printed.contains("sk-secret"));
    }

    #[test]
    fn missing_key_reports_not_configured() {
        let s = secrets(None);
        let status = s.status(ProviderId::Mixroute);
        assert!(!status.configured);
        assert_eq!(status.source, None);
    }

    #[test]
    fn keychain_key_wins_over_dev_fallback() {
        let s = secrets(Some(DevEnv::from_pairs([("MIXROUTE_API_KEY", "dev-key")])));
        s.save(ProviderId::Mixroute, "  stored-key \n").unwrap();
        let (key, source) = s.api_key(ProviderId::Mixroute).unwrap().unwrap();
        assert_eq!(key.expose(), "stored-key");
        assert_eq!(source, KeySource::Keychain);
    }

    #[test]
    fn dev_fallback_used_when_keychain_empty() {
        let s = secrets(Some(DevEnv::from_pairs([("MIXROUTE_API_KEY", "dev-key")])));
        let status = s.status(ProviderId::Mixroute);
        assert!(status.configured);
        assert_eq!(status.source, Some(KeySource::Development));
        assert!(!s.status(ProviderId::OpenAi).configured);
    }

    #[test]
    fn blank_dev_values_are_ignored() {
        let s = secrets(Some(DevEnv::from_pairs([("MIXROUTE_API_KEY", "   ")])));
        assert!(!s.status(ProviderId::Mixroute).configured);
    }

    #[test]
    fn empty_key_cannot_be_saved() {
        let s = secrets(None);
        assert!(matches!(
            s.save(ProviderId::Mixroute, "  "),
            Err(SecretsError::Empty)
        ));
    }

    #[test]
    fn delete_removes_stored_key() {
        let s = secrets(None);
        assert!(s.save(ProviderId::OpenRouter, "k").is_ok());
        assert!(s.status(ProviderId::OpenRouter).configured);
        assert!(s.delete(ProviderId::OpenRouter).is_ok());
        assert!(!s.status(ProviderId::OpenRouter).configured);
        // Deleting twice is not an error.
        assert!(s.delete(ProviderId::OpenRouter).is_ok());
    }

    #[test]
    fn dev_base_url_only_for_mixroute() {
        let s = secrets(Some(DevEnv::from_pairs([(
            "MIXROUTE_BASE_URL",
            "http://localhost:9",
        )])));
        assert_eq!(
            s.dev_base_url(ProviderId::Mixroute).as_deref(),
            Some("http://localhost:9")
        );
        assert_eq!(s.dev_base_url(ProviderId::OpenAi), None);
    }

    #[cfg(debug_assertions)]
    #[test]
    fn dev_env_load_reads_dotenv_file() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join(".env"), "OPENROUTER_API_KEY=from-file\n").unwrap();
        let dev = DevEnv::load(dir.path());
        assert_eq!(dev.get("OPENROUTER_API_KEY"), Some("from-file"));
    }
}
