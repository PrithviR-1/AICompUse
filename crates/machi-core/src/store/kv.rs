//! Key-value settings, the live model-ID cache and local telemetry rows.

use rusqlite::{OptionalExtension, params};

use super::{Store, StoreResult, to_json};
use crate::providers::ProviderId;
use crate::types::{AppSettings, Millis};

const APP_SETTINGS_KEY: &str = "app";
const LAST_LAUNCH_KEY: &str = "last_launch_at";

/// One live model ID as last reported by a provider's `/models` endpoint.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CachedModel {
    pub id: String,
    pub owned_by: Option<String>,
    pub first_seen_at: Millis,
}

/// The cached live model list of one provider.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CachedModels {
    pub fetched_at: Millis,
    pub models: Vec<CachedModel>,
}

/// One request's metrics. Never includes message content or keys (§13.3).
#[derive(Debug, Clone, PartialEq)]
pub struct TelemetryRecord {
    pub at: Millis,
    pub kind: &'static str,
    pub model_key: Option<String>,
    pub tokens_in: Option<u32>,
    pub tokens_out: Option<u32>,
    pub cost_usd: Option<f64>,
    pub ms: Option<u32>,
    pub ok: bool,
    pub error_kind: Option<String>,
}

impl Store {
    pub fn get_setting(&self, key: &str) -> StoreResult<Option<String>> {
        let conn = self.conn()?;
        Ok(conn
            .query_row("SELECT value FROM settings WHERE key = ?1", [key], |r| {
                r.get(0)
            })
            .optional()?)
    }

    pub fn set_setting(&self, key: &str, value: &str) -> StoreResult<()> {
        let conn = self.conn()?;
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
        Ok(())
    }

    /// App settings; defaults when none are stored or the stored JSON is unreadable.
    pub fn load_app_settings(&self) -> StoreResult<AppSettings> {
        let raw = self.get_setting(APP_SETTINGS_KEY)?;
        Ok(match raw {
            Some(text) => serde_json::from_str(&text).unwrap_or_else(|err| {
                tracing::warn!(error = %err, "stored settings unreadable; using defaults");
                AppSettings::default()
            }),
            None => AppSettings::default(),
        })
    }

    pub fn save_app_settings(&self, settings: &AppSettings) -> StoreResult<()> {
        self.set_setting(APP_SETTINGS_KEY, &to_json(settings)?)
    }

    /// Records this launch and returns the previous launch time (None on first run).
    pub fn record_launch(&self, now: Millis) -> StoreResult<Option<Millis>> {
        let previous = self
            .get_setting(LAST_LAUNCH_KEY)?
            .and_then(|v| v.parse::<Millis>().ok());
        self.set_setting(LAST_LAUNCH_KEY, &now.to_string())?;
        Ok(previous)
    }

    /// Replaces the cached live model list of a provider, keeping first-seen times.
    pub fn store_model_ids(
        &self,
        provider: ProviderId,
        models: &[(String, Option<String>)],
        now: Millis,
    ) -> StoreResult<()> {
        let mut conn = self.conn()?;
        let tx = conn.transaction()?;
        {
            let mut upsert = tx.prepare(
                "INSERT INTO model_cache (provider, id, owned_by, first_seen_at, last_seen_at)
                 VALUES (?1, ?2, ?3, ?4, ?4)
                 ON CONFLICT(provider, id) DO UPDATE SET owned_by = excluded.owned_by,
                     last_seen_at = excluded.last_seen_at",
            )?;
            for (id, owned_by) in models {
                upsert.execute(params![provider.slug(), id, owned_by, now])?;
            }
        }
        // IDs no longer reported are dropped so hidden models stay hidden.
        tx.execute(
            "DELETE FROM model_cache WHERE provider = ?1 AND last_seen_at < ?2",
            params![provider.slug(), now],
        )?;
        tx.execute(
            "INSERT INTO model_cache_meta (provider, fetched_at) VALUES (?1, ?2)
             ON CONFLICT(provider) DO UPDATE SET fetched_at = excluded.fetched_at",
            params![provider.slug(), now],
        )?;
        tx.commit()?;
        Ok(())
    }

    pub fn cached_model_ids(&self, provider: ProviderId) -> StoreResult<Option<CachedModels>> {
        let conn = self.conn()?;
        let fetched_at: Option<Millis> = conn
            .query_row(
                "SELECT fetched_at FROM model_cache_meta WHERE provider = ?1",
                [provider.slug()],
                |r| r.get(0),
            )
            .optional()?;
        let Some(fetched_at) = fetched_at else {
            return Ok(None);
        };
        let mut stmt = conn.prepare(
            "SELECT id, owned_by, first_seen_at FROM model_cache WHERE provider = ?1 ORDER BY id",
        )?;
        let models = stmt
            .query_map([provider.slug()], |r| {
                Ok(CachedModel {
                    id: r.get(0)?,
                    owned_by: r.get(1)?,
                    first_seen_at: r.get(2)?,
                })
            })?
            .collect::<Result<_, _>>()?;
        Ok(Some(CachedModels { fetched_at, models }))
    }

    pub fn record_telemetry(&self, record: &TelemetryRecord) -> StoreResult<()> {
        let conn = self.conn()?;
        conn.execute(
            "INSERT INTO telemetry (at, kind, model_key, tokens_in, tokens_out, cost_usd, ms, ok, error_kind)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                record.at,
                record.kind,
                record.model_key,
                record.tokens_in,
                record.tokens_out,
                record.cost_usd,
                record.ms,
                record.ok,
                record.error_kind,
            ],
        )?;
        Ok(())
    }

    #[cfg(test)]
    pub(crate) fn telemetry_count(&self) -> StoreResult<i64> {
        let conn = self.conn()?;
        Ok(conn.query_row("SELECT COUNT(*) FROM telemetry", [], |r| r.get(0))?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::Theme;

    #[test]
    fn app_settings_default_then_round_trip() {
        let store = Store::open_in_memory().unwrap();
        assert_eq!(store.load_app_settings().unwrap(), AppSettings::default());
        let s = AppSettings {
            theme: Theme::Light,
            favorites: vec!["mixroute:gpt-4.1".into()],
            ..AppSettings::default()
        };
        store.save_app_settings(&s).unwrap();
        assert_eq!(store.load_app_settings().unwrap(), s);
    }

    #[test]
    fn unreadable_settings_fall_back_to_defaults() {
        let store = Store::open_in_memory().unwrap();
        store.set_setting(APP_SETTINGS_KEY, "{not json").unwrap();
        assert_eq!(store.load_app_settings().unwrap(), AppSettings::default());
    }

    #[test]
    fn record_launch_returns_previous() {
        let store = Store::open_in_memory().unwrap();
        assert_eq!(store.record_launch(100).unwrap(), None);
        assert_eq!(store.record_launch(200).unwrap(), Some(100));
    }

    #[test]
    fn model_cache_keeps_first_seen_and_drops_vanished_ids() {
        let store = Store::open_in_memory().unwrap();
        assert_eq!(store.cached_model_ids(ProviderId::Mixroute).unwrap(), None);
        store
            .store_model_ids(
                ProviderId::Mixroute,
                &[("a".into(), Some("openai".into())), ("b".into(), None)],
                10,
            )
            .unwrap();
        store
            .store_model_ids(
                ProviderId::Mixroute,
                &[("b".into(), None), ("c".into(), None)],
                20,
            )
            .unwrap();
        let cached = store
            .cached_model_ids(ProviderId::Mixroute)
            .unwrap()
            .unwrap();
        assert_eq!(cached.fetched_at, 20);
        let summary: Vec<_> = cached
            .models
            .iter()
            .map(|m| (m.id.as_str(), m.first_seen_at))
            .collect();
        assert_eq!(summary, [("b", 10), ("c", 20)]);
        assert_eq!(store.cached_model_ids(ProviderId::OpenAi).unwrap(), None);
    }

    #[test]
    fn telemetry_rows_are_recorded_and_wiped_by_delete_all() {
        let store = Store::open_in_memory().unwrap();
        store
            .record_telemetry(&TelemetryRecord {
                at: 1,
                kind: "chat",
                model_key: Some("mixroute:gpt-4.1-nano".into()),
                tokens_in: Some(5),
                tokens_out: Some(7),
                cost_usd: None,
                ms: Some(120),
                ok: true,
                error_kind: None,
            })
            .unwrap();
        store.set_setting("x", "y").unwrap();
        assert_eq!(store.telemetry_count().unwrap(), 1);
        store.delete_all().unwrap();
        assert_eq!(store.telemetry_count().unwrap(), 0);
        assert_eq!(store.get_setting("x").unwrap(), None);
    }
}
