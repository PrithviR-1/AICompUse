//! Model directory: fetches live model IDs, caches them in SQLite for 24 h, and merges
//! them with the seeded catalog (§11.4). Falls back to the cache, then to the seeds,
//! when a provider can't be reached, so the picker is never empty.

use std::collections::HashMap;
use std::sync::{Arc, RwLock};

use serde::Serialize;
use specta::Type;

use crate::error::ErrorInfo;
use crate::models::{Catalog, LiveModels, ModelInfo};
use crate::providers::{ProviderError, ProviderFactory, ProviderId};
use crate::store::Store;
use crate::types::{Millis, now_ms};

pub const MODEL_CACHE_TTL_MS: Millis = 24 * 60 * 60 * 1000;

/// The merged model list plus freshness information for the UI.
#[derive(Debug, Clone, PartialEq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ModelList {
    pub models: Vec<ModelInfo>,
    /// When Mixroute's live list was last fetched; `None` = seeds only.
    pub fetched_at: Option<Millis>,
    /// Set when the latest refresh failed (the list shown is cached or seeded).
    pub refresh_error: Option<ErrorInfo>,
}

pub struct ModelDirectory {
    catalog: Arc<Catalog>,
    store: Arc<Store>,
    factory: Arc<dyn ProviderFactory>,
    previous_launch_at: Option<Millis>,
    latest: RwLock<Vec<ModelInfo>>,
}

impl ModelDirectory {
    pub fn new(
        catalog: Arc<Catalog>,
        store: Arc<Store>,
        factory: Arc<dyn ProviderFactory>,
        previous_launch_at: Option<Millis>,
    ) -> Self {
        Self {
            catalog,
            store,
            factory,
            previous_launch_at,
            latest: RwLock::new(Vec::new()),
        }
    }

    pub fn catalog(&self) -> &Catalog {
        &self.catalog
    }

    /// The merged list, refreshing stale (or, with `force`, all) provider caches first.
    pub async fn list(&self, force: bool) -> ModelList {
        let now = now_ms();
        let mut live = LiveModels {
            by_provider: HashMap::new(),
            previous_launch_at: self.previous_launch_at,
        };
        let mut refresh_error = None;
        let reachable = self.factory.reachable();

        for &provider in &reachable {
            let cached = self.store.cached_model_ids(provider).ok().flatten();
            let stale = cached
                .as_ref()
                .is_none_or(|c| now - c.fetched_at > MODEL_CACHE_TTL_MS);
            if force || stale {
                match self.refresh(provider, now).await {
                    Ok(()) => {}
                    Err(ProviderError::MissingKey(_)) => {}
                    Err(err) => {
                        tracing::warn!(provider = provider.slug(), error = %err, "model list refresh failed");
                        if provider == ProviderId::Mixroute || refresh_error.is_none() {
                            refresh_error = Some(ErrorInfo::from(&err));
                        }
                    }
                }
            }
            if let Some(list) = self.store.cached_model_ids(provider).ok().flatten() {
                live.by_provider.insert(provider, list);
            }
        }

        let fetched_at = live
            .by_provider
            .get(&ProviderId::Mixroute)
            .map(|c| c.fetched_at);
        let models = self.catalog.merge(&live, &reachable);
        if let Ok(mut latest) = self.latest.write() {
            latest.clone_from(&models);
        }
        ModelList {
            models,
            fetched_at,
            refresh_error,
        }
    }

    async fn refresh(&self, provider: ProviderId, now: Millis) -> Result<(), ProviderError> {
        let remote = self.factory.provider(provider)?.list_models().await?;
        if let Err(err) = self.store.store_model_ids(provider, &remote, now) {
            tracing::warn!(error = %err, "could not cache model list");
        }
        Ok(())
    }

    /// Metadata for a model key: the latest merged list, else the seeds, else a bare
    /// entry so unknown models still work (with unknown price and capabilities).
    pub fn find(&self, key: &str) -> Option<ModelInfo> {
        let from_latest = self
            .latest
            .read()
            .ok()
            .and_then(|list| list.iter().find(|m| m.key == key).cloned());
        from_latest.or_else(|| self.catalog.lookup(key))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::providers::mock::{MockFactory, ScriptedProvider};

    fn directory(provider: Arc<ScriptedProvider>) -> (ModelDirectory, Arc<Store>) {
        let store = Arc::new(Store::open_in_memory().unwrap());
        let factory = Arc::new(MockFactory::default().with(provider));
        let dir = ModelDirectory::new(
            Arc::new(Catalog::embedded().unwrap()),
            store.clone(),
            factory,
            None,
        );
        (dir, store)
    }

    #[tokio::test]
    async fn fetches_once_then_serves_cache_within_ttl() {
        let provider = Arc::new(
            ScriptedProvider::new(ProviderId::Mixroute).with_models(&["gpt-4.1-nano", "gpt-5"]),
        );
        let (dir, _) = directory(provider.clone());
        let first = dir.list(false).await;
        assert!(first.fetched_at.is_some());
        assert_eq!(first.models.len(), 2);
        assert_eq!(first.refresh_error, None);
        dir.list(false).await;
        assert_eq!(provider.model_calls(), 1, "cached for 24 h");
        dir.list(true).await;
        assert_eq!(provider.model_calls(), 2, "forced refresh");
    }

    #[tokio::test]
    async fn refresh_failure_keeps_cached_list_and_reports_error() {
        let provider =
            Arc::new(ScriptedProvider::new(ProviderId::Mixroute).with_models(&["gpt-5"]));
        let (dir, _) = directory(provider.clone());
        dir.list(false).await;
        provider.set_models_result(Err(ProviderError::Network("offline".into())));
        let list = dir.list(true).await;
        assert_eq!(
            list.models
                .iter()
                .map(|m| m.id.as_str())
                .collect::<Vec<_>>(),
            ["gpt-5"]
        );
        assert_eq!(
            list.refresh_error.map(|e| e.kind),
            Some(crate::error::ErrorKind::Network)
        );
    }

    #[tokio::test]
    async fn no_key_and_no_cache_falls_back_to_seeds() {
        let store = Arc::new(Store::open_in_memory().unwrap());
        let dir = ModelDirectory::new(
            Arc::new(Catalog::embedded().unwrap()),
            store,
            Arc::new(MockFactory::default()),
            None,
        );
        let list = dir.list(false).await;
        assert_eq!(list.fetched_at, None);
        assert_eq!(
            list.refresh_error, None,
            "a missing key is not a refresh error"
        );
        assert!(list.models.iter().any(|m| m.id == "gpt-4.1-nano"));
        assert!(dir.find("mixroute:gpt-5").is_some());
    }
}
