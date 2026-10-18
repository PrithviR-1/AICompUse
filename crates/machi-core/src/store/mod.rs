//! Local SQLite store (§1.3 `store`): conversations, message trees, attachments,
//! settings, the model-ID cache and local telemetry.
//!
//! One connection guarded by a mutex; every operation is a short transaction, so
//! the lock is never held across an await point. The database file lives in the
//! OS app-data directory (chosen by the Tauri crate).

mod conversations;
mod kv;
mod messages;

use std::path::Path;
use std::sync::{Mutex, MutexGuard};

use rusqlite::Connection;

pub use kv::{CachedModel, CachedModels, TelemetryRecord};
pub use messages::MessageCompletion;

#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    #[error("database error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("stored data is invalid: {0}")]
    Corrupt(String),
    #[error("database lock poisoned")]
    Poisoned,
}

pub type StoreResult<T> = Result<T, StoreError>;

/// Ordered schema migrations; index + 1 is the resulting `user_version`.
const MIGRATIONS: &[&str] = &[
    include_str!("migrations/0001_init.sql"),
    include_str!("migrations/0002_model_endpoints.sql"),
];

pub struct Store {
    conn: Mutex<Connection>,
}

impl Store {
    /// Opens (creating if needed) the database file and applies pending migrations.
    pub fn open(path: &Path) -> StoreResult<Self> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)
                .map_err(|e| StoreError::Corrupt(format!("cannot create data directory: {e}")))?;
        }
        Self::init(Connection::open(path)?)
    }

    /// An in-memory database for tests.
    pub fn open_in_memory() -> StoreResult<Self> {
        Self::init(Connection::open_in_memory()?)
    }

    fn init(mut conn: Connection) -> StoreResult<Self> {
        conn.pragma_update(None, "foreign_keys", "ON")?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        migrate(&mut conn)?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    fn conn(&self) -> StoreResult<MutexGuard<'_, Connection>> {
        self.conn.lock().map_err(|_| StoreError::Poisoned)
    }

    /// Current schema version (number of applied migrations).
    pub fn schema_version(&self) -> StoreResult<u32> {
        let conn = self.conn()?;
        Ok(conn.query_row("PRAGMA user_version", [], |r| r.get(0))?)
    }

    /// Deletes every conversation, setting, cached model and metric (Settings → Data).
    pub fn delete_all(&self) -> StoreResult<()> {
        let mut conn = self.conn()?;
        let tx = conn.transaction()?;
        tx.execute_batch(
            "DELETE FROM attachments; DELETE FROM messages; DELETE FROM conversations;
             DELETE FROM settings; DELETE FROM model_cache; DELETE FROM model_cache_meta;
             DELETE FROM telemetry;",
        )?;
        tx.commit()?;
        conn.execute_batch("VACUUM")?;
        Ok(())
    }
}

fn migrate(conn: &mut Connection) -> StoreResult<()> {
    let current: usize =
        conn.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))? as usize;
    if current > MIGRATIONS.len() {
        return Err(StoreError::Corrupt(format!(
            "database schema v{current} is newer than this app (v{})",
            MIGRATIONS.len()
        )));
    }
    for (index, sql) in MIGRATIONS.iter().enumerate().skip(current) {
        let tx = conn.transaction()?;
        tx.execute_batch(sql)?;
        tx.pragma_update(None, "user_version", (index + 1) as i64)?;
        tx.commit()?;
    }
    Ok(())
}

/// Parses an optional JSON column, reporting corruption instead of panicking.
fn parse_json<T: serde::de::DeserializeOwned>(raw: Option<String>) -> StoreResult<Option<T>> {
    match raw {
        None => Ok(None),
        Some(text) => serde_json::from_str(&text)
            .map(Some)
            .map_err(|e| StoreError::Corrupt(e.to_string())),
    }
}

fn to_json<T: serde::Serialize>(value: &T) -> StoreResult<String> {
    serde_json::to_string(value).map_err(|e| StoreError::Corrupt(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrations_apply_once_and_are_idempotent() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("nested").join("machi.db");
        let store = Store::open(&path).unwrap();
        assert_eq!(store.schema_version().unwrap(), MIGRATIONS.len() as u32);
        drop(store);
        let reopened = Store::open(&path).unwrap();
        assert_eq!(reopened.schema_version().unwrap(), MIGRATIONS.len() as u32);
    }

    #[test]
    fn newer_schema_is_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("machi.db");
        {
            let conn = Connection::open(&path).unwrap();
            conn.pragma_update(None, "user_version", 99).unwrap();
        }
        assert!(matches!(Store::open(&path), Err(StoreError::Corrupt(_))));
    }
}
