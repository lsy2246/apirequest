use crate::CommandResult;
use http_body_util::Full;
use hyper::{Response, StatusCode, body::Bytes, server::conn::http1, service::service_fn};
use hyper_util::rt::TokioIo;
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    convert::Infallible,
    sync::{Mutex, OnceLock},
    time::Duration,
};
use url::Url;
use uuid::Uuid;

type Flows = HashMap<String, (i64, Option<std::result::Result<String, String>>)>;
static FLOWS: OnceLock<Mutex<Flows>> = OnceLock::new();
fn flows() -> &'static Mutex<Flows> {
    FLOWS.get_or_init(|| Mutex::new(HashMap::new()))
}
const LIMIT: usize = 90 * 1024 * 1024;

async fn request(body: Value) -> CommandResult<Value> {
    let url =
        Url::parse(body["url"].as_str().ok_or("无效的同步地址")?).map_err(|_| "无效的同步地址")?;
    let provider = body["provider"].as_str().unwrap_or_default();
    if !["webdav", "google"].contains(&provider)
        || !["http", "https"].contains(&url.scheme())
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
        || url.as_str().len() > 8000
    {
        return Err("无效的同步地址".into());
    }
    if provider == "google"
        && (url.scheme() != "https"
            || !["www.googleapis.com", "oauth2.googleapis.com"]
                .contains(&url.host_str().unwrap_or_default())
            || url.port().is_some())
    {
        return Err("无效的 Google API 地址".into());
    }
    let method = body["method"].as_str().unwrap_or_default();
    if !["GET", "POST", "PUT", "PATCH", "PROPFIND", "MKCOL"].contains(&method) {
        return Err("无效的同步操作".into());
    }
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(45))
        .build()
        .map_err(|_| "无法创建同步连接")?;
    let mut request = client.request(
        reqwest::Method::from_bytes(method.as_bytes()).map_err(|_| "无效的同步操作")?,
        url,
    );
    if let Some(headers) = body["headers"].as_object() {
        for (name, value) in headers {
            if ![
                "authorization",
                "content-type",
                "if-match",
                "if-none-match",
                "depth",
                "x-upload-content-type",
            ]
            .contains(&name.to_ascii_lowercase().as_str())
            {
                return Err("无效的同步请求头".into());
            }
            request = request.header(name, value.as_str().ok_or("无效的同步请求头")?);
        }
    }
    if let Some(text) = body.get("body") {
        let text = text.as_str().ok_or("无效的同步文件")?;
        if text.len() > LIMIT {
            return Err("同步文件过大".into());
        }
        request = request.body(text.to_owned());
    }
    let mut response = request
        .send()
        .await
        .map_err(|_| "同步连接失败，请检查地址、证书和网络")?;
    let status = response.status().as_u16();
    let headers: serde_json::Map<String, Value> = ["etag", "location", "content-type"]
        .into_iter()
        .filter_map(|key| {
            response
                .headers()
                .get(key)
                .and_then(|v| v.to_str().ok())
                .map(|v| (key.to_owned(), Value::String(v.to_owned())))
        })
        .collect();
    let mut data = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| "读取同步文件失败")? {
        if data.len() + chunk.len() > LIMIT {
            return Err("同步文件过大".into());
        }
        data.extend_from_slice(&chunk);
    }
    Ok(
        json!({"status":status,"headers":headers,"body":String::from_utf8(data).map_err(|_| "同步文件必须是 UTF-8")?}),
    )
}
async fn oauth_start() -> CommandResult<Value> {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|_| "无法启动 Google 授权回调")?;
    let port = listener
        .local_addr()
        .map_err(|_| "无法取得授权地址")?
        .port();
    let id = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
    {
        let mut entries = flows().lock().map_err(|_| "授权服务忙")?;
        entries.retain(|_, v| v.0 > crate::history::now());
        if entries.len() >= 3 {
            return Err("已有授权窗口，请先完成授权".into());
        }
        entries.insert(id.clone(), (crate::history::now() + 300_000, None));
    }
    let state = id.clone();
    tokio::spawn(async move {
        let task = async {
            loop {
                let Ok((stream, _)) = listener.accept().await else {
                    break;
                };
                let request_state = state.clone();
                let service = service_fn(move |request: hyper::Request<hyper::body::Incoming>| {
                    let state = request_state.clone();
                    async move {
                        let url = Url::parse(&format!("http://127.0.0.1{}", request.uri()));
                        let mut valid = false;
                        if let Ok(url) = url {
                            let values: HashMap<_, _> = url.query_pairs().into_owned().collect();
                            if request.method() == hyper::Method::GET
                                && url.path() == "/callback"
                                && values.get("state") == Some(&state)
                            {
                                let result = if let Some(code) = values.get("code") {
                                    Some(Ok(code.clone()))
                                } else if values.contains_key("error") {
                                    Some(Err("Google 授权被取消或拒绝".into()))
                                } else {
                                    None
                                };
                                if let Some(result) = result {
                                    if let Ok(mut entries) = flows().lock() {
                                        if let Some(flow) = entries.get_mut(&state) {
                                            flow.1 = Some(result);
                                            valid = true;
                                        }
                                    }
                                }
                            }
                        }
                        let mut response = Response::new(Full::new(Bytes::from(if valid {
                            "<!doctype html><meta charset=utf-8><title>API Request</title><p>授权已处理，可以关闭页面并返回 API Request。</p>"
                        } else {
                            "Invalid authorization callback"
                        })));
                        *response.status_mut() = if valid {
                            StatusCode::OK
                        } else {
                            StatusCode::BAD_REQUEST
                        };
                        response
                            .headers_mut()
                            .insert("content-type", "text/html; charset=utf-8".parse().unwrap());
                        response
                            .headers_mut()
                            .insert("cache-control", "no-store".parse().unwrap());
                        response.headers_mut().insert(
                            "content-security-policy",
                            "default-src 'none'".parse().unwrap(),
                        );
                        Ok::<_, Infallible>(response)
                    }
                });
                let _ = tokio::time::timeout(
                    Duration::from_secs(10),
                    http1::Builder::new().serve_connection(TokioIo::new(stream), service),
                )
                .await;
                if flows()
                    .lock()
                    .ok()
                    .is_none_or(|entries| entries.get(&state).is_none_or(|v| v.1.is_some()))
                {
                    break;
                }
            }
        };
        let _ = tokio::time::timeout(Duration::from_secs(300), task).await;
    });
    Ok(json!({"id":id,"redirectUri":format!("http://127.0.0.1:{port}/callback")}))
}
#[tauri::command]
pub async fn workbench_cloud(action: String, body: Value) -> CommandResult<Value> {
    match action.as_str() {
        "http" => request(body).await,
        "oauth/start" => oauth_start().await,
        "oauth/poll" => {
            let id = body["id"].as_str().ok_or("无效的授权状态")?;
            let mut entries = flows().lock().map_err(|_| "授权服务忙")?;
            let flow = entries.get(id).ok_or("授权已过期，请重新连接")?;
            if flow.0 < crate::history::now() {
                entries.remove(id);
                return Err("授权已过期，请重新连接".into());
            }
            let result = match &flow.1 {
                Some(Ok(code)) => json!({"code":code,"pending":false}),
                Some(Err(error)) => json!({"error":error,"pending":false}),
                None => json!({"pending":true}),
            };
            if flow.1.is_some() || body["cancel"] == true {
                entries.remove(id);
            }
            Ok(result)
        }
        _ => Err("未知的同步操作".into()),
    }
}
