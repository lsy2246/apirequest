use crate::{Error, Result, Workspace};
use rusqlite::{Connection, OpenFlags};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File, OpenOptions},
    io::{self, Read, Write},
    path::{Path, PathBuf},
};
use uuid::Uuid;

const DB: &str = "workspace.sqlite3";
const RESPONSES: &str = "responses";
const MANIFEST: &str = "backup-format";
const FORMAT: &[u8] = b"API Request workspace 1\n";
const ACTIVE: &str = "active-workspace";
const SNAPSHOTS: &str = "workspaces";

pub fn active_workspace(root: &Path) -> Result<PathBuf> {
    let id = match fs::read_to_string(root.join(ACTIVE)) {
        Ok(id) => {
            Uuid::parse_str(id.trim()).map_err(|_| Error::Invalid("invalid workspace selector"))?
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(root.to_owned()),
        Err(error) => return Err(error.into()),
    };
    let path = root.join(SNAPSHOTS).join(id.to_string());
    if !path.join(DB).is_file() {
        return Err(Error::Invalid("active workspace is missing"));
    }
    Ok(path)
}

impl Workspace {
    pub fn backup_to(&self, parent: &Path) -> Result<PathBuf> {
        let id = Uuid::new_v4();
        let stage = parent.join(format!(".apirequest-{id}.part"));
        let output = parent.join(format!("API-Request-{id}"));
        create_private_directory(&stage)?;
        let result = (|| {
            let connection = self.lock()?;
            // 锁内生成一致快照，文件清理和新历史写入都不能越过快照边界。
            connection.execute(
                "VACUUM INTO ?1",
                [stage.join(DB).to_string_lossy().as_ref()],
            )?;
            copy_responses(&connection, &self.files, &stage.join(RESPONSES), false)?;
            OpenOptions::new()
                .write(true)
                .open(stage.join(DB))?
                .sync_all()?;
            let mut manifest = File::create(stage.join(MANIFEST))?;
            manifest.write_all(FORMAT)?;
            manifest.sync_all()?;
            drop(manifest);
            fs::rename(&stage, &output)?;
            Ok(output)
        })();
        if result.is_err() {
            let _ = fs::remove_dir_all(stage);
        }
        result
    }
}

pub fn restore_backup(root: &Path, source: &Path) -> Result<()> {
    if fs::read(source.join(MANIFEST))? != FORMAT {
        return Err(Error::Invalid("unsupported workspace backup format"));
    }
    let parent = root.join(SNAPSHOTS);
    fs::create_dir_all(&parent)?;
    let id = Uuid::new_v4().to_string();
    let stage = parent.join(&id);
    let selector = root.join(format!(".{id}.part"));
    create_private_directory(&stage)?;
    let result = (|| {
        let db = source.join(DB);
        if !fs::symlink_metadata(&db)?.is_file() {
            return Err(Error::Invalid("invalid workspace database"));
        }
        let path = stage.join(DB);
        fs::copy(db, &path)?;
        let connection = Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
        let version: u32 = connection.pragma_query_value(None, "user_version", |row| row.get(0))?;
        let integrity: String =
            connection.pragma_query_value(None, "quick_check", |row| row.get(0))?;
        if version != 2 || integrity != "ok" {
            return Err(Error::Invalid("invalid workspace backup"));
        }
        connection.prepare("SELECT scope,namespace,key,value FROM store_values LIMIT 0")?;
        copy_responses(
            &connection,
            &source.join(RESPONSES),
            &stage.join(RESPONSES),
            true,
        )?;
        drop(connection);
        OpenOptions::new().write(true).open(path)?.sync_all()?;
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&selector)?;
        file.write_all(id.as_bytes())?;
        file.sync_all()?;
        drop(file);
        // 只有文件全部校验后才切换启动指针，当前运行的旧工作区仍在原目录。
        fs::rename(&selector, root.join(ACTIVE))?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(selector);
        let _ = fs::remove_dir_all(stage);
    }
    result
}

fn create_private_directory(path: &Path) -> io::Result<()> {
    let mut builder = fs::DirBuilder::new();
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder.create(path)
}

fn copy_responses(connection: &Connection, from: &Path, to: &Path, verify: bool) -> Result<()> {
    fs::create_dir(to)?;
    let mut query = connection.prepare("SELECT id,bytes,sha256 FROM history_files ORDER BY id")?;
    let mut rows = query.query([])?;
    while let Some(row) = rows.next()? {
        let id: String = row.get(0)?;
        Uuid::parse_str(&id).map_err(|_| Error::Invalid("invalid response file name"))?;
        let input = from.join(&id);
        if !fs::symlink_metadata(&input)?.is_file() {
            return Err(Error::Invalid("invalid response file"));
        }
        let target = to.join(id);
        let bytes = fs::copy(input, &target)?;
        let mut file = OpenOptions::new().read(true).write(true).open(&target)?;
        if verify {
            let expected: i64 = row.get(1)?;
            let digest: String = row.get(2)?;
            let mut hash = Sha256::new();
            let mut buffer = [0u8; 64 * 1024];
            loop {
                let size = file.read(&mut buffer)?;
                if size == 0 {
                    break;
                }
                hash.update(&buffer[..size]);
            }
            if i64::try_from(bytes).ok() != Some(expected)
                || format!("{:x}", hash.finalize()) != digest
            {
                return Err(Error::Invalid("response file checksum mismatch"));
            }
        }
        file.sync_all()?;
    }
    Ok(())
}
