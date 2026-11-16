use crate::CommandResult;
use apirequest_workbench::{StoreEntry, Workspace};
use http_body_util::{BodyExt, Full, Limited};
use hyper::{
    Method, Request, Response, StatusCode,
    body::{Bytes, Incoming},
    header,
};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::{AppHandle, Emitter, State};
use tokio::sync::oneshot;
use uuid::Uuid;

const VERSION: &str = "2025-11-25";
const TOKEN_LIFETIME: i64 = 90 * 86_400_000;
const MAX_INPUT: usize = 1_048_576;
const ENTITIES: &[&str] = &[
    "collection",
    "request",
    "environment",
    "documentation",
    "automation",
    "load_test",
    "websocket",
];

type Reply = Result<Value, String>;

pub struct McpService {
    app: AppHandle,
    database: Arc<Workspace>,
    pending: Mutex<HashMap<String, oneshot::Sender<Reply>>>,
}

fn hash(token: &[u8]) -> String {
    format!("{:x}", Sha256::digest(token))
}

fn equal(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0, |acc, (x, y)| acc | (x ^ y)) == 0
}

impl McpService {
    pub fn new(app: AppHandle, database: Arc<Workspace>) -> Arc<Self> {
        Arc::new(Self {
            app,
            database,
            pending: Mutex::new(HashMap::new()),
        })
    }

    fn credential(&self) -> CommandResult<Value> {
        self.database
            .store_get("local", "mcp-access", "credential")
            .map(|v| v.unwrap_or(Value::Null))
            .map_err(|e| e.to_string())
    }

    fn active(credential: &Value) -> bool {
        credential["expiresAt"]
            .as_i64()
            .is_some_and(|at| at > crate::history::now())
    }

    pub async fn respond(&self, request: Request<Incoming>) -> Response<Full<Bytes>> {
        // 回环监听仍需拒绝网页 Origin，防止浏览器借 DNS 重绑定访问本机。
        if request.headers().contains_key(header::ORIGIN) {
            return response(StatusCode::FORBIDDEN, None);
        }
        let Ok(credential) = self.credential() else {
            return response(StatusCode::SERVICE_UNAVAILABLE, None);
        };
        let token = request
            .headers()
            .get(header::AUTHORIZATION)
            .and_then(|value| value.as_bytes().strip_prefix(b"Bearer "));
        if !Self::active(&credential)
            || !token.is_some_and(|token| {
                credential["digest"]
                    .as_str()
                    .is_some_and(|digest| equal(digest.as_bytes(), hash(token).as_bytes()))
            })
        {
            return response(StatusCode::UNAUTHORIZED, None);
        }
        if request.method() != Method::POST {
            return response(StatusCode::METHOD_NOT_ALLOWED, None);
        }
        let version = request.headers().get("mcp-protocol-version");
        if version.is_some_and(|v| v.as_bytes() != VERSION.as_bytes()) {
            return response(StatusCode::BAD_REQUEST, None);
        }
        let body = match tokio::time::timeout(
            Duration::from_secs(10),
            Limited::new(request.into_body(), MAX_INPUT).collect(),
        )
        .await
        {
            Ok(Ok(body)) => body.to_bytes(),
            Ok(Err(_)) => return response(StatusCode::PAYLOAD_TOO_LARGE, None),
            Err(_) => return response(StatusCode::REQUEST_TIMEOUT, None),
        };
        let Ok(message) = serde_json::from_slice::<Value>(&body) else {
            return rpc_error(Value::Null, -32700, "Invalid JSON");
        };
        let id = message["id"].clone();
        if message["jsonrpc"] != "2.0" || !message["method"].is_string() {
            return rpc_error(id, -32600, "Invalid request");
        }
        let method = message["method"].as_str().unwrap_or_default();
        if id.is_null() && method.starts_with("notifications/") {
            return response(StatusCode::ACCEPTED, None);
        }
        if !id.is_number() && !id.is_string() {
            return rpc_error(Value::Null, -32600, "Invalid request id");
        }
        let result = match method {
            "initialize" => json!({"protocolVersion":VERSION,"capabilities":{"tools":{}},
                "serverInfo":{"name":"apirequest","version":env!("CARGO_PKG_VERSION")},
                "instructions":"Use workbench_help first. Read freely, propose writes. The owner controls whether changes need approval. When approval is off, all new changes, including deletions and documentation changes, apply immediately and are recorded. These tools never run requests."}),
            "ping" => json!({}),
            "tools/list" => json!({"tools":tools()}),
            "tools/call" => {
                let name = message["params"]["name"].as_str().unwrap_or_default();
                if ![
                    "workbench_help",
                    "workbench_list",
                    "workbench_get",
                    "workbench_propose_change",
                    "workbench_change_status",
                ]
                .contains(&name)
                {
                    return rpc_error(id, -32602, "Unknown tool");
                }
                let args = message["params"]["arguments"]
                    .as_object()
                    .cloned()
                    .unwrap_or_default();
                match self.call(name, args.into()).await {
                    Ok(result) => {
                        json!({"content":[{"type":"text","text":result.to_string()}],"isError":false})
                    }
                    Err(error) => json!({"content":[{"type":"text","text":error}],"isError":true}),
                }
            }
            _ => return rpc_error(id, -32601, "Unknown method"),
        };
        response(
            StatusCode::OK,
            Some(json!({"jsonrpc":"2.0","id":id,"result":result})),
        )
    }

    pub async fn documentation(&self, method: &Method, id: &str) -> Response<Full<Bytes>> {
        if method != Method::GET || Uuid::parse_str(id).is_err() {
            return response(StatusCode::NOT_FOUND, None);
        }
        match self.call("read_local_document", json!({"id":id})).await {
            Ok(Value::String(text)) => Response::builder()
                .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
                .header(header::CACHE_CONTROL, "no-store")
                .header("x-content-type-options", "nosniff")
                .body(Full::new(Bytes::from(text)))
                .unwrap_or_default(),
            _ => response(StatusCode::NOT_FOUND, None),
        }
    }

    async fn call(&self, name: &str, args: Value) -> Reply {
        let id = Uuid::new_v4().to_string();
        let (send, receive) = oneshot::channel();
        {
            let mut pending = self.pending.lock().map_err(|e| e.to_string())?;
            if pending.len() >= 16 {
                return Err("Too many simultaneous calls".into());
            }
            pending.insert(id.clone(), send);
        }
        let event = self.app.emit(
            "workbench-mcp-call",
            json!({"id":id,"name":name,"args":args}),
        );
        let result = if event.is_ok() {
            tokio::time::timeout(Duration::from_secs(15), receive)
                .await
                .ok()
                .and_then(|result| result.ok())
                .unwrap_or_else(|| Err("Workbench did not answer".into()))
        } else {
            Err("Workbench is unavailable".into())
        };
        if let Ok(mut pending) = self.pending.lock() {
            pending.remove(&id);
        }
        result
    }
}

fn response(status: StatusCode, body: Option<Value>) -> Response<Full<Bytes>> {
    let mut builder = Response::builder().status(status);
    if body.is_some() {
        builder = builder.header(header::CONTENT_TYPE, "application/json");
    }
    if status == StatusCode::METHOD_NOT_ALLOWED {
        builder = builder.header(header::ALLOW, "POST");
    }
    builder
        .body(Full::new(
            body.map(|v| Bytes::from(v.to_string())).unwrap_or_default(),
        ))
        .unwrap_or_default()
}

fn rpc_error(id: Value, code: i32, message: &str) -> Response<Full<Bytes>> {
    response(
        StatusCode::OK,
        Some(json!({"jsonrpc":"2.0","id":id,"error":{"code":code,"message":message}})),
    )
}

fn tools() -> Vec<Value> {
    let entity = json!({"type":"string","enum":ENTITIES});
    let string = json!({"type":"string"});
    [
        ("workbench_help","Read available entities, editable fields and the approval process.",json!({}),vec![]),
        ("workbench_list","List configuration IDs. Secrets are masked.",json!({"entity":entity,"limit":{"type":"integer","minimum":1,"maximum":100},"offset":{"type":"integer","minimum":0}}),vec!["entity"]),
        ("workbench_get","Read one configuration by ID.",json!({"entity":entity,"id":string}),vec!["entity","id"]),
        ("workbench_propose_change","Submit a change and check its status. The owner can allow all new changes to apply immediately, including deletions and documentation changes.",json!({"entity":entity,"operation":{"enum":["create","update","delete"]},"id":string,"data":{"type":"object"},"reason":string,"idempotencyKey":string}),vec!["entity","operation","reason","idempotencyKey"]),
        ("workbench_change_status","Read proposal status.",json!({"proposalID":string}),vec!["proposalID"]),
    ].into_iter().map(|(name,description,properties,required)| json!({
        "name":name,"description":description,"inputSchema":{"type":"object","properties":properties,"required":required,"additionalProperties":false},
        "annotations":{"readOnlyHint":name!="workbench_propose_change"}
    })).collect()
}

#[tauri::command]
pub fn workbench_mcp_access(
    service: State<'_, Arc<McpService>>,
    mock: State<'_, Arc<crate::mock::MockService>>,
    enabled: Option<bool>,
) -> CommandResult<Value> {
    let Some(enabled) = enabled else {
        return Ok(json!({"enabled":McpService::active(&service.credential()?)}));
    };
    let port = mock.port()?;
    let token = enabled.then(|| format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple()));
    let value = token.as_ref().map(|token| json!({"digest":hash(token.as_bytes()),"expiresAt":crate::history::now()+TOKEN_LIFETIME})).unwrap_or(Value::Null);
    service
        .database
        .store_put(&StoreEntry {
            scope: "local".into(),
            namespace: "mcp-access".into(),
            key: "credential".into(),
            value,
        })
        .map_err(|error| error.to_string())?;
    crate::realtime::notify("ai");
    Ok(match token {
        Some(token) => json!({"enabled":true,"mcpServers":{"apirequest":{
            "url":format!("http://127.0.0.1:{port}/mcp"),
            "headers":{"Authorization":format!("Bearer {token}")}
        }}}),
        None => json!({"enabled":false}),
    })
}

#[tauri::command]
pub fn workbench_mcp_reply(
    service: State<'_, Arc<McpService>>,
    id: String,
    value: Option<Value>,
    error: Option<String>,
) -> CommandResult<()> {
    if let Some(send) = service
        .pending
        .lock()
        .map_err(|e| e.to_string())?
        .remove(&id)
    {
        let _ = send.send(error.map_or_else(|| Ok(value.unwrap_or(Value::Null)), Err));
    }
    Ok(())
}

#[tauri::command]
pub fn workbench_documentation_url(
    service: State<'_, Arc<crate::mock::MockService>>,
    id: String,
) -> CommandResult<String> {
    let id = Uuid::parse_str(&id).map_err(|error| error.to_string())?;
    Ok(format!("http://127.0.0.1:{}/docs/{id}", service.port()?))
}
