//! Local SQLite store (§1.3 `store`).

#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    #[error("database error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("stored data is invalid: {0}")]
    Corrupt(String),
    #[error("database lock poisoned")]
    Poisoned,
}
