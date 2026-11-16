use crate::CommandResult;
use apirequest_workbench::{
    CleanupCriteria, HistoryEntry, HistoryPolicyPatch, HistoryQuery, ResultInput, Workspace,
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{fs::File, io, sync::Arc, time::SystemTime};
use tauri::{
    AppHandle, State,
    ipc::{InvokeBody, Request},
};
use tauri_plugin_dialog::DialogExt;

#[derive(Deserialize)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum HistoryAction {
    List {
        protocol: String,
        take: u16,
    },
    Query {
        query: HistoryQuery,
    },
    Add {
        entry: HistoryEntry,
    },
    Star {
        id: String,
        starred: bool,
    },
    Delete {
        id: String,
    },
    Clear {
        protocol: String,
    },
    Policy,
    SetPolicy {
        policy: HistoryPolicyPatch,
    },
    Preview {
        criteria: CleanupCriteria,
    },
    Cleanup {
        criteria: CleanupCriteria,
        revision: String,
    },
    Detail {
        id: String,
    },
    Download {
        id: String,
        attachment: Option<String>,
    },
}

pub fn now() -> i64 {
    SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

fn execute(
    database: &Workspace,
    action: HistoryAction,
    app: &AppHandle,
) -> apirequest_workbench::Result<Value> {
    Ok(match action {
        HistoryAction::List { protocol, take } => {
            serde_json::to_value(database.list_history(&protocol, take)?)?
        }
        HistoryAction::Query { query } => serde_json::to_value(database.query_history(&query)?)?,
        HistoryAction::Add { entry } => {
            database.add_history(&entry)?;
            Value::Null
        }
        HistoryAction::Star { id, starred } => {
            database.star_history(&id, starred)?;
            Value::Null
        }
        HistoryAction::Delete { id } => {
            database.delete_history(&id)?;
            Value::Null
        }
        HistoryAction::Clear { protocol } => {
            database.clear_history(&protocol)?;
            Value::Null
        }
        HistoryAction::Policy => serde_json::to_value(database.history_policy()?)?,
        HistoryAction::SetPolicy { policy } => {
            database.update_history_policy(&policy)?;
            serde_json::to_value(database.history_policy()?)?
        }
        HistoryAction::Preview { criteria } => {
            serde_json::to_value(database.preview_cleanup(&criteria)?)?
        }
        HistoryAction::Cleanup { criteria, revision } => {
            serde_json::to_value(database.cleanup(&criteria, &revision, now())?)?
        }
        HistoryAction::Detail { id } => {
            let Some(result) = database.history_result(&id)? else {
                return Ok(Value::Null);
            };
            let mut paths = serde_json::Map::new();
            for file in &result.files {
                paths.insert(
                    file.id.clone(),
                    serde_json::to_value(database.file_path(&file.id)?)?,
                );
            }
            json!({ "result": result, "paths": paths })
        }
        HistoryAction::Download { id, attachment } => {
            let (info, mut input) = database.open_history_file(&id, attachment.as_deref())?;
            let destination = app
                .dialog()
                .file()
                .set_file_name(&info.name)
                .blocking_save_file();
            if let Some(path) = destination.and_then(|path| path.into_path().ok()) {
                let mut output = File::create(path)?;
                io::copy(&mut input, &mut output)?;
            }
            Value::Null
        }
    })
}

#[tauri::command]
pub async fn workbench_history(
    database: State<'_, Arc<Workspace>>,
    action: HistoryAction,
    app: AppHandle,
) -> CommandResult<Value> {
    let database = database.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        execute(&database, action, &app).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub fn workbench_archive_body(
    database: State<'_, Arc<Workspace>>,
    request: Request<'_>,
) -> CommandResult<Value> {
    let id = request
        .headers()
        .get("x-workbench-history-id")
        .and_then(|header| header.to_str().ok())
        .ok_or("missing history id")?;
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected binary response".into());
    };
    let split = bytes
        .iter()
        .take(1024 * 1024)
        .position(|byte| *byte == b'\n')
        .ok_or("invalid response metadata")?;
    let metadata: ResultInput =
        serde_json::from_slice(&bytes[..split]).map_err(|error| error.to_string())?;
    database
        .save_history_body(id, &metadata, &bytes[split + 1..])
        .map_err(|error| error.to_string())?;
    Ok(json!({ "saved": true }))
}
