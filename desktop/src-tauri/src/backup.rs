use crate::CommandResult;
use apirequest_workbench::{Workspace, restore_backup};
use std::sync::Arc;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

#[tauri::command]
pub async fn workbench_backup(
    app: AppHandle,
    database: State<'_, Arc<Workspace>>,
    restore: bool,
) -> CommandResult<Option<String>> {
    let database = database.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let Some(path) = app.dialog().file().blocking_pick_folder() else {
            return Ok(None);
        };
        let path = path.into_path().map_err(|error| error.to_string())?;
        if restore {
            let root = app
                .path()
                .app_data_dir()
                .map_err(|error| error.to_string())?;
            restore_backup(&root, &path).map_err(|error| error.to_string())?;
            // 新窗口会从已验证的快照启动，内存中的旧状态不会回写新库。
            app.restart();
        }
        database
            .backup_to(&path)
            .map(|path| Some(path.to_string_lossy().into_owned()))
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}
