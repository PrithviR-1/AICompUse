//! Model providers (§1.3 `providers`): one OpenAI-compatible adapter configured per
//! provider with a base URL and key, used for both chat and (later) computer use.
//!
//! The chat service talks to providers only through [`ChatProvider`] and obtains them
//! from a [`ProviderFactory`], so tests substitute scripted providers.

mod error;
mod id;
#[cfg(test)]
pub(crate) mod mock;
mod openai_compat;
mod sse;
#[cfg(test)]
pub(crate) mod test_server;
pub mod types;

use std::sync::Arc;

use futures_util::future::BoxFuture;
use tokio_util::sync::CancellationToken;

pub use error::ProviderError;
pub use id::ProviderId;
pub use openai_compat::{OpenAiCompatible, RetryPolicy};
use types::{ChatRequest, RemoteModel, StreamEvent, StreamOutcome};

use crate::secrets::{SecretString, Secrets};
use crate::store::Store;

/// A chat-completions endpoint.
pub trait ChatProvider: Send + Sync {
    fn id(&self) -> ProviderId;

    /// Live model IDs (`GET /models`). Also used to test a key.
    fn list_models(&self) -> BoxFuture<'_, Result<Vec<RemoteModel>, ProviderError>>;

    /// Streams a completion, calling `on_event` for each delta. Returns
    /// `Err(ProviderError::Cancelled)` promptly once `cancel` fires.
    fn stream_chat<'a>(
        &'a self,
        request: &'a ChatRequest,
        on_event: &'a mut (dyn FnMut(StreamEvent) + Send),
        cancel: &'a CancellationToken,
    ) -> BoxFuture<'a, Result<StreamOutcome, ProviderError>>;
}

/// Hands out ready-to-use providers.
pub trait ProviderFactory: Send + Sync {
    /// A provider configured with its current key and base URL.
    fn provider(&self, id: ProviderId) -> Result<Arc<dyn ChatProvider>, ProviderError>;

    /// A provider configured with an explicit key (for "Test" before saving).
    fn provider_with_key(
        &self,
        id: ProviderId,
        key: SecretString,
    ) -> Result<Arc<dyn ChatProvider>, ProviderError>;

    /// Providers whose models should be listed: Mixroute always, others with a key.
    fn reachable(&self) -> Vec<ProviderId>;
}

/// The production factory: keys from [`Secrets`], base URLs from settings.
pub struct KeyedProviderFactory {
    secrets: Secrets,
    store: Arc<Store>,
}

impl KeyedProviderFactory {
    pub fn new(secrets: Secrets, store: Arc<Store>) -> Self {
        Self { secrets, store }
    }

    /// Settings override, then the development override, then the default.
    pub fn base_url(&self, id: ProviderId) -> String {
        let from_settings = self
            .store
            .load_app_settings()
            .ok()
            .and_then(|s| s.base_urls.get(id.slug()).cloned())
            .filter(|u| !u.trim().is_empty());
        from_settings
            .or_else(|| self.secrets.dev_base_url(id))
            .unwrap_or_else(|| id.default_base_url().to_string())
    }
}

impl ProviderFactory for KeyedProviderFactory {
    fn provider(&self, id: ProviderId) -> Result<Arc<dyn ChatProvider>, ProviderError> {
        let key = self
            .secrets
            .api_key(id)
            .map_err(|e| ProviderError::Network(format!("keychain: {e}")))?
            .map(|(key, _)| key)
            .ok_or(ProviderError::MissingKey(id))?;
        self.provider_with_key(id, key)
    }

    fn provider_with_key(
        &self,
        id: ProviderId,
        key: SecretString,
    ) -> Result<Arc<dyn ChatProvider>, ProviderError> {
        Ok(Arc::new(OpenAiCompatible::new(
            id,
            &self.base_url(id),
            key,
        )?))
    }

    fn reachable(&self) -> Vec<ProviderId> {
        ProviderId::ALL
            .into_iter()
            .filter(|&id| id == ProviderId::Mixroute || self.secrets.status(id).configured)
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::secrets::{DevEnv, MemoryStore};
    use crate::types::AppSettings;

    fn factory(dev: Option<DevEnv>) -> KeyedProviderFactory {
        let store = Arc::new(Store::open_in_memory().unwrap());
        KeyedProviderFactory::new(Secrets::new(Arc::new(MemoryStore::default()), dev), store)
    }

    #[test]
    fn missing_key_is_a_typed_error() {
        let f = factory(None);
        assert!(matches!(
            f.provider(ProviderId::Mixroute),
            Err(ProviderError::MissingKey(ProviderId::Mixroute))
        ));
    }

    #[test]
    fn reachable_includes_mixroute_and_keyed_providers() {
        let f = factory(Some(DevEnv::from_pairs([("OPENROUTER_API_KEY", "k")])));
        assert_eq!(
            f.reachable(),
            vec![ProviderId::Mixroute, ProviderId::OpenRouter]
        );
    }

    #[test]
    fn base_url_prefers_settings_then_dev_then_default() {
        let f = factory(Some(DevEnv::from_pairs([(
            "MIXROUTE_BASE_URL",
            "http://dev.local/v1",
        )])));
        assert_eq!(f.base_url(ProviderId::Mixroute), "http://dev.local/v1");
        assert_eq!(f.base_url(ProviderId::OpenAi), "https://api.openai.com/v1");
        let mut settings = AppSettings::default();
        settings
            .base_urls
            .insert("mixroute".into(), "https://proxy.example/v1".into());
        f.store.save_app_settings(&settings).unwrap();
        assert_eq!(f.base_url(ProviderId::Mixroute), "https://proxy.example/v1");
    }
}
