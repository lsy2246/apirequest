use serde_json::{Value, json};
use std::{
    collections::HashMap,
    fs,
    io::{BufRead, BufReader, Write},
    path::PathBuf,
    process::{Child, ChildStdin, Command, Stdio},
    sync::{Arc, Mutex, mpsc},
    time::{Duration, Instant},
};

const PORT: u16 = 18888;
const MARKER: &str = "APIREQUEST_CAPTURE ";
type Reply = Result<Value, String>;

#[derive(Default)]
struct Session {
    ready: bool,
    exited: bool,
    archive_id: String,
    archive_status: Value,
    proxy: String,
    mode: String,
    endpoint: String,
    error: String,
    pending: HashMap<String, mpsc::SyncSender<Reply>>,
}

struct Engine {
    child: Child,
    input: Option<ChildStdin>,
    deadline: Instant,
}

pub struct CaptureService {
    port: u16,
    root: PathBuf,
    resource: PathBuf,
    session: Arc<Mutex<Session>>,
    engine: Mutex<Option<Engine>>,
    management: Mutex<()>,
    management_child: Mutex<Option<Child>>,
}

impl CaptureService {
    pub fn new(root: PathBuf, resource: PathBuf) -> Self {
        Self {
            port: PORT,
            root,
            resource,
            session: Arc::new(Mutex::new(Session::default())),
            engine: Mutex::new(None),
            management: Mutex::new(()),
            management_child: Mutex::new(None),
        }
    }

    fn start(&self, body: Value) -> Reply {
        let _management = self.management.try_lock().map_err(|_| "busy")?;
        if body != json!({}) {
            return Err("invalid_target".into());
        }
        let mut engine = self.engine.lock().unwrap();
        self.reap(&mut engine);
        if engine.is_some() {
            return Err("busy".into());
        }
        fs::create_dir_all(&self.root).map_err(|_| "engine_unavailable")?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&self.root, fs::Permissions::from_mode(0o700))
                .map_err(|_| "engine_unavailable")?;
        }
        let mut command = Command::new(self.executable()?);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        let mut child = command
            .args([
                "--quiet",
                "--set",
                "server=false",
                "--set",
                &format!("confdir={}", self.root.display()),
                "--set",
                "connection_strategy=lazy",
                "--set",
                "ssl_insecure=false",
                "--set",
                "termlog_verbosity=error",
                "-s",
            ])
            .arg(self.resource.join("recorder.py"))
            .env("APIREQUEST_CAPTURE_INTERNAL_PORTS", "[3000,3001,3170,3171]")
            .env(
                "APIREQUEST_CAPTURE_EXCLUDED_PIDS",
                json!([std::process::id()]).to_string(),
            )
            .env("APIREQUEST_CAPTURE_PORT", self.port.to_string())
            .env("APIREQUEST_CAPTURE_CONFIG", &self.root)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|_| "engine_unavailable")?;
        let output = child.stdout.take().ok_or("engine_unavailable")?;
        let stdin = child.stdin.take().ok_or("engine_unavailable")?;
        *self.session.lock().unwrap() = Session {
            proxy: format!("http://127.0.0.1:{}", self.port),
            mode: "control".into(),
            ..Session::default()
        };
        *engine = Some(Engine {
            child,
            input: Some(stdin),
            deadline: Instant::now() + Duration::from_secs(20),
        });
        let session = self.session.clone();
        // 管道独占读线程，只处理引擎事件，不将可能含敏感字段的原始输出写到日志。
        std::thread::spawn(move || {
            for line in BufReader::new(output).lines().map_while(Result::ok) {
                if let Some(value) = line
                    .strip_prefix(MARKER)
                    .and_then(|line| serde_json::from_str::<Value>(line).ok())
                {
                    let changed = value["callID"].is_null();
                    session.lock().unwrap().event(value);
                    if changed { crate::realtime::notify("capture"); }
                }
            }
            let mut session = session.lock().unwrap();
            session.exited = true;
            session.pending.clear();
            drop(session);
            crate::realtime::notify("capture");
        });
        Ok(json!({ "state": "starting" }))
    }

    fn manage(&self, action: &str, body: Value) -> Reply {
        let _management = self.management.try_lock().map_err(|_| "busy")?;
        {
            let mut engine = self.engine.lock().unwrap();
            self.reap(&mut engine);
            if engine.is_some() {
                if !self.session.lock().unwrap().ready {
                    return Err("busy".into());
                }
                drop(engine);
                return self.send(action, body);
            }
        }
        fs::create_dir_all(&self.root).map_err(|_| "engine_unavailable")?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&self.root, fs::Permissions::from_mode(0o700))
                .map_err(|_| "engine_unavailable")?;
        }

        let mut command = Command::new(self.executable()?);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        let mut managed = self.management_child.lock().unwrap();
        let mut child = command
            .args([
                "--quiet",
                "--set",
                "server=false",
                "--set",
                &format!("confdir={}", self.root.display()),
                "-s",
            ])
            .arg(self.resource.join("recorder.py"))
            .env("APIREQUEST_CAPTURE_CONFIG", &self.root)
            .env("APIREQUEST_CAPTURE_MANAGE", json!(action).to_string())
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|_| "engine_unavailable")?;
        let output = child.stdout.take().ok_or("engine_unavailable")?;
        *managed = Some(child);
        drop(managed);
        let (sender, receiver) = mpsc::sync_channel(1);
        // 独立读取管道，避免管理输出阻塞子进程；超时后回收进程与读取线程。
        let reader = std::thread::spawn(move || {
            for line in BufReader::new(output).lines().map_while(Result::ok) {
                if let Some(value) = line
                    .strip_prefix(MARKER)
                    .and_then(|text| serde_json::from_str::<Value>(text).ok())
                {
                    let _ = sender.send(value);
                }
            }
        });
        let result = receiver.recv_timeout(Duration::from_secs(45));
        let deadline = Instant::now() + Duration::from_secs(5);
        while Instant::now() < deadline {
            let mut slot = self.management_child.lock().unwrap();
            if slot
                .as_mut()
                .is_none_or(|child| child.try_wait().ok().flatten().is_some())
            {
                break;
            }
            drop(slot);
            std::thread::sleep(Duration::from_millis(25));
        }
        if let Some(mut child) = self.management_child.lock().unwrap().take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        let _ = reader.join();
        let value = result.map_err(|_| "system_unavailable")?;
        if let Some(error) = value["error"].as_str() {
            return Err(error.to_owned());
        }
        Ok(value["result"].clone())
    }

    fn executable(&self) -> Result<PathBuf, String> {
        if !cfg!(target_os = "macos") {
            return Ok(self.resource.join("mitmdump.exe"));
        }
        let version = "mitmproxy-12.3.0";
        let installed = self.root.join(version);
        let binary = "mitmproxy.app/Contents/MacOS/mitmdump";
        if installed.join(binary).is_file() {
            return Ok(installed.join(binary));
        }
        let staging = self
            .root
            .join(format!("{version}-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&staging).map_err(|_| "engine_unavailable")?;
        let result = Command::new("/usr/bin/tar")
            .arg("-xzf")
            .arg(self.resource.join(format!("{version}.tar.gz")))
            .arg("-C")
            .arg(&staging)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
        // 解包完成后再发布目录，失败时不会复用半成品。
        if result.is_ok_and(|status| status.success())
            && staging.join(binary).is_file()
            && fs::rename(&staging, &installed).is_ok()
        {
            return Ok(installed.join(binary));
        }
        let _ = fs::remove_dir_all(&staging);
        Err("engine_unavailable".into())
    }

    fn reap(&self, slot: &mut Option<Engine>) {
        let Some(engine) = slot else { return };
        let mut session = self.session.lock().unwrap();
        let exited = engine.child.try_wait().ok().flatten().is_some();
        // 读取线程结束后才允许开启新会话，旧引擎的结束事件不会覆盖新状态。
        if exited && session.exited {
            if engine.input.is_some() && session.error.is_empty() {
                session.error = "engine_exited".into();
            }
            *slot = None;
        } else if Instant::now() > engine.deadline {
            if engine.input.is_some() && !session.ready {
                session.error = "engine_exited".into();
                engine.input.take();
                engine.deadline = Instant::now() + Duration::from_secs(45);
            } else if engine.input.is_none() {
                let _ = engine.child.kill();
            }
        }
    }

    fn send(&self, action: &str, body: Value) -> Reply {
        let mut engine = self.engine.lock().unwrap();
        let mut session = self.session.lock().unwrap();
        let input = engine
            .as_mut()
            .and_then(|engine| engine.input.as_mut())
            .ok_or("engine_unavailable")?;
        if !session.ready || session.exited {
            return Err("engine_unavailable".into());
        }
        if session.pending.len() >= 16 {
            return Err("busy".into());
        }
        let id = uuid::Uuid::new_v4().to_string();
        let (sender, receiver) = mpsc::sync_channel(1);
        session.pending.insert(id.clone(), sender);
        let result = writeln!(
            input,
            "{}",
            json!({ "callID": id, "action": action, "body": body })
        );
        drop(session);
        drop(engine);
        let result = if result.is_ok() {
            receiver.recv_timeout(Duration::from_secs(45)).ok()
        } else {
            None
        };
        self.session.lock().unwrap().pending.remove(&id);
        result.unwrap_or_else(|| Err("engine_exited".into()))
    }

    pub fn shutdown(&self) {
        // 离线证书管理也属于应用拥有的进程，退出时一并回收。
        if let Some(mut child) = self.management_child.lock().unwrap().take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        let mut slot = self.engine.lock().unwrap();
        let Some(mut engine) = slot.take() else {
            return;
        };
        // EOF 先让引擎恢复系统 PAC，进程超时才强制退出。
        engine.input.take();
        let deadline = Instant::now() + Duration::from_secs(45);
        while Instant::now() < deadline {
            if engine.child.try_wait().ok().flatten().is_some() {
                return;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        let _ = engine.child.kill();
        let _ = engine.child.wait();
    }

    fn handle(&self, action: &str, body: Option<Value>) -> Reply {
        if action == "capture_api" {
            // 桌面与网页均把单机抓包操作交给同一引擎，Rust 只负责进程与 IPC 生命周期。
            let needs_start = {
                let mut engine = self.engine.lock().unwrap();
                self.reap(&mut engine);
                engine.is_none()
            };
            if needs_start {
                match self.start(json!({})) {
                    Ok(_) => (),
                    Err(error) if error == "busy" => (),
                    Err(error) => return Err(error),
                }
            }
            let deadline = Instant::now() + Duration::from_secs(25);
            loop {
                let session = self.session.lock().unwrap();
                if session.mode != "control" {
                    return Err("busy".into());
                }
                if session.ready {
                    break;
                }
                if !session.error.is_empty() {
                    return Err(session.error.clone());
                }
                if session.exited || Instant::now() > deadline {
                    return Err("engine_unavailable".into());
                }
                drop(session);
                std::thread::sleep(Duration::from_millis(20));
            }
            return self.send(action, body.unwrap_or(json!({})));
        }
        if matches!(
            action,
            "archive_create" | "archive_import" | "archive_delete" | "archive_rename"
        ) {
            // 写操作必须走单机控制器，以同一份归档引用判断活动会话。
            return Err("forbidden".into());
        }
        if action.starts_with("archive_") {
            let active = {
                let engine = self.engine.lock().unwrap();
                if engine.is_some() {
                    self.session.lock().unwrap().archive_id.clone()
                } else {
                    String::new()
                }
            };
            let request = body.unwrap_or(json!({}));
            let result = crate::capture_storage::handle(&self.root, action, &request, &active);
            if result.is_ok() && action == "archive_delete" {
                let mut session = self.session.lock().unwrap();
                if request["session"] == session.archive_id {
                    session.archive_id.clear();
                    session.archive_status = Value::Null;
                }
            }
            return result;
        }
        match (action, body) {
            ("", None) => {
                let mut engine = self.engine.lock().unwrap();
                self.reap(&mut engine);
                let session = self.session.lock().unwrap();
                let state = match engine.as_ref() {
                    None => "stopped",
                    Some(engine) if engine.input.is_none() => "stopping",
                    Some(_) if session.ready => "running",
                    Some(_) => "starting",
                };
                Ok(
                    json!({ "state": state, "archiveID": session.archive_id, "archiveStatus": session.archive_status, "proxy": session.proxy, "mode": session.mode, "endpoint": session.endpoint, "error": session.error }),
                )
            }
            ("certificate", None) => {
                let pem = fs::read_to_string(self.root.join("mitmproxy-ca-cert.pem"))
                    .map_err(|_| "certificate_unavailable")?;
                Ok(json!({ "pem": pem }))
            }
            (id, None) => {
                let archive_id = self.session.lock().unwrap().archive_id.clone();
                let active = if self
                    .engine
                    .lock()
                    .unwrap()
                    .as_ref()
                    .is_some_and(|engine| engine.input.is_some())
                {
                    archive_id.clone()
                } else {
                    String::new()
                };
                crate::capture_storage::handle(
                    &self.root,
                    "archive_entry",
                    &json!({"session":archive_id,"id":id,"live":true}),
                    &active,
                )
            }
            ("start", Some(body)) => self.start(body),
            ("stop", Some(_)) => {
                if let Some(engine) = self.engine.lock().unwrap().as_mut() {
                    engine.input.take();
                    engine.deadline = Instant::now() + Duration::from_secs(45);
                }
                Ok(json!({}))
            }
            ("clear", Some(_)) => {
                let ready = self.session.lock().unwrap().ready;
                let running = self
                    .engine
                    .lock()
                    .unwrap()
                    .as_ref()
                    .is_some_and(|engine| engine.input.is_some());
                if ready && running {
                    self.send("clear", json!({}))?;
                }
                Ok(json!({}))
            }
            (
                "system_status"
                | "system_restore"
                | "certificate_status"
                | "certificate_install"
                | "certificate_remove",
                Some(body),
            ) => self.manage(action, body),
            (
                "connection_info" | "session_status" | "configure" | "resume" | "replay"
                | "system_enable",
                Some(body),
            ) => self.send(action, body),
            _ => Err("forbidden".into()),
        }
    }
}

impl Session {
    fn event(&mut self, value: Value) {
        if let Some(id) = value["callID"].as_str() {
            if let Some(sender) = self.pending.remove(id) {
                let result = value["error"].as_str().map_or_else(
                    || Ok(value["result"].clone()),
                    |error| Err(error.to_owned()),
                );
                let _ = sender.send(result);
            }
            return;
        }
        if value["archiveStatus"].is_object() {
            self.archive_status = value["archiveStatus"].clone();
            return;
        }
        if value["fatalError"].is_string() {
            self.error = match value["fatalError"].as_str() {
                Some(
                    code @ ("archive_failed"
                    | "system_unavailable"
                    | "existing_pac"
                    | "network_service_required"
                    | "invalid_capture_mode"
                    | "invalid_processes"
                    | "local_unavailable"
                    | "local_start_failed"
                    | "capture_cleanup_failed"),
                ) => code.into(),
                _ => "engine_unavailable".into(),
            };
            return;
        }
        if value["ready"] == true {
            self.endpoint = value["endpoint"].as_str().unwrap_or("").into();
            self.archive_id = value["archiveID"].as_str().unwrap_or("").to_owned();
            self.ready = true;
            return;
        }
    }
}

#[tauri::command]
pub async fn workbench_capture(
    service: tauri::State<'_, Arc<CaptureService>>,
    action: String,
    body: Option<Value>,
) -> Reply {
    let limit = if action == "capture_api"
        && body.as_ref().is_some_and(|body| body["action"] == "data_import")
    {
        90 * 1024 * 1024
    } else {
        1024 * 1024
    };
    if body
        .as_ref()
        .is_some_and(|body| body.to_string().len() > limit)
    {
        return Err("invalid_rules".into());
    }
    let service = service.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mutation = action == "capture_api" && body.as_ref().and_then(|value| value["action"].as_str()).is_some_and(|action|
            matches!(action, "record" | "stop" | "new_session" | "capture_settings" | "configure" | "resume" | "clear" | "replay" | "archive_delete" | "archive_rename" | "data_import"));
        let result = service.handle(&action, body);
        if result.is_ok() && mutation { crate::realtime::notify("capture"); }
        result
    })
        .await
        .map_err(|_| "engine_exited")?
}

impl Drop for CaptureService {
    fn drop(&mut self) {
        self.shutdown();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;
    use std::net::{Ipv4Addr, TcpListener, TcpStream};

    #[test]
    fn captures_real_http_through_packaged_engine() {
        let resources = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.capture-runtime");
        let root =
            std::env::temp_dir().join(format!("apirequest-capture-{}", uuid::Uuid::new_v4()));
        let mut service = CaptureService::new(root.clone(), resources);
        // 本轮测试独占随机端口，不接管正在运行的抓包入口。
        let probe = TcpListener::bind("127.0.0.1:0").unwrap();
        service.port = probe.local_addr().unwrap().port();
        drop(probe);
        let outcome = std::panic::catch_unwind(|| {
            // 首次安装也能离线准备证书，不启动抓包会话或修改系统设置。
            let info = service.handle("system_status", Some(json!({}))).unwrap();
            assert_eq!(info["certificateAvailable"], true);
            assert_eq!(info["active"], false);
            assert_eq!(service.handle("", None).unwrap()["state"], "stopped");
            assert!(
                service.handle("certificate", None).unwrap()["pem"]
                    .as_str()
                    .unwrap()
                    .contains("BEGIN CERTIFICATE")
            );
            assert!(
                service
                    .handle("archive_list", Some(json!({})))
                    .unwrap()
                    .as_array()
                    .unwrap()
                    .is_empty()
            );

            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let target = listener.local_addr().unwrap();
            let origin = std::thread::spawn(move || {
                let (mut socket, _) = listener.accept().unwrap();
                socket
                    .set_read_timeout(Some(Duration::from_secs(10)))
                    .unwrap();
                let mut request = BufReader::new(&mut socket);
                loop {
                    let mut line = String::new();
                    request.read_line(&mut line).unwrap();
                    if line == "\r\n" || line.is_empty() {
                        break;
                    }
                }
                socket
                    .write_all(
                        b"HTTP/1.1 200 OK\r\nContent-Length: 5\r\nConnection: close\r\n\r\nsmoke",
                    )
                    .unwrap();
            });
            let call = |action: &str, input: Value| {
                service
                    .handle("capture_api", Some(json!({"action":action,"input":input})))
                    .unwrap()
            };
            let initial = call("status", json!({}));
            call(
                "capture_settings",
                json!({"revision":initial["revision"],"mode":"system","systemProxy":false,"service":""}),
            );
            call("record", json!({"recording":true}));
            let deadline = Instant::now() + Duration::from_secs(25);
            loop {
                let state = call("status", json!({}));
                assert_eq!(state["error"], "");
                if state["state"] == "running" {
                    break;
                }
                assert!(Instant::now() < deadline);
                std::thread::sleep(Duration::from_millis(100));
            }
            let mut proxy = TcpStream::connect((Ipv4Addr::LOCALHOST, service.port)).unwrap();
            proxy
                .set_read_timeout(Some(Duration::from_secs(10)))
                .unwrap();
            write!(
                proxy,
                "GET http://{target}/smoke HTTP/1.1\r\nHost: {target}\r\nConnection: close\r\n\r\n"
            )
            .unwrap();
            let mut response = String::new();
            proxy.read_to_string(&mut response).unwrap();
            assert!(response.ends_with("smoke"));
            origin.join().unwrap();
            loop {
                let state = call("status", json!({}));
                let page = service
                    .handle("archive_page", Some(json!({"session":state["archiveID"]})))
                    .unwrap();
                if let Some(id) = page["entries"][0]["id"].as_str() {
                    let entry = call(
                        "archive_entry",
                        json!({"session":state["archiveID"],"id":id}),
                    );
                    if entry["responseBody"]["text"] == "smoke" {
                        assert_eq!(entry["status"], 200);
                        break;
                    }
                }
                assert!(Instant::now() < deadline);
                std::thread::sleep(Duration::from_millis(100));
            }
            assert!(
                service.handle("certificate", None).unwrap()["pem"]
                    .as_str()
                    .unwrap()
                    .contains("BEGIN CERTIFICATE")
            );
            let state = call("status", json!({}));
            let archive_id = state["archiveID"].as_str().unwrap().to_owned();
            let page = service
                .handle("archive_page", Some(json!({"session":state["archiveID"]})))
                .unwrap();
            let entry_id = page["entries"][0]["id"].as_str().unwrap().to_owned();
            service.shutdown();
            // 新建宿主实例证明归档不依赖代理进程和上一实例的内存。
            let reopened = CaptureService::new(root.clone(), PathBuf::new());
            let page = reopened
                .handle("archive_page", Some(json!({"session":archive_id})))
                .unwrap();
            assert_eq!(page["total"], 1);
            assert_eq!(page["entries"][0]["status"], 200);
            assert_eq!(page["boundary"], 1);
            assert_eq!(
                reopened
                    .handle(
                        "archive_page",
                        Some(json!({"session":archive_id,"before":0}))
                    )
                    .unwrap()["total"],
                0
            );
            let body = reopened
                .handle(
                    "archive_body",
                    Some(json!({"session":archive_id,"id":entry_id,"side":"responseBody"})),
                )
                .unwrap();
            assert_eq!(body["base64"], "c21va2U=");
            let export = root.join("export.har");
            reopened.handle("archive_export",Some(json!({"session":archive_id,"format":"har","includeBodies":true,"destination":export}))).unwrap();
            let har: Value = serde_json::from_slice(&fs::read(export).unwrap()).unwrap();
            assert_eq!(
                har["log"]["entries"][0]["response"]["content"]["text"],
                "c21va2U="
            );
        });
        service.shutdown();
        fs::remove_dir_all(root).unwrap();
        if let Err(error) = outcome {
            std::panic::resume_unwind(error);
        }
    }
}
