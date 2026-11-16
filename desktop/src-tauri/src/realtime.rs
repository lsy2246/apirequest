use serde_json::json;
use std::sync::{
    OnceLock,
    atomic::{AtomicU64, Ordering},
};
use tauri::{AppHandle, Emitter};

static APP: OnceLock<AppHandle> = OnceLock::new();
static EPOCH: OnceLock<String> = OnceLock::new();
static SEQ: AtomicU64 = AtomicU64::new(0);

pub fn initialize(app: AppHandle) {
    let _ = APP.set(app);
}

pub fn notify(topic: &str) {
    if let Some(app) = APP.get() {
        let _ = app.emit_to(
            "main",
            "workbench-event",
            json!({
                "schemaVersion": 1,
                "source": "desktop",
                "epoch": EPOCH.get_or_init(|| uuid::Uuid::new_v4().to_string()),
                "seq": SEQ.fetch_add(1, Ordering::SeqCst) + 1,
                "topic": topic,
                "kind": "invalidate"
            }),
        );
    }
}
