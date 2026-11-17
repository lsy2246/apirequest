#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod backup;
mod cloud;
mod capture;
mod realtime;
mod capture_storage;
mod history;
mod mcp;
mod mock;

use apirequest_workbench::{StoreEntry, Workspace};
use serde::Deserialize;
use serde_json::Value;
use std::{fs, io::Write, path::PathBuf, sync::Arc};
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder};

use tauri_plugin_clipboard_manager::ClipboardExt;

type CommandResult<T> = std::result::Result<T, String>;

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum StoreAction {
    Get {
        scope: String,
        key: String,
    },
    Put {
        scope: String,
        key: String,
        value: Value,
    },
    Page {
        scope: String,
        skip: usize,
        take: usize,
    },
}

#[tauri::command]
async fn workbench_store(
    database: State<'_, Arc<Workspace>>,
    action: StoreAction,
) -> CommandResult<Value> {
    let database = database.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let namespace = "kernel.v1";
        let result = match action {
            StoreAction::Page { scope, skip, take } => database
                .store_page_without(&scope, namespace, skip, take.min(100), &[])
                .map(|values| Some(Value::Array(values))),
            StoreAction::Get { scope, key } => database.store_get(&scope, namespace, &key),
            StoreAction::Put { scope, key, value } => database
                .store_put(&StoreEntry {
                    scope,
                    namespace: namespace.into(),
                    key,
                    value,
                })
                .map(|()| None),
        };
        result
            .map(|value| value.unwrap_or(Value::Null))
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
fn get_logs_dir(app: AppHandle) -> CommandResult<PathBuf> {
    #[cfg(debug_assertions)]
    if let Some(root) = smoke_root() {
        return Ok(root.join("logs"));
    }
    app.path().app_log_dir().map_err(|error| error.to_string())
}

#[tauri::command]
fn append_log(app: AppHandle, filename: String, content: String) -> CommandResult<()> {
    // 只允许内置日志模块使用的单段文件名，避免任意路径写入。
    if !filename.ends_with(".log")
        || filename.len() > 120
        || filename.starts_with('.')
        || !filename
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c))
    {
        return Err("invalid log filename".into());
    }
    let root = get_logs_dir(app)?;
    (|| -> std::io::Result<()> {
        fs::create_dir_all(&root)?;
        fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(root.join(filename))?
            .write_all(content.as_bytes())
    })()
    .map_err(|error| error.to_string())
}

#[tauri::command]
fn workbench_copy_curl(app: AppHandle, text: String) -> CommandResult<()> {
    if !text.starts_with("curl ") {
        return Err("invalid cURL command".into());
    }
    #[cfg(debug_assertions)]
    if smoke_root().is_some() {
        // 验收窗口用独立数据库记录复制内容，避免修改用户的系统剪贴板。
        return app
            .state::<Arc<Workspace>>()
            .store_put(&StoreEntry {
                scope: "smoke".into(),
                namespace: "kernel.v1".into(),
                key: "copiedCurl".into(),
                value: Value::String(text),
            })
            .map_err(|error| error.to_string());
    }
    app.clipboard()
        .write_text(text)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn workbench_copy_text(app: AppHandle, text: String) -> CommandResult<()> {
    app.clipboard()
        .write_text(text)
        .map_err(|error| error.to_string())
}

#[cfg(debug_assertions)]
fn smoke_root() -> Option<PathBuf> {
    std::env::var_os("APIREQUEST_NATIVE_SMOKE_DIR").map(PathBuf::from)
}

#[tauri::command]
fn workbench_smoke_finish(
    app: AppHandle,
    passed: bool,
    message: Option<String>,
) -> CommandResult<()> {
    #[cfg(debug_assertions)]
    if smoke_root().is_some() {
        eprintln!(
            "Native smoke: {}",
            message.unwrap_or_else(|| "passed".into())
        );
        app.exit(if passed { 0 } else { 1 });
        return Ok(());
    }
    let _ = (app, passed, message);
    Err("smoke test is not enabled".into())
}

fn main() {
    let builder = tauri::Builder::default();
    let smoke = {
        #[cfg(debug_assertions)]
        {
            smoke_root().is_some()
        }
        #[cfg(not(debug_assertions))]
        {
            false
        }
    };
    // 独立验收窗口复用自己的临时数据库，避免聚焦或接管正在运行的正式实例。
    let builder = if smoke {
        builder
    } else {
        builder.plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
            }
        }))
    };
    builder
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_relay::init())
        .invoke_handler(tauri::generate_handler![
            workbench_store,
            capture::workbench_capture,
            backup::workbench_backup,
            cloud::workbench_cloud,
            mcp::workbench_mcp_access,
            mcp::workbench_mcp_reply,
            mcp::workbench_documentation_url,
            workbench_copy_text,
            workbench_copy_curl,
            get_logs_dir,
            append_log,
            history::workbench_history,
            mock::rules::workbench_mock_rules,
            history::workbench_archive_body,
            workbench_smoke_finish
        ])
        .setup(move |app| {
            let root = app.path().app_data_dir()?;
            let script = "window.__KERNEL_MODE__ = 'desktop'; window.__APIREQUEST_NATIVE__ = true;";
            #[cfg(debug_assertions)]
            let (root, script) = match smoke_root() {
                Some(root) => {
                    let config = serde_json::json!({
                        "target": std::env::var("APIREQUEST_NATIVE_SMOKE_TARGET")?,
                        "restart": std::env::var_os("APIREQUEST_NATIVE_SMOKE_RESTART").is_some(),
                        "captureOnly": std::env::var_os("APIREQUEST_NATIVE_CAPTURE_SMOKE").is_some(),
                        "mockOnly": std::env::var_os("APIREQUEST_NATIVE_MOCK_SMOKE").is_some(),
                        "saveOnly": std::env::var_os("APIREQUEST_NATIVE_SAVE_SMOKE").is_some(),
                    });
                    let script = format!(
                        "{script}window.__workbenchSmoke = {config};localStorage.setItem('collections', '[]');history.replaceState(null, '', '/?' + new URLSearchParams({{ url: window.__workbenchSmoke.target, method: 'GET' }}));window.addEventListener('DOMContentLoaded', () => {{ {} }});",
                        if std::env::var_os("APIREQUEST_NATIVE_MOCK_SMOKE").is_some() { include_str!("../tests/mock-smoke.js") } else { include_str!("../tests/smoke.js") },
                    );
                    (root, script)
                }
                None => (root, script.to_owned()),
            };
            let root = apirequest_workbench::active_workspace(&root)?;
            let workspace = Arc::new(Workspace::open(&root)?);
            app.asset_protocol_scope().allow_directory(root.join("responses"), false)?;
            workspace.recover_interrupted_history_writes()?;
            workspace.maintain_history(history::now())?;
            let maintenance = workspace.clone();
            // 自动清理在后台检查，应用连续运行时仍按数据库中的每日规则执行。
            std::thread::spawn(move || loop {
                std::thread::sleep(std::time::Duration::from_secs(60 * 60));
                if let Err(error) = maintenance.maintain_history(history::now()) {
                    eprintln!("History maintenance failed: {error}");
                }
            });
            realtime::initialize(app.handle().clone());
            let mcp = mcp::McpService::new(app.handle().clone(), workspace.clone());
            app.manage(mock::MockService::start(workspace.clone(), mcp.clone()));
            app.manage(mcp);
            app.manage(workspace);
            app.manage(Arc::new(capture::CaptureService::new(
                root.join("capture-ca"),
                app.path().resource_dir()?.join("capture"),
            )));
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title(if smoke { "API Request verification" } else { "API Request" })
                .focused(!smoke)
                .inner_size(1280.0, 850.0)
                .incognito(smoke)
                .initialization_script(script)
                .on_navigation(|url| {
                    matches!(
                        (url.scheme(), url.host_str()),
                        ("tauri", Some("localhost"))
                            | ("http", Some("tauri.localhost"))
                            | ("https", Some("tauri.localhost"))
                    )
                })
                .build()?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to run apirequest")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                app.state::<Arc<capture::CaptureService>>().shutdown();
            }
        });
}
