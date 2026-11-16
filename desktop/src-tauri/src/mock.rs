mod advanced;
mod engine;
pub(crate) mod rules;
use crate::CommandResult;
use apirequest_workbench::{StoreEntry, Workspace};
use http_body_util::{BodyExt, Full, Limited};
use hyper::{
    Request, Response, StatusCode,
    body::{Bytes, Incoming},
    header::{self, HeaderMap, HeaderName, HeaderValue},
    server::conn::http1,
    service::service_fn,
};
use hyper_util::rt::{TokioIo, TokioTimer};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use serde_json::{Value, json};
use std::{
    convert::Infallible,
    net::{Ipv4Addr, TcpListener},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tauri::State;
use time::{OffsetDateTime, format_description::well_known::Rfc3339};
use uuid::Uuid;

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Server {
    id: String,
    name: String,
    collection_id: String,
    collection_name: String,
    store_scope: String,
    delay_in_ms: u32,
    is_public: bool,
    is_active: bool,
    access_key: String,
    created_on: String,
    updated_on: String,
}

pub struct MockService {
    workspace: Arc<Workspace>,
    port: CommandResult<u16>,
    changes: Mutex<()>,
    mcp: Option<Arc<crate::mcp::McpService>>,
}

fn timestamp() -> String {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .unwrap_or_default()
}

fn read<T: DeserializeOwned>(
    db: &Workspace,
    namespace: &str,
    key: &str,
) -> CommandResult<Option<T>> {
    db.store_get("local", namespace, key)
        .map_err(|e| e.to_string())?
        .map(|v| serde_json::from_value(v).map_err(|e| e.to_string()))
        .transpose()
}

fn write(db: &Workspace, namespace: &str, key: &str, value: Value) -> CommandResult<()> {
    db.store_put(&StoreEntry {
        scope: "local".into(),
        namespace: namespace.into(),
        key: key.into(),
        value,
    })
    .map_err(|e| e.to_string())
}

impl MockService {
    pub fn start(workspace: Arc<Workspace>, mcp: Arc<crate::mcp::McpService>) -> Arc<Self> {
        Self::start_inner(workspace, Some(mcp))
    }

    fn start_inner(
        workspace: Arc<Workspace>,
        mcp: Option<Arc<crate::mcp::McpService>>,
    ) -> Arc<Self> {
        let listener = (|| {
            let port: u16 = read(&workspace, "mock", "port")?.unwrap_or(0);
            let listener =
                TcpListener::bind((Ipv4Addr::LOCALHOST, port)).map_err(|e| e.to_string())?;
            listener.set_nonblocking(true).map_err(|e| e.to_string())?;
            let port = listener.local_addr().map_err(|e| e.to_string())?.port();
            write(&workspace, "mock", "port", json!(port))?;
            Ok::<_, String>((listener, port))
        })();
        let service = Arc::new(Self {
            workspace,
            port: listener
                .as_ref()
                .map(|(_, port)| *port)
                .map_err(Clone::clone),
            changes: Mutex::new(()),
            mcp,
        });
        if let Ok((listener, port)) = listener {
            let service = service.clone();
            tauri::async_runtime::spawn(async move {
                let Ok(listener) = tokio::net::TcpListener::from_std(listener) else {
                    return;
                };
                let permits = Arc::new(tokio::sync::Semaphore::new(32));
                // 仅回环监听。连接处理与 IPC 分开，HTTP 接口只读响应，管理操作只经 IPC。
                while let Ok((socket, _)) = listener.accept().await {
                    let Ok(permit) = permits.clone().try_acquire_owned() else {
                        continue;
                    };
                    let service = service.clone();
                    tokio::spawn(async move {
                        let handler = service_fn(|request| async {
                            Ok::<_, Infallible>(service.respond(request, port).await)
                        });
                        let _ = http1::Builder::new()
                            .keep_alive(true)
                            .timer(TokioTimer::new())
                            .header_read_timeout(Duration::from_secs(5))
                            .serve_connection(TokioIo::new(socket), handler)
                            .with_upgrades()
                            .await;
                        drop(permit);
                    });
                }
            });
        }
        service
    }

    pub fn port(&self) -> CommandResult<u16> {
        self.port.clone()
    }

    fn servers(&self) -> CommandResult<Vec<Server>> {
        Ok(read(&self.workspace, "mock", "servers")?.unwrap_or_default())
    }

    async fn respond(
        self: &Arc<Self>,
        request: Request<Incoming>,
        port: u16,
    ) -> Response<rules::Body> {
        let expected_host = format!("127.0.0.1:{port}");
        if request
            .headers()
            .get(header::HOST)
            .and_then(|value| value.to_str().ok())
            != Some(&expected_host)
        {
            return plain(StatusCode::MISDIRECTED_REQUEST, "Invalid Mock host");
        }
        let path = request.uri().path();
        if path == "/mcp" {
            return match &self.mcp {
                Some(mcp) => mcp
                    .respond(request)
                    .await
                    .map(|body| body.map_err(|never| match never {}).boxed_unsync()),
                None => plain(StatusCode::SERVICE_UNAVAILABLE, "MCP unavailable"),
            };
        }
        if let Some(id) = path.strip_prefix("/docs/") {
            return match &self.mcp {
                Some(mcp) => mcp
                    .documentation(request.method(), id)
                    .await
                    .map(|body| body.map_err(|never| match never {}).boxed_unsync()),
                None => plain(StatusCode::SERVICE_UNAVAILABLE, "Documentation unavailable"),
            };
        }
        let Some((id, path)) = path
            .strip_prefix("/mock/")
            .map(|rest| rest.split_once('/').unwrap_or((rest, "")))
        else {
            return plain(StatusCode::NOT_FOUND, "Mock server not found");
        };
        let Ok(servers) = self.servers() else {
            return plain(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Mock workspace is unavailable",
            );
        };
        let Some(server) = servers
            .into_iter()
            .find(|item| item.id == id && item.collection_id.is_empty())
        else {
            return plain(StatusCode::NOT_FOUND, "Mock server not found");
        };
        if !server.is_public {
            let key = request
                .headers()
                .get("x-api-key")
                .map(HeaderValue::as_bytes)
                .unwrap_or_default();
            let expected = server.access_key.as_bytes();
            if key.len() != expected.len()
                || key
                    .iter()
                    .zip(expected)
                    .fold(0, |diff, (a, b)| diff | (a ^ b))
                    != 0
            {
                return plain(StatusCode::UNAUTHORIZED, "Mock API key required");
            }
        }

        let path = format!("/{path}");
        let query = request.uri().query().unwrap_or_default().to_owned();
        if read::<Value>(&self.workspace, "mock-rules", &server.id)
            .ok()
            .flatten()
            .is_none()
        {
            return plain(StatusCode::NOT_FOUND, "Mock service not found");
        }
        rules::respond(self, server, request, path, query).await
    }
}

fn plain(status: StatusCode, text: &'static str) -> Response<rules::Body> {
    let mut response = Response::new(rules::full(Bytes::from_static(text.as_bytes())));
    *response.status_mut() = status;
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("text/plain; charset=utf-8"),
    );
    response
}
