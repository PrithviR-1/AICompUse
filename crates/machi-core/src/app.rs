//! `MachiCore`: the single object the Tauri crate holds. It owns the store, secrets,
//! provider factory, model directory and chat service, and exposes the operations
//! behind each Tauri command so the app crate stays wiring-only (§1.1).

use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::Serialize;
use specta::Type;

use crate::chat::ChatService;
use crate::directory::{ModelDirectory, ModelList};
use crate::error::{CoreError, CoreResult};
use crate::export::{self, ExportFormat};
use crate::models::Catalog;
use crate::providers::{KeyedProviderFactory, ProviderError, ProviderFactory, ProviderId};
use crate::secrets::{DevEnv, KeySource, SecretStore, SecretString, Secrets};
use crate::store::Store;
use crate::types::{AppSettings, ConversationDetail, ConversationSummary, SearchHit, now_ms};

/// What Settings → Providers shows for one provider. Never contains the key.
#[derive(Debug, Clone, PartialEq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ProviderStatus {
    pub provider: ProviderId,
    pub name: String,
    pub required: bool,
    pub configured: bool,
    pub source: Option<KeySource>,
    pub base_url: String,
    pub default_base_url: String,
    pub key_hint: String,
}

/// Everything the UI needs on startup.
#[derive(Debug, Clone, PartialEq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Bootstrap {
    pub settings: AppSettings,
    pub providers: Vec<ProviderStatus>,
    /// True when Mixroute (the required provider) has a key.
    pub has_required_key: bool,
    pub default_model: String,
}

pub struct MachiCore {
    pub store: Arc<Store>,
    pub secrets: Secrets,
    pub factory: Arc<KeyedProviderFactory>,
    pub directory: Arc<ModelDirectory>,
    pub chat: Arc<ChatService>,
}

impl MachiCore {
    /// Opens the database in `data_dir`, applies migrations and recovers from an
    /// interrupted previous session. `dev` must be `None` in release builds.
    pub fn open(
        data_dir: &Path,
        secret_store: Arc<dyn SecretStore>,
        dev: Option<DevEnv>,
    ) -> CoreResult<Self> {
        let store = Arc::new(Store::open(&data_dir.join("machi.db"))?);
        Self::with_store(store, secret_store, dev)
    }

    pub fn with_store(
        store: Arc<Store>,
        secret_store: Arc<dyn SecretStore>,
        dev: Option<DevEnv>,
    ) -> CoreResult<Self> {
        let catalog = Arc::new(Catalog::embedded().map_err(|e| CoreError::Invalid(e.to_string()))?);
        let previous_launch_at = store.record_launch(now_ms())?;
        let secrets = Secrets::new(secret_store, dev);
        let factory = Arc::new(KeyedProviderFactory::new(secrets.clone(), store.clone()));
        let directory = Arc::new(ModelDirectory::new(
            catalog,
            store.clone(),
            factory.clone(),
            previous_launch_at,
        ));
        let chat = ChatService::new(store.clone(), directory.clone(), factory.clone());
        chat.recover()?;
        Ok(Self {
            store,
            secrets,
            factory,
            directory,
            chat,
        })
    }

    pub fn bootstrap(&self) -> CoreResult<Bootstrap> {
        let providers = self.provider_statuses();
        let has_required_key = providers.iter().any(|p| p.required && p.configured);
        Ok(Bootstrap {
            settings: self.store.load_app_settings()?,
            providers,
            has_required_key,
            default_model: self.directory.catalog().default_chat_model.clone(),
        })
    }

    pub fn provider_status(&self, provider: ProviderId) -> ProviderStatus {
        let key = self.secrets.status(provider);
        ProviderStatus {
            provider,
            name: provider.display_name().to_string(),
            required: provider == ProviderId::Mixroute,
            configured: key.configured,
            source: key.source,
            base_url: self.factory.base_url(provider),
            default_base_url: provider.default_base_url().to_string(),
            key_hint: provider.key_hint().to_string(),
        }
    }

    pub fn provider_statuses(&self) -> Vec<ProviderStatus> {
        ProviderId::ALL
            .into_iter()
            .map(|p| self.provider_status(p))
            .collect()
    }

    /// Checks a key with the provider. `None` tests the stored key.
    pub async fn test_key(&self, provider: ProviderId, key: Option<String>) -> CoreResult<()> {
        let client = match key.map(|k| k.trim().to_string()).filter(|k| !k.is_empty()) {
            Some(k) => self
                .factory
                .provider_with_key(provider, SecretString::new(k))?,
            None => self.factory.provider(provider)?,
        };
        client.verify_key().await?;
        Ok(())
    }

    /// "Test & save": verifies the key, stores it in the keychain, refreshes models.
    pub async fn save_key(&self, provider: ProviderId, key: String) -> CoreResult<ProviderStatus> {
        let key = key.trim().to_string();
        if key.is_empty() {
            return Err(CoreError::Invalid("Paste your API key first.".into()));
        }
        self.test_key(provider, Some(key.clone())).await?;
        self.secrets.save(provider, &key)?;
        self.directory.list(true).await;
        Ok(self.provider_status(provider))
    }

    pub fn delete_key(&self, provider: ProviderId) -> CoreResult<ProviderStatus> {
        self.secrets.delete(provider)?;
        Ok(self.provider_status(provider))
    }

    pub fn save_settings(&self, settings: AppSettings) -> CoreResult<AppSettings> {
        for (slug, url) in &settings.base_urls {
            if ProviderId::from_slug(slug).is_none() {
                return Err(CoreError::Invalid(format!("Unknown provider `{slug}`.")));
            }
            let trimmed = url.trim();
            if !trimmed.is_empty()
                && !(trimmed.starts_with("https://") || trimmed.starts_with("http://"))
            {
                return Err(CoreError::Invalid(
                    "The base URL must start with https:// or http://.".into(),
                ));
            }
        }
        self.store.save_app_settings(&settings)?;
        Ok(settings)
    }

    pub async fn list_models(&self, refresh: bool) -> ModelList {
        self.directory.list(refresh).await
    }

    pub fn list_conversations(&self) -> CoreResult<Vec<ConversationSummary>> {
        Ok(self.store.list_conversations()?)
    }

    pub fn get_conversation(&self, id: &str) -> CoreResult<ConversationDetail> {
        let conversation = self
            .store
            .get_conversation(id)?
            .ok_or(CoreError::NotFound("chat"))?;
        let messages = self.store.list_messages(id)?;
        Ok(ConversationDetail {
            conversation,
            messages,
        })
    }

    pub fn search(&self, query: &str) -> CoreResult<Vec<SearchHit>> {
        Ok(self.store.search_conversations(query, 50)?)
    }

    pub fn export_conversation(
        &self,
        id: &str,
        format: ExportFormat,
        dir: &Path,
    ) -> CoreResult<PathBuf> {
        let detail = self.get_conversation(id)?;
        let now = now_ms();
        let content = match format {
            ExportFormat::Markdown => export::conversation_markdown(&detail, &self.directory),
            ExportFormat::Json => export::all_json(std::slice::from_ref(&detail), now)?,
        };
        export::write_file(dir, &detail.conversation.title, format, &content, now)
    }

    pub fn export_all(&self, format: ExportFormat, dir: &Path) -> CoreResult<PathBuf> {
        let details = export::load_all(&self.store)?;
        let now = now_ms();
        let content = match format {
            ExportFormat::Markdown => export::all_markdown(&details, &self.directory),
            ExportFormat::Json => export::all_json(&details, now)?,
        };
        export::write_file(dir, "Machi chats", format, &content, now)
    }

    /// Settings → Data → "Delete all data": chats, settings, caches and stored keys.
    pub fn delete_all_data(&self) -> CoreResult<()> {
        for summary in self.store.list_conversations()? {
            self.chat.stop_conversation(&summary.id);
        }
        self.store.delete_all()?;
        for provider in ProviderId::ALL {
            if let Err(err) = self.secrets.delete(provider) {
                tracing::warn!(provider = provider.slug(), error = %err, "could not delete key");
            }
        }
        Ok(())
    }
}

impl From<ProviderError> for crate::error::ErrorInfo {
    fn from(err: ProviderError) -> Self {
        crate::error::ErrorInfo::from(&err)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::secrets::MemoryStore;

    fn core(dev: Option<DevEnv>) -> MachiCore {
        let store = Arc::new(Store::open_in_memory().unwrap());
        MachiCore::with_store(store, Arc::new(MemoryStore::default()), dev).unwrap()
    }

    #[test]
    fn bootstrap_reports_missing_required_key() {
        let c = core(None);
        let boot = c.bootstrap().unwrap();
        assert!(!boot.has_required_key);
        assert_eq!(boot.providers.len(), ProviderId::ALL.len());
        assert!(boot.providers[0].required);
        assert_eq!(boot.default_model, "mixroute:gpt-4.1-nano");
    }

    #[test]
    fn dev_key_counts_as_configured() {
        let c = core(Some(DevEnv::from_pairs([("MIXROUTE_API_KEY", "k")])));
        let boot = c.bootstrap().unwrap();
        assert!(boot.has_required_key);
        assert_eq!(boot.providers[0].source, Some(KeySource::Development));
    }

    #[test]
    fn settings_validate_base_urls() {
        let c = core(None);
        let mut s = AppSettings::default();
        s.base_urls.insert("mixroute".into(), "ftp://x".into());
        assert!(c.save_settings(s.clone()).is_err());
        s.base_urls
            .insert("mixroute".into(), "https://proxy.example/v1".into());
        assert!(c.save_settings(s.clone()).is_ok());
        assert_eq!(
            c.provider_status(ProviderId::Mixroute).base_url,
            "https://proxy.example/v1"
        );
        s.base_urls.insert("nope".into(), "https://x".into());
        assert!(c.save_settings(s).is_err());
    }

    #[tokio::test]
    async fn empty_key_is_rejected_before_network() {
        let c = core(None);
        assert!(matches!(
            c.save_key(ProviderId::Mixroute, "  ".into()).await,
            Err(CoreError::Invalid(_))
        ));
    }

    #[test]
    fn delete_all_data_wipes_settings_and_keys() {
        let c = core(None);
        c.secrets.save(ProviderId::OpenAi, "k").unwrap();
        c.save_settings(AppSettings {
            flyout_pinned: true,
            ..AppSettings::default()
        })
        .unwrap();
        c.delete_all_data().unwrap();
        assert!(!c.provider_status(ProviderId::OpenAi).configured);
        assert!(!c.store.load_app_settings().unwrap().flyout_pinned);
    }
}
