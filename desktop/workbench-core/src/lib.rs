mod backup;
mod history;
mod store;

pub use backup::{active_workspace, restore_backup};
pub use history::{
    ArchivedFile, CleanupCriteria, CleanupPreview, HistoryEntry, HistoryPolicy, HistoryPolicyPatch,
    HistoryQuery, HistoryResult, ResultInput,
};
pub use store::StoreEntry;

use rusqlite::{Connection, TransactionBehavior};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::{Mutex, MutexGuard},
    time::Duration,
};

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("workspace database error: {0}")]
    Database(#[from] rusqlite::Error),
    #[error("workspace I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("invalid workspace data: {0}")]
    Json(#[from] serde_json::Error),
    #[error("{0}")]
    Invalid(&'static str),
    #[error("workspace entry was not found")]
    Missing,
    #[error("workspace data has changed; review it again")]
    Conflict,
    #[error("workspace is busy")]
    Busy,
}

pub type Result<T> = std::result::Result<T, Error>;

pub struct Workspace {
    connection: Mutex<Connection>,
    files: PathBuf,
}

impl Workspace {
    pub fn open(root: &Path) -> Result<Self> {
        fs::create_dir_all(root)?;
        let files = root.join("responses");
        fs::create_dir_all(&files)?;
        let mut connection = Connection::open(root.join("workspace.sqlite3"))?;
        connection.busy_timeout(Duration::from_secs(5))?;
        connection.pragma_update(None, "foreign_keys", true)?;
        connection.pragma_update(None, "journal_mode", "WAL")?;
        // 版本号和表结构同事务更新，应用退出时可安全重试。
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let version: u32 =
            transaction.pragma_query_value(None, "user_version", |row| row.get(0))?;
        match version {
            0 => {
                transaction.execute_batch(include_str!("schema.sql"))?;
                transaction.pragma_update(None, "user_version", 2)?;
            }
            2 => {}
            _ => {
                return Err(Error::Invalid("unsupported workspace database format"));
            }
        }
        transaction.execute(
            "CREATE INDEX IF NOT EXISTS history_by_time ON history(executed_at DESC, id DESC)",
            [],
        )?;
        transaction.commit()?;
        Ok(Self {
            connection: Mutex::new(connection),
            files,
        })
    }

    fn lock(&self) -> Result<MutexGuard<'_, Connection>> {
        self.connection.lock().map_err(|_| Error::Busy)
    }
}

fn check_key(key: &str) -> Result<()> {
    if key.is_empty() || key.len() > 256 || key.chars().any(char::is_control) {
        return Err(Error::Invalid("invalid workspace key"));
    }
    Ok(())
}
