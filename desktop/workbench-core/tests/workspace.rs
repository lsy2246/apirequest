use apirequest_workbench::{
    CleanupCriteria, Error, HistoryEntry, HistoryPolicyPatch, HistoryQuery, ResultInput,
    StoreEntry, Workspace,
};
use serde_json::json;
use std::{
    fs,
    io::{self, Read},
};

fn entry(key: &str, value: serde_json::Value) -> StoreEntry {
    StoreEntry {
        scope: "workspace".into(),
        namespace: "persistence.v1".into(),
        key: key.into(),
        value,
    }
}

fn history(id: &str, request_id: &str, at: i64) -> HistoryEntry {
    HistoryEntry {
        id: id.into(),
        request_id: Some(request_id.into()),
        protocol: "rest".into(),
        executed_at: at,
        entry: json!({"request":{"name":"测试", "endpoint":"https://example.invalid"}}),
        starred: false,
    }
}

fn response(at: i64) -> ResultInput {
    ResultInput {
        kind: "file".into(),
        metadata: json!({"statusCode":422,"duration":4}),
        saved_at: at,
        name: "response.bin".into(),
        content_type: "application/octet-stream".into(),
    }
}

#[test]
fn archives_large_responses_and_protects_all_runs_of_an_excluded_request() {
    let directory = tempfile::tempdir().unwrap();
    let workspace = Workspace::open(directory.path()).unwrap();
    for (id, request) in [("a", "keep"), ("b", "keep"), ("c", "delete")] {
        workspace.add_history(&history(id, request, 1)).unwrap();
    }
    assert!(workspace.history_policy().unwrap().enabled);
    workspace
        .update_history_policy(&HistoryPolicyPatch {
            enabled: Some(false),
            ..Default::default()
        })
        .unwrap();
    assert!(
        workspace
            .save_history_body("a", &response(1), &b"disabled"[..])
            .is_err()
    );
    workspace
        .update_history_policy(&HistoryPolicyPatch {
            enabled: Some(true),
            excluded_request_ids: Some(vec!["keep".into()]),
            ..Default::default()
        })
        .unwrap();
    const BYTES: u64 = 34 * 1024 * 1024;
    let first = workspace
        .save_history_body("a", &response(1), io::repeat(0xaa).take(BYTES))
        .unwrap();
    for id in ["b", "c"] {
        workspace
            .save_history_body(id, &response(1), &b"contents"[..])
            .unwrap();
    }
    workspace.star_history("a", true).unwrap();
    drop(workspace);

    let workspace = Workspace::open(directory.path()).unwrap();
    let interrupted = directory
        .path()
        .join("responses")
        .join("10e6ca4f-0a0a-4bb8-8bfc-994ad2924cda.part");
    fs::write(&interrupted, b"partial response").unwrap();
    workspace.recover_interrupted_history_writes().unwrap();
    assert!(!interrupted.exists());
    let (file, mut stream) = workspace.open_history_file("a", None).unwrap();
    assert_eq!(file.sha256, first.sha256);
    assert_eq!(io::copy(&mut stream, &mut io::sink()).unwrap(), BYTES);
    drop(stream);
    let criteria = CleanupCriteria {
        before: 10,
        kind: Some("file".into()),
    };
    let initial = workspace.preview_cleanup(&criteria).unwrap();
    assert_eq!((initial.count, initial.bytes), (1, 8));
    let attachment = workspace
        .save_history_attachment(
            "c",
            "copy.bin",
            "application/octet-stream",
            &b"attachment"[..],
        )
        .unwrap();
    assert!(matches!(
        workspace.cleanup(&criteria, &initial.revision, 10),
        Err(Error::Conflict)
    ));
    let preview = workspace.preview_cleanup(&criteria).unwrap();
    assert_eq!(
        workspace
            .cleanup(&criteria, &preview.revision, 10)
            .unwrap()
            .bytes,
        18
    );
    assert!(
        workspace
            .history_result("c")
            .unwrap()
            .unwrap()
            .cleaned_at
            .is_some()
    );
    assert!(
        workspace
            .open_history_file("c", Some(&attachment.id))
            .is_err()
    );
    assert!(workspace.open_history_file("b", None).is_ok());
    assert!(
        workspace
            .list_history("rest", 50)
            .unwrap()
            .iter()
            .find(|row| row.id == "a")
            .unwrap()
            .starred
    );
    assert_eq!(workspace.list_history("rest", 50).unwrap().len(), 3);
    workspace.delete_history("a").unwrap();
    assert!(!directory.path().join("responses").join(first.id).exists());
}

#[test]
fn automatic_cleanup_obeys_retention_and_keeps_request_history() {
    let directory = tempfile::tempdir().unwrap();
    let workspace = Workspace::open(directory.path()).unwrap();
    workspace
        .update_history_policy(&HistoryPolicyPatch {
            enabled: Some(true),
            ..Default::default()
        })
        .unwrap();
    workspace
        .update_history_policy(&HistoryPolicyPatch {
            auto_cleanup: Some(true),
            retention_days: Some(1),
            ..Default::default()
        })
        .unwrap();
    for (id, date) in [("old", 1), ("recent", 86_400_000)] {
        workspace.add_history(&history(id, id, date)).unwrap();
        workspace
            .save_history_body(id, &response(date), &b"test"[..])
            .unwrap();
    }
    workspace.maintain_history(86_400_002).unwrap();
    let policy = workspace.history_policy().unwrap();
    assert!(policy.enabled);
    assert_eq!(policy.last_cleanup_at, Some(86_400_002));
    let report = policy.last_cleanup.unwrap();
    assert_eq!((report.count, report.bytes), (1, 4));
    assert!(
        workspace
            .history_result("old")
            .unwrap()
            .unwrap()
            .cleaned_at
            .is_some()
    );
    assert!(workspace.open_history_file("recent", None).is_ok());
    assert_eq!(workspace.list_history("rest", 50).unwrap().len(), 2);
}

#[test]
fn history_pages_and_filters_query_persisted_records() {
    let directory = tempfile::tempdir().unwrap();
    let workspace = Workspace::open(directory.path()).unwrap();
    for i in 0..55 {
        let mut row = history(&format!("row-{i:02}"), "request", 10);
        if i == 0 {
            row.protocol = "graphql".into();
            row.starred = true;
            row.entry = json!({"request": {"url": "https://example.invalid/old-query"}});
        }
        workspace.add_history(&row).unwrap();
    }
    let mut query = HistoryQuery {
        protocol: None,
        before: None,
        search: String::new(),
        starred: false,
    };
    let first = workspace.query_history(&query).unwrap();
    assert_eq!(first.entries.len(), 50);
    query.before = first.next;
    let last = workspace.query_history(&query).unwrap();
    assert_eq!(last.entries.len(), 5);
    assert!(last.next.is_none());
    query.before = None;
    query.search = "OLD-QUERY".into();
    query.starred = true;
    let filtered = workspace.query_history(&query).unwrap();
    assert_eq!(filtered.entries.len(), 1);
    assert_eq!(filtered.entries[0].id, "row-00");
}

#[test]
fn full_backup_restores_store_history_and_bytes_and_rejects_corruption() {
    let root = tempfile::tempdir().unwrap();
    let exports = tempfile::tempdir().unwrap();
    let workspace = Workspace::open(root.path()).unwrap();
    workspace
        .store_put(&entry("env", json!({"name": "original"})))
        .unwrap();
    workspace
        .add_history(&history("response", "request", 10))
        .unwrap();
    let archived = workspace
        .save_history_body("response", &response(11), &b"response bytes"[..])
        .unwrap();
    let backup = workspace.backup_to(exports.path()).unwrap();
    workspace
        .store_put(&entry("env", json!({"name": "current"})))
        .unwrap();
    apirequest_workbench::restore_backup(root.path(), &backup).unwrap();
    let active = apirequest_workbench::active_workspace(root.path()).unwrap();
    assert_ne!(active, root.path());
    let restored = Workspace::open(&active).unwrap();
    assert_eq!(
        restored
            .store_get("workspace", "persistence.v1", "env")
            .unwrap(),
        Some(json!({"name":"original"}))
    );
    assert_eq!(
        fs::read(restored.file_path(&archived.id).unwrap()).unwrap(),
        b"response bytes"
    );
    assert_eq!(
        workspace
            .store_get("workspace", "persistence.v1", "env")
            .unwrap(),
        Some(json!({"name":"current"}))
    );
    fs::write(
        backup.join("responses").join(archived.id),
        b"invalid bytes!",
    )
    .unwrap();
    assert!(apirequest_workbench::restore_backup(root.path(), &backup).is_err());
    assert_eq!(
        apirequest_workbench::active_workspace(root.path()).unwrap(),
        active
    );
}
