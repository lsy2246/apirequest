use crate::{Error, Result, Workspace, check_key};
use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::PathBuf,
};
use uuid::Uuid;

const DAY_MS: i64 = 86_400_000;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub id: String,
    pub request_id: Option<String>,
    pub protocol: String,
    pub executed_at: i64,
    pub entry: Value,
    pub starred: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryQuery {
    pub protocol: Option<String>,
    pub before: Option<HistoryCursor>,
    pub search: String,
    pub starred: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryCursor {
    pub executed_at: i64,
    pub id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryPage {
    pub entries: Vec<HistoryEntry>,
    pub next: Option<HistoryCursor>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryPolicy {
    pub enabled: bool,
    pub auto_cleanup: bool,
    pub retention_days: u16,
    pub excluded_request_ids: Vec<String>,
    pub last_auto_cleanup: Option<i64>,
    pub last_cleanup_at: Option<i64>,
    pub last_cleanup: Option<CleanupPreview>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryPolicyPatch {
    pub enabled: Option<bool>,
    pub auto_cleanup: Option<bool>,
    pub retention_days: Option<u16>,
    pub excluded_request_ids: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResultInput {
    pub kind: String,
    pub metadata: Value,
    pub saved_at: i64,
    pub name: String,
    pub content_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchivedFile {
    pub id: String,
    pub name: String,
    pub content_type: String,
    pub bytes: i64,
    pub sha256: String,
    pub is_body: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryResult {
    pub kind: String,
    pub metadata: Option<Value>,
    pub saved_at: i64,
    pub cleaned_at: Option<i64>,
    pub files: Vec<ArchivedFile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupCriteria {
    pub before: i64,
    pub kind: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CleanupPreview {
    pub count: i64,
    pub bytes: i64,
    pub revision: String,
}

fn protocol(value: &str) -> Result<()> {
    match value {
        "rest" | "graphql" => Ok(()),
        _ => Err(Error::Invalid("invalid history protocol")),
    }
}

fn kind(value: &str) -> Result<()> {
    match value {
        "json" | "text" | "image" | "video" | "file" => Ok(()),
        _ => Err(Error::Invalid("invalid response kind")),
    }
}

fn archived_file(row: &rusqlite::Row<'_>) -> rusqlite::Result<ArchivedFile> {
    Ok(ArchivedFile {
        id: row.get(0)?,
        name: row.get(1)?,
        content_type: row.get(2)?,
        bytes: row.get(3)?,
        sha256: row.get(4)?,
        is_body: row.get(5)?,
    })
}

fn cleanup_candidates(
    connection: &Connection,
    criteria: &CleanupCriteria,
) -> Result<(Vec<String>, CleanupPreview)> {
    if let Some(value) = &criteria.kind {
        kind(value)?;
    }
    let mut statement = connection.prepare(
        "SELECT r.history_id, COALESCE(SUM(f.bytes), 0)
         FROM history_results r JOIN history h ON h.id=r.history_id
         LEFT JOIN history_files f ON f.history_id=r.history_id
         WHERE r.cleaned_at IS NULL AND r.saved_at<?1 AND (?2 IS NULL OR r.kind=?2)
         AND NOT EXISTS (SELECT 1 FROM history_cleanup_exclusions x WHERE x.request_id=h.request_id)
         GROUP BY r.history_id ORDER BY r.history_id",
    )?;
    let mut ids = Vec::new();
    let mut bytes = 0i64;
    let mut hash = Sha256::new();
    for row in statement.query_map(params![criteria.before, criteria.kind], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
    })? {
        let (id, size) = row?;
        hash.update(serde_json::to_vec(&(&id, size))?);
        ids.push(id);
        bytes = bytes
            .checked_add(size)
            .ok_or(Error::Invalid("history size overflow"))?;
    }
    let report = CleanupPreview {
        count: ids.len() as i64,
        bytes,
        revision: format!("{:x}", hash.finalize()),
    };
    Ok((ids, report))
}

fn clean(connection: &Connection, ids: &[String], report: &CleanupPreview, at: i64) -> Result<()> {
    for id in ids {
        connection.execute("DELETE FROM history_files WHERE history_id=?", [id])?;
        connection.execute(
            "UPDATE history_results SET cleaned_at=?,metadata=NULL WHERE history_id=?",
            params![at, id],
        )?;
    }
    connection.execute(
        "UPDATE history_policy SET last_cleanup_at=?, last_cleanup_count=?, last_cleanup_bytes=? WHERE id=1",
        params![at, report.count, report.bytes],
    )?;
    Ok(())
}

impl Workspace {
    pub fn add_history(&self, value: &HistoryEntry) -> Result<()> {
        protocol(&value.protocol)?;
        check_key(&value.id)?;
        if let Some(request_id) = &value.request_id {
            check_key(request_id)?;
        }
        self.lock()?.execute(
            "INSERT INTO history(id,request_id,protocol,executed_at,entry,starred) VALUES(?,?,?,?,?,?)",
            params![value.id, value.request_id, value.protocol, value.executed_at, serde_json::to_string(&value.entry)?, value.starred],
        )?;
        Ok(())
    }

    pub fn list_history(&self, value: &str, take: u16) -> Result<Vec<HistoryEntry>> {
        protocol(value)?;
        let connection = self.lock()?;
        let mut statement = connection.prepare(
            "SELECT id,request_id,executed_at,entry,starred FROM history WHERE protocol=? ORDER BY executed_at DESC,id DESC LIMIT ?",
        )?;
        let mut result = Vec::new();
        let mut rows = statement.query(params![value, take.min(500)])?;
        while let Some(row) = rows.next()? {
            let entry: String = row.get(3)?;
            result.push(HistoryEntry {
                id: row.get(0)?,
                request_id: row.get(1)?,
                protocol: value.to_string(),
                executed_at: row.get(2)?,
                entry: serde_json::from_str(&entry)?,
                starred: row.get(4)?,
            });
        }
        Ok(result)
    }

    pub fn query_history(&self, query: &HistoryQuery) -> Result<HistoryPage> {
        if let Some(value) = &query.protocol {
            protocol(value)?;
        }
        let connection = self.lock()?;
        // 游标以时间和 ID 确定顺序，翻页时插入新请求不会挤掉已定位的记录。
        let mut statement = connection.prepare(
            "SELECT id,request_id,protocol,executed_at,entry,starred FROM history
             WHERE (?1 IS NULL OR protocol=?1)
               AND (?2 IS NULL OR (executed_at,id)<(?2,?3))
               AND (NOT ?4 OR starred=1)
               AND (?5='' OR instr(lower(entry),lower(?5))>0)
             ORDER BY executed_at DESC,id DESC LIMIT 51",
        )?;
        let mut rows = statement.query(params![
            query.protocol,
            query.before.as_ref().map(|cursor| cursor.executed_at),
            query.before.as_ref().map(|cursor| &cursor.id),
            query.starred,
            query.search.trim(),
        ])?;
        let mut entries = Vec::new();
        while let Some(row) = rows.next()? {
            let entry: String = row.get(4)?;
            entries.push(HistoryEntry {
                id: row.get(0)?,
                request_id: row.get(1)?,
                protocol: row.get(2)?,
                executed_at: row.get(3)?,
                entry: serde_json::from_str(&entry)?,
                starred: row.get(5)?,
            });
        }
        let next = if entries.len() > 50 {
            entries.truncate(50);
            entries.last().map(|entry| HistoryCursor {
                executed_at: entry.executed_at,
                id: entry.id.clone(),
            })
        } else {
            None
        };
        Ok(HistoryPage { entries, next })
    }

    pub fn star_history(&self, id: &str, starred: bool) -> Result<()> {
        if self.lock()?.execute(
            "UPDATE history SET starred=? WHERE id=?",
            params![starred, id],
        )? != 1
        {
            return Err(Error::Missing);
        }
        Ok(())
    }

    pub fn delete_history(&self, id: &str) -> Result<()> {
        self.lock()?
            .execute("DELETE FROM history WHERE id=?", [id])?;
        self.reap_files()?;
        Ok(())
    }

    pub fn clear_history(&self, value: &str) -> Result<()> {
        protocol(value)?;
        self.lock()?
            .execute("DELETE FROM history WHERE protocol=?", [value])?;
        self.reap_files()
    }

    pub fn history_policy(&self) -> Result<HistoryPolicy> {
        let connection = self.lock()?;
        let mut policy = connection.query_row(
            "SELECT enabled, auto_cleanup, retention_days, last_auto_cleanup,
                    last_cleanup_at, last_cleanup_count, last_cleanup_bytes
             FROM history_policy WHERE id=1",
            [],
            |row| {
                let last_cleanup_at: Option<i64> = row.get(4)?;
                let last_cleanup = if last_cleanup_at.is_some() {
                    Some(CleanupPreview {
                        count: row.get(5)?,
                        bytes: row.get(6)?,
                        revision: String::new(),
                    })
                } else {
                    None
                };
                Ok(HistoryPolicy {
                    enabled: row.get(0)?,
                    auto_cleanup: row.get(1)?,
                    retention_days: row.get(2)?,
                    last_auto_cleanup: row.get(3)?,
                    last_cleanup_at,
                    last_cleanup,
                    excluded_request_ids: Vec::new(),
                })
            },
        )?;
        let mut query = connection
            .prepare("SELECT request_id FROM history_cleanup_exclusions ORDER BY request_id")?;
        policy.excluded_request_ids = query
            .query_map([], |row| row.get(0))?
            .collect::<rusqlite::Result<_>>()?;
        Ok(policy)
    }

    pub fn update_history_policy(&self, patch: &HistoryPolicyPatch) -> Result<()> {
        if patch
            .retention_days
            .is_some_and(|days| !(1..=36500).contains(&days))
        {
            return Err(Error::Invalid("invalid retention days"));
        }
        let mut connection = self.lock()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        // 局部修改在数据库内合并，避免开关和清理规则同时保存时互相覆盖。
        transaction.execute(
            "UPDATE history_policy SET enabled=COALESCE(?,enabled),
                 auto_cleanup=COALESCE(?,auto_cleanup), retention_days=COALESCE(?,retention_days) WHERE id=1",
            params![patch.enabled, patch.auto_cleanup, patch.retention_days],
        )?;
        if let Some(exclusions) = &patch.excluded_request_ids {
            transaction.execute("DELETE FROM history_cleanup_exclusions", [])?;
            for id in exclusions {
                check_key(id)?;
                transaction.execute(
                    "INSERT OR IGNORE INTO history_cleanup_exclusions(request_id) VALUES(?)",
                    [id],
                )?;
            }
        }
        transaction.commit()?;
        Ok(())
    }

    pub fn save_history_body(
        &self,
        id: &str,
        input: &ResultInput,
        reader: impl Read,
    ) -> Result<ArchivedFile> {
        kind(&input.kind)?;
        self.write_history_file(id, &input.name, &input.content_type, Some(input), reader)
    }

    pub fn save_history_attachment(
        &self,
        id: &str,
        name: &str,
        content_type: &str,
        reader: impl Read,
    ) -> Result<ArchivedFile> {
        self.write_history_file(id, name, content_type, None, reader)
    }

    fn write_history_file(
        &self,
        history_id: &str,
        name: &str,
        content_type: &str,
        body: Option<&ResultInput>,
        mut reader: impl Read,
    ) -> Result<ArchivedFile> {
        check_key(history_id)?;
        check_key(name)?;
        check_key(content_type)?;
        let id = Uuid::new_v4().to_string();
        let path = self.files.join(&id);
        let stage = self.files.join(format!("{id}.part"));
        let result = (|| {
            let mut output = OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&stage)?;
            let mut hash = Sha256::new();
            let mut buffer = [0u8; 64 * 1024];
            let mut bytes = 0i64;
            // 文件写入发生在 SQLite 事务外，大响应不会长期占用写锁。
            loop {
                let len = reader.read(&mut buffer)?;
                if len == 0 {
                    break;
                }
                output.write_all(&buffer[..len])?;
                hash.update(&buffer[..len]);
                bytes = bytes
                    .checked_add(len as i64)
                    .ok_or(Error::Invalid("history size overflow"))?;
            }
            output.sync_all()?;
            drop(output);
            let sha256 = format!("{:x}", hash.finalize());
            let mut connection = self.lock()?;
            let transaction =
                connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
            if let Some(input) = body {
                let enabled: bool = transaction.query_row(
                    "SELECT enabled FROM history_policy WHERE id=1",
                    [],
                    |row| row.get(0),
                )?;
                if !enabled {
                    return Err(Error::Invalid("saving responses is disabled"));
                }
                transaction.execute("INSERT INTO history_results(history_id,kind,metadata,saved_at) VALUES(?,?,?,?)", params![history_id, input.kind, serde_json::to_string(&input.metadata)?, input.saved_at])?;
            } else {
                let active = transaction
                    .query_row(
                        "SELECT 1 FROM history_results WHERE history_id=? AND cleaned_at IS NULL",
                        [history_id],
                        |_| Ok(()),
                    )
                    .optional()?
                    .is_some();
                if !active {
                    return Err(Error::Missing);
                }
            }
            transaction.execute(
                "INSERT INTO history_files(id,history_id,name,content_type,bytes,is_body,sha256) VALUES(?,?,?,?,?,?,?)",
                params![id, history_id, name, content_type, bytes, body.is_some(), sha256],
            )?;
            fs::rename(&stage, &path)?;
            transaction.commit()?;
            Ok(ArchivedFile {
                id,
                name: name.to_string(),
                content_type: content_type.to_string(),
                bytes,
                sha256,
                is_body: body.is_some(),
            })
        })();
        if result.is_err() {
            let _ = fs::remove_file(stage);
            let _ = fs::remove_file(path);
        }
        result
    }

    pub fn history_result(&self, history_id: &str) -> Result<Option<HistoryResult>> {
        let connection = self.lock()?;
        let row = connection
            .query_row(
                "SELECT kind,metadata,saved_at,cleaned_at FROM history_results WHERE history_id=?",
                [history_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, Option<String>>(1)?,
                        row.get::<_, i64>(2)?,
                        row.get::<_, Option<i64>>(3)?,
                    ))
                },
            )
            .optional()?;
        let Some((kind, metadata, saved_at, cleaned_at)) = row else {
            return Ok(None);
        };
        let mut statement = connection.prepare("SELECT id,name,content_type,bytes,sha256,is_body FROM history_files WHERE history_id=? ORDER BY is_body DESC,id")?;
        let files = statement
            .query_map([history_id], archived_file)?
            .collect::<rusqlite::Result<_>>()?;
        Ok(Some(HistoryResult {
            kind,
            metadata: metadata
                .map(|value| serde_json::from_str(&value))
                .transpose()?,
            saved_at,
            cleaned_at,
            files,
        }))
    }

    pub fn open_history_file(
        &self,
        history_id: &str,
        attachment: Option<&str>,
    ) -> Result<(ArchivedFile, File)> {
        let connection = self.lock()?;
        let info = connection.query_row(
            "SELECT id,name,content_type,bytes,sha256,is_body FROM history_files WHERE history_id=?1
             AND ((?2 IS NULL AND is_body=1) OR (?2 IS NOT NULL AND id=?2 AND is_body=0))",
            params![history_id, attachment], archived_file,
        ).optional()?.ok_or(Error::Missing)?;
        let file = File::open(self.file_path(&info.id)?)?;
        Ok((info, file))
    }

    pub fn file_path(&self, id: &str) -> Result<PathBuf> {
        if Uuid::parse_str(id).is_err() {
            return Err(Error::Invalid("invalid archived file id"));
        }
        Ok(self.files.join(id))
    }

    pub fn preview_cleanup(&self, criteria: &CleanupCriteria) -> Result<CleanupPreview> {
        Ok(cleanup_candidates(&*self.lock()?, criteria)?.1)
    }

    pub fn cleanup(
        &self,
        criteria: &CleanupCriteria,
        revision: &str,
        at: i64,
    ) -> Result<CleanupPreview> {
        let mut connection = self.lock()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let (ids, report) = cleanup_candidates(&transaction, criteria)?;
        if revision != report.revision {
            return Err(Error::Conflict);
        }
        clean(&transaction, &ids, &report, at)?;
        transaction.commit()?;
        drop(connection);
        self.reap_files()?;
        Ok(report)
    }

    pub fn maintain_history(&self, at: i64) -> Result<()> {
        let mut connection = self.lock()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let (enabled, days, last): (bool, i64, Option<i64>) = transaction.query_row(
            "SELECT auto_cleanup,retention_days,last_auto_cleanup FROM history_policy WHERE id=1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )?;
        if enabled && last.is_none_or(|last| at.saturating_sub(last) >= DAY_MS) {
            let criteria = CleanupCriteria {
                before: at.saturating_sub(days * DAY_MS),
                kind: None,
            };
            let (ids, report) = cleanup_candidates(&transaction, &criteria)?;
            clean(&transaction, &ids, &report, at)?;
            transaction.execute(
                "UPDATE history_policy SET last_auto_cleanup=? WHERE id=1",
                [at],
            )?;
        }
        transaction.commit()?;
        drop(connection);
        self.reap_files()?;
        Ok(())
    }

    pub fn recover_interrupted_history_writes(&self) -> Result<()> {
        let connection = self.lock()?;
        // 仅在应用启动且未开始归档时调用，清理上次退出留下的临时文件和未提交文件。
        let mut exists = connection.prepare("SELECT 1 FROM history_files WHERE id=?")?;
        for entry in fs::read_dir(&self.files)? {
            let entry = entry?;
            if !entry.file_type()?.is_file() {
                continue;
            }
            let file_name = entry.file_name();
            let Some(file_name) = file_name.to_str() else {
                continue;
            };
            let staged = file_name.strip_suffix(".part");
            let id = staged.unwrap_or(file_name);
            if Uuid::parse_str(id).is_err() {
                continue;
            }
            if staged.is_some() || !exists.exists([id])? {
                match fs::remove_file(entry.path()) {
                    Ok(()) => {}
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                    Err(error) => return Err(error.into()),
                }
            }
        }
        Ok(())
    }

    pub fn reap_files(&self) -> Result<()> {
        let connection = self.lock()?;
        let mut query = connection.prepare("SELECT id FROM pending_file_removal")?;
        for id in query
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?
        {
            // 关闭文件句柄后再重试，Windows 上预览中占用的文件也能最终清掉。
            match fs::remove_file(self.file_path(&id)?) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(_) => continue,
            }
            connection.execute("DELETE FROM pending_file_removal WHERE id=?", [id])?;
        }
        Ok(())
    }
}
