use super::advanced;
use super::engine::*;
use super::*;
use base64::{Engine, engine::general_purpose::STANDARD as B64};
use futures_util::{SinkExt, StreamExt};
use http_body_util::{StreamBody, combinators::UnsyncBoxBody};
use hyper::body::Frame;
use std::io;
use tokio_tungstenite::{
    WebSocketStream,
    tungstenite::{
        Message,
        handshake::server::create_response,
        protocol::{CloseFrame, Role, frame::coding::CloseCode},
    },
};

pub type Body = UnsyncBoxBody<Bytes, io::Error>;
pub fn full(bytes: impl Into<Bytes>) -> Body {
    Full::new(bytes.into())
        .map_err(|never| match never {})
        .boxed_unsync()
}
pub fn plain(status: StatusCode, message: &str) -> Response<Body> {
    let mut response = Response::new(full(Bytes::copy_from_slice(message.as_bytes())));
    *response.status_mut() = status;
    response
        .headers_mut()
        .insert(header::CONTENT_TYPE, HeaderValue::from_static("text/plain"));
    response
}
fn entry(namespace: &str, key: &str, value: Value) -> StoreEntry {
    StoreEntry {
        scope: "local".into(),
        namespace: namespace.into(),
        key: key.into(),
        value,
    }
}
fn batch(
    service: &MockService,
    entries: Vec<StoreEntry>,
    remove: Vec<(String, String, String)>,
) -> CommandResult<()> {
    service
        .workspace
        .store_batch(&entries, &remove)
        .map_err(|e| e.to_string())
}
fn state(service: &MockService, id: &str) -> CommandResult<Value> {
    read::<Value>(&service.workspace, "mock-rules", id)?.ok_or("Mock service not found".into())
}
fn server_view(service: &MockService, server: &Server, state: &Value) -> CommandResult<Value> {
    let mut view = summary(state);
    view["id"] = json!(server.id);
    view["name"] = json!(server.name);
    view["isActive"] = json!(server.is_active);
    view["url"] = json!(format!(
        "http://127.0.0.1:{}/mock/{}",
        service.port()?,
        server.id
    ));
    Ok(view)
}
fn namespace(id: &str) -> String {
    format!("mock-traffic-{id}")
}
fn record(service: &MockService, id: &str, mut log: Value) -> CommandResult<()> {
    let _guard = service.changes.lock().map_err(|e| e.to_string())?;
    if !service.servers()?.iter().any(|server| server.id == id) {
        return Ok(());
    }

    let millis = OffsetDateTime::parse(text(&log, "executedAt"), &Rfc3339)
        .unwrap_or_else(|_| OffsetDateTime::now_utc())
        .unix_timestamp_nanos()
        / 1_000_000;
    let log_id = format!("{millis:016}-{}", Uuid::new_v4());
    log["id"] = json!(log_id);
    log["mockServerID"] = json!(id);
    write(&service.workspace, &namespace(id), &log_id, log)?;
    crate::realtime::notify("mock");
    Ok(())
}
fn records(service: &MockService, id: &str, skip: usize, take: usize) -> CommandResult<Vec<Value>> {
    service
        .workspace
        .store_page_without(
            "local",
            &namespace(id),
            skip,
            take,
            &[
                "$.responseBody",
                "$.requestBody",
                "$.requestHeaders",
                "$.requestQuery",
                "$.mockMatch.rawRequestBase64",
                "$.mockMatch.trace",
            ],
        )
        .map_err(|e| e.to_string())
}
fn log_removals(service: &MockService, id: &str) -> CommandResult<Vec<(String, String, String)>> {
    let mut skip = 0;
    let mut remove = Vec::new();
    loop {
        let page = records(service, id, skip, 1000)?;
        let len = page.len();
        remove.extend(
            page.iter()
                .map(|log| ("local".into(), namespace(id), text(log, "id").into())),
        );
        if len < 1000 {
            break;
        }
        skip += len;
    }
    Ok(remove)
}
fn log(service: &MockService, id: &str, log_id: &str) -> CommandResult<Value> {
    read::<Value>(&service.workspace, &namespace(id), log_id)?
        .ok_or("Mock request not found".into())
}
fn capture(log: &Value) -> CommandResult<Value> {
    use std::io::Read;
    let mut decoded = log.clone();
    let encoding = text(&log["responseHeaders"], "content-encoding");
    if !encoding.is_empty() && encoding != "identity" {
        let bytes = B64
            .decode(text(&log["responseBody"], "data"))
            .map_err(|_| bad("encoded recording"))?;
        let decoder: Box<dyn Read> = match encoding {
            "gzip" => Box::new(flate2::read::GzDecoder::new(bytes.as_slice())),
            "deflate" => Box::new(flate2::read::ZlibDecoder::new(bytes.as_slice())),
            "br" => Box::new(brotli::Decompressor::new(bytes.as_slice(), 4096)),
            _ => return Err(bad("unsupported content encoding")),
        };
        let mut bytes = Vec::new();
        decoder
            .take((MAX_BYTES + 1) as u64)
            .read_to_end(&mut bytes)
            .map_err(|_| bad("encoded recording"))?;
        if bytes.len() > MAX_BYTES {
            return Err(bad("decoded recording exceeds 10 MiB"));
        }
        decoded["responseBody"] =
            record_body(&bytes, text(&log["responseHeaders"], "content-type"));
        decoded["responseHeaders"]
            .as_object_mut()
            .unwrap()
            .remove("content-encoding");
    }
    let log = &decoded;

    if log["mockMatch"]["bodyTruncated"] == true || log["mockMatch"]["requestTruncated"] == true {
        return Err("Recording is incomplete".into());
    }
    if log["responseBody"].is_null() || number(log, "responseStatus", 0) < 200 {
        return Err("Recording has no reusable HTTP response".into());
    }
    let binary = log["responseBody"]["encoding"] == "base64";
    let mut headers = json!({});
    for (k, v) in log["responseHeaders"].as_object().into_iter().flatten() {
        if !protected(k)
            && !matches!(
                k.as_str(),
                "set-cookie"
                    | "content-disposition"
                    | "content-security-policy"
                    | "x-frame-options"
                    | "x-content-type-options"
            )
        {
            headers[k] = v.clone()
        }
    }
    let content = text(&headers, "content-type");
    let action = if binary {
        "file"
    } else if content.contains("text/event-stream") {
        "sse"
    } else {
        "http"
    };
    let file = if binary {
        json!({"name":"response.bin","contentType":if content.is_empty(){"application/octet-stream"}else{content.split(';').next().unwrap()},"data":log["responseBody"]["data"],"disposition":"inline"})
    } else {
        Value::Null
    };
    let rows = parse_rules(
        &json!([{"id":Uuid::new_v4().to_string(),"name":format!("{} {}",text(log,"requestMethod"),text(log,"requestPath")),"enabled":true,"method":log["requestMethod"],"path":log["requestPath"],"conditions":[],"exhausted":"repeat_last","steps":[{"action":action,"statusCode":log["responseStatus"],"body":if binary{"".into()}else{display(&log["responseBody"])},"headers":headers,"cookies":if log["responseHeaders"]["set-cookie"].is_array(){log["responseHeaders"]["set-cookie"].clone()}else if let Some(v)=log["responseHeaders"]["set-cookie"].as_str(){json!([v])}else{json!([])},"delayMs":0,"times":1,"intervalMs":0,"file":file}]}]),
    )?;
    Ok(rows[0].clone())
}
impl MockService {
    fn rules_command(&self, path: &str, data: Value, write_request: bool) -> CommandResult<Value> {
        let url = url::Url::parse(&format!(
            "http://mock.local/{}",
            path.trim_start_matches('/')
        ))
        .map_err(|e| e.to_string())?;
        let parts: Vec<_> = url
            .path()
            .trim_matches('/')
            .split('/')
            .filter(|v| !v.is_empty())
            .collect();
        let _lock = self.changes.lock().map_err(|e| e.to_string())?;
        let mut servers = self.servers()?;
        if parts.as_slice() == ["inspect"] && write_request {
            let current =
                json!({"revision":0,"rules":parse_rules(&data["rules"])?,"hits":{},"states":{}});
            let request = normalize(data.get("request").unwrap_or(&data))?;
            drop(_lock);
            let mut result = explain(&current, &request);
            if !result["selection"].is_null() {
                result["selection"]["step"] = advanced::preview_step(
                    &result["selection"]["step"],
                    &request,
                    &result["selection"]["params"],
                )?;
            }
            return Ok(result);
        }
        if parts.is_empty() {
            if !write_request {
                return Ok(json!(
                    servers
                        .iter()
                        .filter(|server| server.collection_id.is_empty())
                        .filter_map(|server| state(self, &server.id)
                            .ok()
                            .and_then(|state| server_view(self, server, &state).ok()))
                        .collect::<Vec<_>>()
                ));
            }
            let name = text(&data, "name").trim();
            if name.is_empty() || name.len() > 100 || name.chars().any(char::is_control) {
                return Err(bad("name"));
            }
            let kind = if data["kind"].is_null() {
                "collection"
            } else {
                text(&data, "kind")
            };
            if !matches!(kind, "single" | "collection") {
                return Err(bad("kind"));
            }
            let now = timestamp();
            let server = Server {
                id: Uuid::new_v4().simple().to_string(),
                name: name.into(),
                collection_id: String::new(),
                collection_name: name.into(),
                store_scope: "local".into(),
                delay_in_ms: 0,
                is_public: true,
                is_active: data["isActive"].as_bool().unwrap_or(true),
                access_key: Uuid::new_v4().simple().to_string(),
                created_on: now.clone(),
                updated_on: now,
            };
            let initial = if let Some(rules) = data.get("rules") {
                let rules = parse_rules(rules)?;
                if kind == "single" && rules.as_array().unwrap().len() != 1 {
                    return Err("A single Mock must contain exactly one rule".into());
                }
                rules
            } else if kind == "single" {
                parse_rules(
                    &json!([{"id":Uuid::new_v4().to_string(),"name":name,"enabled":true,"method":"GET","path":"/hello","conditions":[],"exhausted":"repeat_last","steps":[{"action":"http","intervalMs":0,"disconnectAfter":false,"times":1,"statusCode":200,"delayMs":null,"headers":{},"body":"{}"}]}]),
                )?
            } else {
                json!([])
            };
            let rules = json!({"kind":kind,"revision":0,"rules":initial,"hits":{},"states":{},"options":options(&data["options"])?});
            let result = server_view(self, &server, &rules)?;
            servers.push(server.clone());
            batch(
                self,
                vec![
                    entry("mock", "servers", json!(servers)),
                    entry("mock-rules", &server.id, rules),
                ],
                vec![],
            )?;
            crate::realtime::notify("mock");
            return Ok(result);
        }
        let id = parts[0];
        let index = servers
            .iter()
            .position(|s| s.id == id && s.collection_id.is_empty())
            .ok_or("Mock service not found")?;
        let mut current = state(self, id)?;
        let action = parts.get(1).copied().unwrap_or_default();
        if action.is_empty() {
            if !write_request {
                return Ok(current);
            }
            if data["revision"] != current["revision"] {
                return Err("Mock rules changed. Refresh before saving.".into());
            }
            let rules = parse_rules(&data["rules"])?;
            if current["kind"] == "single" && rules.as_array().unwrap().len() != 1 {
                return Err("A single Mock must contain exactly one rule".into());
            }
            current["rules"] = parse_rules(&current["rules"])?;
            let mut hits = json!({});
            for rule in rules.as_array().unwrap() {
                if let Some(old) = current["rules"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .find(|r| r["id"] == rule["id"])
                {
                    let mut old = old.clone();
                    let mut new = rule.clone();
                    old["enabled"] = json!(true);
                    new["enabled"] = json!(true);
                    if old == new {
                        if let Some(hit) = current["hits"].get(text(rule, "id")) {
                            hits[text(rule, "id")] = hit.clone()
                        }
                    }
                }
            }
            current["rules"] = rules;
            current["hits"] = hits;
            current["revision"] = json!(number(&current, "revision", 0) + 1);
            if !data["options"].is_null() {
                current["options"] = options(&data["options"])?;
            }
        } else if action == "inspect" && write_request {
            if !data["rules"].is_null() {
                current["rules"] = parse_rules(&data["rules"])?
            }
            let request = normalize(data.get("request").unwrap_or(&data))?;
            drop(_lock);
            let mut result = explain(&current, &request);
            if !result["selection"].is_null() {
                result["selection"]["step"] = advanced::preview_step(
                    &result["selection"]["step"],
                    &request,
                    &result["selection"]["params"],
                )?
            }
            return Ok(result);
        } else if action == "reset" && write_request {
            if !text(&data, "ruleID").is_empty() {
                current["hits"]
                    .as_object_mut()
                    .unwrap()
                    .remove(text(&data, "ruleID"));
            } else {
                current["hits"] = json!({});
                current["states"] = json!({})
            }
        } else if action == "status" && write_request {
            let active = data["isActive"].as_bool().ok_or_else(|| bad("status"))?;
            servers[index].is_active = active;
            write(&self.workspace, "mock", "servers", json!(servers))?;
            crate::realtime::notify("mock");
            return Ok(json!({"isActive":active}));
        } else if action == "delete" && write_request {
            servers.remove(index);
            let mut remove = log_removals(self, id)?;
            remove.push(("local".into(), "mock-rules".into(), id.into()));
            batch(self, vec![entry("mock", "servers", json!(servers))], remove)?;
            crate::realtime::notify("mock");
            return Ok(json!({"deleted":true}));
        } else if action == "logs" {
            if parts.get(2) == Some(&"clear") && write_request {
                batch(self, vec![], log_removals(self, id)?)?;
                crate::realtime::notify("mock");
                return Ok(json!({"cleared":true}));
            }
            if let Some(log_id) = parts.get(2) {
                let log = log(self, id, log_id)?;
                if parts.get(3) == Some(&"capture") && write_request {
                    return capture(&log);
                }
                return Ok(log);
            }
            let skip = url
                .query_pairs()
                .find(|(k, _)| k == "skip")
                .and_then(|(_, v)| v.parse().ok())
                .unwrap_or(0);
            return Ok(json!(records(self,id,skip,100)?.iter().map(|v|json!({"id":v["id"],"requestMethod":v["requestMethod"],"requestPath":v["requestPath"],"responseStatus":v["responseStatus"],"responseTime":v["responseTime"],"executedAt":v["executedAt"],"mockMatch":v["mockMatch"]})).collect::<Vec<_>>()));
        } else if action == "move" && write_request {
            if current["revision"] != data["revision"] {
                return Err("Mock rules changed. Refresh before moving.".into());
            }
            let rule_id = text(&data, "ruleID");
            let rule_index = current["rules"]
                .as_array()
                .unwrap()
                .iter()
                .position(|r| r["id"] == rule_id)
                .ok_or("Mock rule not found")?;
            let mut rule = current["rules"][rule_index].clone();
            let hit = current["hits"][rule_id].as_u64().unwrap_or(0);
            for step in rule["steps"].as_array_mut().unwrap() {
                if step["delayMs"].is_null() {
                    step["delayMs"] = json!(servers[index].delay_in_ms)
                }
            }
            let target_id = text(&data, "targetID");
            if target_id == id {
                return Err(bad("target ID"));
            }
            let mut target = if target_id.is_empty() {
                json!({"kind":"single","revision":0,"rules":[],"hits":{},"states":{},"options":{}})
            } else {
                state(self, target_id)?
            };
            if !target_id.is_empty()
                && (target["kind"] == "single" || target["revision"] != data["targetRevision"])
            {
                return Err("Mock destination changed. Refresh before moving.".into());
            }
            let target_rules = target["rules"].as_array_mut().unwrap();
            if target_rules.iter().any(|r| r["id"] == rule_id) {
                return Err("Duplicate rule in destination".into());
            }
            target_rules.push(rule.clone());
            target["rules"] = parse_rules(&target["rules"])?;
            target["hits"][rule_id] = json!(hit);
            target["revision"] = json!(number(&target, "revision", 0) + 1);
            let destination = if target_id.is_empty() {
                let mut server = servers[index].clone();
                server.id = Uuid::new_v4().simple().to_string();
                server.name = if text(&rule, "name").is_empty() {
                    server.name
                } else {
                    text(&rule, "name").into()
                };
                let destination = server.id.clone();
                servers.push(server);
                destination
            } else {
                target_id.to_owned()
            };
            current["rules"].as_array_mut().unwrap().remove(rule_index);
            current["hits"].as_object_mut().unwrap().remove(rule_id);
            current["revision"] = json!(number(&current, "revision", 0) + 1);
            let mut remove = Vec::new();
            if current["kind"] == "single" {
                servers.remove(index);
                remove.push(("local".into(), "mock-rules".into(), id.into()))
            }
            let mut entries = vec![
                entry("mock", "servers", json!(servers)),
                entry("mock-rules", &destination, target),
            ];
            if current["kind"] != "single" {
                entries.push(entry("mock-rules", id, current))
            }
            batch(self, entries, remove)?;
            crate::realtime::notify("mock");
            return Ok(json!({"destinationID":destination}));
        } else {
            return Err("Unknown Mock operation".into());
        }
        write(&self.workspace, "mock-rules", id, current.clone())?;
        crate::realtime::notify("mock");
        Ok(current)
    }
}

#[tauri::command]
pub async fn workbench_mock_rules(
    service: State<'_, Arc<MockService>>,
    path: String,
    data: Value,
    write: bool,
) -> CommandResult<Value> {
    dispatch(service.inner().clone(), path, data, write).await
}
async fn dispatch(
    service: Arc<MockService>,
    path: String,
    data: Value,
    write: bool,
) -> CommandResult<Value> {
    let parts: Vec<_> = path.split('/').collect();
    if write && (parts.get(1) == Some(&"test") || parts.get(3) == Some(&"replay")) {
        let id = parts.first().ok_or("Mock service not found")?;
        state(&service, id)?;
        let request = if parts.get(1) == Some(&"test") {
            normalize(data.get("request").unwrap_or(&data))?
        } else {
            let log = log(&service, id, parts.get(2).ok_or("Mock request not found")?)?;
            if log["responseStatus"] == 101 || log["mockMatch"]["requestTruncated"] == true {
                return Err("This request cannot be replayed as HTTP".into());
            }
            json!({"method":log["requestMethod"],"path":log["requestPath"],"headers":log["requestHeaders"],"query":log["requestQuery"],"body":log["requestBody"],"rawBase64":log["mockMatch"]["rawRequestBase64"]})
        };
        let mut url = url::Url::parse(&format!(
            "http://127.0.0.1:{}/mock/{id}{}",
            service.port()?,
            text(&request, "path")
        ))
        .map_err(|e| e.to_string())?;
        append_query(&mut url, &request["query"]);
        let client = reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(120))
            .build()
            .map_err(|e| e.to_string())?;
        let method = reqwest::Method::from_bytes(text(&request, "method").as_bytes())
            .map_err(|e| e.to_string())?;
        let mut call = client.request(method.clone(), url);
        for (k, v) in request["headers"].as_object().into_iter().flatten() {
            if !protected(k) {
                call = call.header(k, display(v))
            }
        }
        if !matches!(method, reqwest::Method::GET | reqwest::Method::HEAD) {
            let body = if !text(&request, "rawBase64").is_empty() {
                B64.decode(text(&request, "rawBase64"))
                    .map_err(|e| e.to_string())?
            } else if request["rawBody"].is_string() {
                text(&request, "rawBody").as_bytes().to_vec()
            } else if request["body"].is_null() {
                Vec::new()
            } else {
                display(&request["body"]).into_bytes()
            };
            call = call.body(body)
        }
        let reply = call.send().await.map_err(|e| e.to_string())?;
        let status = reply.status().as_u16();
        let headers = header_values(reply.headers());
        let mut stream = reply.bytes_stream();
        let mut body = Vec::new();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| e.to_string())?;
            if body.len() + chunk.len() > MAX_BYTES {
                return Err("Response exceeds 10 MiB".into());
            }
            body.extend_from_slice(&chunk)
        }
        return Ok(
            json!({"status":status,"headers":headers,"body":record_body(&body,text(&headers,"content-type"))}),
        );
    }
    tauri::async_runtime::spawn_blocking(move || service.rules_command(&path, data, write))
        .await
        .map_err(|e| e.to_string())?
}

fn logged_message(direction: &str, value: &str) -> Value {
    let mut end = value.len().min(65536);
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    json!({"direction":direction,"data":&value[..end],"truncated":end<value.len(),"time":timestamp()})
}
fn protected(name: &str) -> bool {
    matches!(
        name.to_ascii_lowercase().as_str(),
        "host"
            | "connection"
            | "content-length"
            | "transfer-encoding"
            | "upgrade"
            | "keep-alive"
            | "trailer"
            | "proxy-connection"
            | "te"
            | "proxy-authorization"
            | "proxy-authenticate"
    )
}
fn header_values(headers: &HeaderMap) -> Value {
    let mut result = json!({});
    for (key, value) in headers {
        if let Ok(value) = value.to_str() {
            if key == header::SET_COOKIE {
                if result["set-cookie"].is_null() {
                    result["set-cookie"] = json!([]);
                }
                result["set-cookie"]
                    .as_array_mut()
                    .unwrap()
                    .push(json!(value));
            } else {
                result[key.as_str()] = json!(value);
            }
        }
    }
    result
}
fn append_query(url: &mut url::Url, query: &Value) {
    for (k, v) in query.as_object().into_iter().flatten() {
        if let Some(a) = v.as_array() {
            for v in a {
                url.query_pairs_mut().append_pair(k, &display(v));
            }
        } else {
            url.query_pairs_mut().append_pair(k, &display(v));
        }
    }
}
fn apply_headers(response: &mut Response<Body>, headers: &Value) {
    let nominated = text(headers, "connection")
        .split(',')
        .map(|v| v.trim().to_ascii_lowercase())
        .collect::<Vec<_>>();
    for (k, v) in headers.as_object().into_iter().flatten() {
        if protected(k)
            || nominated.contains(&k.to_lowercase())
            || matches!(
                k.to_lowercase().as_str(),
                "set-cookie"
                    | "content-disposition"
                    | "content-security-policy"
                    | "x-frame-options"
                    | "x-content-type-options"
            )
        {
            continue;
        }
        if let (Ok(name), Ok(value)) = (
            HeaderName::from_bytes(k.as_bytes()),
            HeaderValue::from_str(&display(v)),
        ) {
            response.headers_mut().append(name, value);
        }
    }
}
fn finish_headers(response: &mut Response<Body>) {
    response.headers_mut().insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    response.headers_mut().insert(
        header::CONTENT_SECURITY_POLICY,
        HeaderValue::from_static("default-src 'none'; sandbox"),
    );
    let content = response
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("text/plain")
        .split(';')
        .next()
        .unwrap_or_default()
        .to_lowercase();
    if matches!(
        content.as_str(),
        "text/html"
            | "text/xml"
            | "text/javascript"
            | "text/xsl"
            | "application/javascript"
            | "application/xhtml+xml"
            | "application/xml"
            | "image/svg+xml"
    ) || content.ends_with("+xml")
    {
        response
            .headers_mut()
            .insert(header::CONTENT_TYPE, HeaderValue::from_static("text/plain"));
    }
}
fn stream_body(receiver: tokio::sync::mpsc::Receiver<Result<Frame<Bytes>, io::Error>>) -> Body {
    StreamBody::new(futures_util::stream::unfold(
        receiver,
        |mut receiver| async move { receiver.recv().await.map(|item| (item, receiver)) },
    ))
    .boxed_unsync()
}
pub(super) async fn respond(
    service: &Arc<MockService>,
    server: Server,
    mut raw: Request<Incoming>,
    path: String,
    query: String,
) -> Response<Body> {
    let started = Instant::now();
    let executed = timestamp();
    let headers = header_values(raw.headers());
    let ws = raw
        .headers()
        .get(header::UPGRADE)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.eq_ignore_ascii_case("websocket"));
    let upgrade = if ws {
        Some(hyper::upgrade::on(&mut raw))
    } else {
        None
    };
    let handshake = if ws {
        let mut handshake = hyper::http::Request::builder()
            .method(raw.method())
            .uri(raw.uri())
            .body(())
            .unwrap();
        *handshake.headers_mut() = raw.headers().clone();
        match create_response(&handshake) {
            Ok(mut response) => {
                if let Some(protocol) = raw
                    .headers()
                    .get("sec-websocket-protocol")
                    .and_then(|v| v.to_str().ok())
                    .and_then(|v| v.split(',').next())
                {
                    if let Ok(value) = HeaderValue::from_str(protocol.trim()) {
                        response
                            .headers_mut()
                            .insert("sec-websocket-protocol", value);
                    }
                }
                Some(response)
            }
            Err(_) => return plain(StatusCode::BAD_REQUEST, "Invalid WebSocket handshake"),
        }
    } else {
        None
    };
    let method = raw.method().to_string();
    let body = match tokio::time::timeout(
        Duration::from_secs(15),
        Limited::new(raw.into_body(), 20 * 1024 * 1024).collect(),
    )
    .await
    {
        Ok(Ok(body)) => body.to_bytes(),
        _ => {
            return plain(
                StatusCode::PAYLOAD_TOO_LARGE,
                "Mock request body is too large or timed out",
            );
        }
    };
    let request = match normalize(
        &json!({"method":method,"path":format!("{path}{}",if query.is_empty(){String::new()}else{format!("?{query}")}),"headers":headers,"body":serde_json::from_slice::<Value>(&body).unwrap_or_else(|_|json!(String::from_utf8_lossy(&body))),"protocol":if ws{"websocket"}else{"http"}}),
    ) {
        Ok(r) => r,
        Err(_) => return plain(StatusCode::BAD_REQUEST, "Invalid Mock request"),
    };
    let result = (|| -> CommandResult<(Value, Value)> {
        let _guard = service.changes.lock().map_err(|e| e.to_string())?;
        let active = service
            .servers()?
            .into_iter()
            .any(|s| s.id == server.id && s.is_active);
        if !active {
            return Err("Mock server stopped".into());
        }
        let mut state = state(service, &server.id)?;
        let result = explain(&state, &request);
        if !result["selection"].is_null() {
            advance(&mut state, &result["selection"]);
            write(&service.workspace, "mock-rules", &server.id, state.clone())?;
        }
        Ok((state, result))
    })();
    let (state, result) = match result {
        Ok(value) => value,
        Err(_) => {
            return plain(
                StatusCode::SERVICE_UNAVAILABLE,
                "Mock service is unavailable",
            );
        }
    };
    let selection = &result["selection"];
    let raw_step = render_step(&selection["step"], &request, &selection["params"]);
    let original_action = text(&raw_step, "action").to_owned();
    let step = match advanced::resolve(raw_step, request.clone(), selection["params"].clone()).await
    {
        Ok(step) => step,
        Err(error) => {
            let response = plain(StatusCode::BAD_GATEWAY, &error);
            let _ = record(
                service,
                &server.id,
                json!({"requestMethod":method,"requestPath":path,"requestHeaders":request["headers"],"requestQuery":request["query"],"responseStatus":502,"responseBody":error,"responseTime":started.elapsed().as_millis() as u64,"executedAt":executed,"mockMatch":{"action":original_action,"ruleID":selection["rule"]["id"],"trace":result["trace"]}}),
            );
            return response;
        }
    };
    let action = text(&step, "action");
    let mut meta = if selection.is_null() {
        json!({"unmatched":true})
    } else {
        json!({"ruleID":selection["rule"]["id"],"name":selection["rule"]["name"],"hit":selection["hit"],"step":selection["stepNumber"],"action":original_action})
    };
    meta["trace"] = result["trace"].clone();
    meta["requestTruncated"] = json!(body.len() > MAX_BYTES);
    if body.len() <= MAX_BYTES {
        meta["rawRequestBase64"] = json!(B64.encode(&body));
    }
    let mut log = json!({"requestMethod":method,"requestPath":path,"requestHeaders":headers,"requestBody":if body.len()<=MAX_BYTES{request["body"].clone()}else{Value::Null},"requestQuery":request["query"],"responseStatus":0,"responseHeaders":{},"responseBody":null,"responseTime":0,"executedAt":executed,"mockMatch":meta});
    let delay = step["delayMs"]
        .as_u64()
        .unwrap_or(server.delay_in_ms.into());
    if delay > 0 {
        tokio::time::sleep(Duration::from_millis(delay)).await;
    }
    if action == "websocket" {
        let Some(upgrade) = upgrade else {
            return plain(StatusCode::BAD_REQUEST, "WebSocket upgrade required");
        };
        let Some(handshake) = handshake else {
            return plain(StatusCode::BAD_REQUEST, "WebSocket handshake required");
        };
        let mut response = handshake.map(|_| full(Bytes::new()));
        for value in advanced::cookie_values(&step, &format!("/mock/{}", server.id)) {
            if let Ok(value) = HeaderValue::from_str(&value) {
                response.headers_mut().append(header::SET_COOKIE, value);
            }
        }

        let service = service.clone();
        let params = selection["params"].clone();
        tokio::spawn(async move {
            let Ok(socket) = upgrade.await else { return };
            let mut socket = WebSocketStream::from_raw_socket(
                TokioIo::new(socket),
                Role::Server,
                Some(
                    tokio_tungstenite::tungstenite::protocol::WebSocketConfig::default()
                        .max_message_size(Some(1024 * 1024))
                        .max_frame_size(Some(1024 * 1024)),
                ),
            )
            .await;
            let config = &step["websocket"];
            let interval = number(&step, "intervalMs", 0);
            let template = step["template"] == true;
            let mut messages = Vec::new();
            async fn send(
                socket: &mut WebSocketStream<TokioIo<hyper::upgrade::Upgraded>>,
                values: &Value,
                interval: u64,
                template: bool,
                request: &Value,
                params: &Value,
                message: &str,
                messages: &mut Vec<Value>,
            ) -> Result<(), tokio_tungstenite::tungstenite::Error> {
                for (index, value) in values.as_array().into_iter().flatten().enumerate() {
                    if index > 0 && interval > 0 {
                        tokio::time::sleep(Duration::from_millis(interval)).await;
                    }
                    let binary = value["type"] == "binary";
                    let data = if binary {
                        text(value, "data").to_owned()
                    } else {
                        display(value)
                    };
                    let value = if template {
                        render(
                            &data,
                            request,
                            params,
                            &json!({"message":message,"messageBase64":message}),
                        )
                    } else {
                        data
                    };
                    if binary {
                        let bytes = B64.decode(&value).map_err(|_| {
                            tokio_tungstenite::tungstenite::Error::Io(io::Error::new(
                                io::ErrorKind::InvalidData,
                                "Invalid binary message Base64",
                            ))
                        })?;
                        socket.send(Message::Binary(bytes.clone().into())).await?;
                        if messages.len() < 200 {
                            messages.push(json!({"direction":"sent","binary":true,"encoding":"base64","data":B64.encode(&bytes[..bytes.len().min(65536)]),"truncated":bytes.len()>65536,"time":OffsetDateTime::now_utc().unix_timestamp_nanos()/1000000}));
                        }
                    } else {
                        socket.send(Message::Text(value.clone().into())).await?;
                        if messages.len() < 200 {
                            messages.push(logged_message("sent", &value));
                        }
                    }
                }
                Ok(())
            }
            let mut failed = send(
                &mut socket,
                &config["messages"],
                interval,
                template,
                &request,
                &params,
                "",
                &mut messages,
            )
            .await
            .is_err();
            let close = CloseFrame {
                code: CloseCode::from(number(config, "closeCode", 1000) as u16),
                reason: "".into(),
            };
            if step["disconnectAfter"] == true {
                let _ = socket.close(Some(close.clone())).await;
            } else {
                while !failed {
                    let Some(Ok(message)) = socket.next().await else {
                        break;
                    };
                    match message {
                        frame @ (Message::Text(_) | Message::Binary(_)) => {
                            let binary = matches!(frame, Message::Binary(_));
                            let bytes = match frame {
                                Message::Text(v) => v.as_bytes().to_vec(),
                                Message::Binary(v) => v.to_vec(),
                                _ => unreachable!(),
                            };
                            let value = if binary {
                                B64.encode(&bytes)
                            } else {
                                String::from_utf8_lossy(&bytes).into_owned()
                            };
                            if messages.len() < 200 {
                                if binary {
                                    messages.push(json!({"direction":"received","binary":true,"encoding":"base64","data":B64.encode(&bytes[..bytes.len().min(65536)]),"truncated":bytes.len()>65536,"time":OffsetDateTime::now_utc().unix_timestamp_nanos()/1000000}));
                                } else {
                                    messages.push(logged_message("received", &value));
                                }
                            }
                            let matcher =
                                config["matchers"]
                                    .as_array()
                                    .into_iter()
                                    .flatten()
                                    .find(|m| {
                                        let kind = m["type"].as_str().unwrap_or("text");
                                        (kind == "any"
                                            || kind == if binary { "binary" } else { "text" })
                                            && (m["operator"] == "any"
                                                || if binary && m["operator"] == "contains" {
                                                    B64.decode(text(m, "value")).is_ok_and(
                                                        |needle| {
                                                            needle.is_empty()
                                                                || bytes
                                                                    .windows(needle.len())
                                                                    .any(|v| v == needle)
                                                        },
                                                    )
                                                } else {
                                                    compare(
                                                        Some(&json!(value)),
                                                        text(m, "operator"),
                                                        text(m, "value"),
                                                    )
                                                })
                                    });
                            if let Some(matcher) = matcher {
                                failed = send(
                                    &mut socket,
                                    &matcher["replies"],
                                    interval,
                                    template,
                                    &request,
                                    &params,
                                    &value,
                                    &mut messages,
                                )
                                .await
                                .is_err();
                                if matcher["close"] == true {
                                    let _ = socket.close(Some(close.clone())).await;
                                    break;
                                }
                            }
                        }
                        Message::Close(_) => {
                            let _ = socket.close(None).await;
                            break;
                        }
                        Message::Ping(value) => {
                            let _ = socket.send(Message::Pong(value)).await;
                        }
                        _ => {}
                    }
                }
            }
            log["responseStatus"] = json!(101);
            log["responseBody"] = json!(messages);
            log["responseTime"] = json!(started.elapsed().as_millis() as u64);
            let _ = record(&service, &server.id, log);
        });
        return response;
    }
    let forward = if action == "forward" {
        step["forward"].clone()
    } else if selection.is_null() {
        state["options"]["fallback"].clone()
    } else {
        Value::Null
    };
    if !forward.is_null() {
        let depth = number(&headers, "x-apirequest-mock-hop", 0);
        let depth = text(&headers, "x-apirequest-mock-hop")
            .parse::<u64>()
            .unwrap_or(depth);
        if depth >= 3 {
            return plain(StatusCode::LOOP_DETECTED, "Mock forwarding loop detected");
        }
        let mut target = match url::Url::parse(text(&forward, "url")) {
            Ok(v) => v,
            Err(_) => return plain(StatusCode::BAD_GATEWAY, "Invalid upstream URL"),
        };
        let rewrite = if text(&forward, "path").is_empty() {
            path.clone()
        } else {
            render(
                text(&forward, "path"),
                &request,
                &selection["params"],
                &Value::Null,
            )
        };
        if !rewrite.starts_with('/')
            || rewrite.starts_with("//")
            || rewrite.contains(['\r', '\n', '#'])
        {
            return plain(StatusCode::BAD_GATEWAY, "Invalid upstream path");
        }
        let rewritten = url::Url::parse(&format!("http://mock.local{rewrite}")).unwrap();
        target.set_path(&format!(
            "{}{}",
            target.path().trim_end_matches('/'),
            rewritten.path()
        ));
        for (k, v) in rewritten.query_pairs() {
            target.query_pairs_mut().append_pair(&k, &v);
        }
        if forward["preserveQuery"] != false {
            append_query(&mut target, &request["query"])
        }
        let client = match reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_millis(number(&forward, "timeoutMs", 30000)))
            .build()
        {
            Ok(v) => v,
            Err(_) => return plain(StatusCode::BAD_GATEWAY, "Cannot initialize proxy"),
        };
        let upstream_method = if text(&forward, "method").is_empty() {
            method.as_str()
        } else {
            text(&forward, "method")
        };
        let upstream_method =
            reqwest::Method::from_bytes(upstream_method.as_bytes()).unwrap_or(reqwest::Method::GET);
        let mut call = client.request(upstream_method, target.clone());
        let removed = forward["removeHeaders"]
            .as_array()
            .cloned()
            .unwrap_or_default();
        let nominated = text(&headers, "connection")
            .split(',')
            .map(|v| v.trim().to_lowercase())
            .collect::<Vec<_>>();
        for (k, v) in headers.as_object().into_iter().flatten() {
            if !protected(k)
                && k != "x-api-key"
                && k != "x-apirequest-mock-hop"
                && !removed
                    .iter()
                    .any(|v| v.as_str().is_some_and(|v| v.eq_ignore_ascii_case(k)))
                && !nominated.contains(&k.to_lowercase())
            {
                call = call.header(k, display(v));
            }
        }
        for (k, v) in forward["headers"].as_object().into_iter().flatten() {
            if k.eq_ignore_ascii_case("x-apirequest-mock-hop") {
                continue;
            }
            call = call.header(
                k,
                render(
                    v.as_str().unwrap_or_default(),
                    &request,
                    &selection["params"],
                    &Value::Null,
                ),
            )
        }
        call = call
            .header("x-apirequest-mock-hop", (depth + 1).to_string())
            .body(body);
        let reply = match call.send().await {
            Ok(v) => v,
            Err(error) => {
                let status = if error.is_timeout() {
                    StatusCode::GATEWAY_TIMEOUT
                } else {
                    StatusCode::BAD_GATEWAY
                };
                log["responseStatus"] = json!(status.as_u16());
                let mut message = error.to_string();
                let mut cause = std::error::Error::source(&error);
                while let Some(error) = cause {
                    message.push_str(": ");
                    message.push_str(&error.to_string());
                    cause = error.source();
                }
                log["responseBody"] = json!(message);
                log["responseTime"] = json!(started.elapsed().as_millis() as u64);
                let _ = record(service, &server.id, log);
                return plain(status, "Mock upstream request failed");
            }
        };
        let status = reply.status();
        let response_headers = header_values(reply.headers());
        let (sender, receiver) = tokio::sync::mpsc::channel(4);
        let mut response = Response::new(stream_body(receiver));
        *response.status_mut() = status;
        apply_headers(&mut response, &response_headers);
        for value in advanced::cookie_values(
            &json!({"cookies":response_headers["set-cookie"]}),
            &format!("/mock/{}", server.id),
        )
        .into_iter()
        .chain(advanced::cookie_values(
            &step,
            &format!("/mock/{}", server.id),
        )) {
            if let Ok(value) = HeaderValue::from_str(&value) {
                response.headers_mut().append(header::SET_COOKIE, value);
            }
        }
        finish_headers(&mut response);
        log["responseStatus"] = json!(status.as_u16());
        log["responseHeaders"] = header_values(response.headers());
        log["mockMatch"]["upstream"] = json!(target.as_str());
        let recording = state["options"]["recording"] == true;
        log["mockMatch"]["recorded"] = json!(recording);
        let service = service.clone();
        tokio::spawn(async move {
            let mut stream = reply.bytes_stream();
            let mut captured = Vec::new();
            let mut truncated = false;
            while let Some(chunk) = stream.next().await {
                match chunk {
                    Ok(chunk) => {
                        if recording {
                            let remaining = MAX_BYTES - captured.len();
                            if chunk.len() > remaining {
                                truncated = true;
                            }
                            captured.extend_from_slice(&chunk[..chunk.len().min(remaining)]);
                        }
                        if sender.send(Ok(Frame::data(chunk))).await.is_err() {
                            truncated = true;
                            break;
                        }
                    }
                    Err(error) => {
                        truncated = true;
                        let _ = sender.send(Err(io::Error::other(error.to_string()))).await;
                        break;
                    }
                }
            }
            if recording {
                log["responseBody"] = if !text(&response_headers, "content-encoding").is_empty() {
                    json!({"encoding":"base64","data":B64.encode(&captured)})
                } else {
                    record_body(&captured, text(&response_headers, "content-type"))
                };
            }
            log["mockMatch"]["bodyTruncated"] = json!(truncated);
            log["responseTime"] = json!(started.elapsed().as_millis() as u64);
            let _ = record(&service, &server.id, log);
        });
        return response;
    }
    if action == "disconnect" {
        log["responseTime"] = json!(started.elapsed().as_millis() as u64);
        let _ = record(service, &server.id, log);
        let (sender, receiver) = tokio::sync::mpsc::channel(1);
        let _ = sender.try_send(Err(io::Error::other("Mock disconnected")));
        return Response::new(stream_body(receiver));
    }
    if action == "sse" {
        let (sender, receiver) = tokio::sync::mpsc::channel(1);
        let mut response = Response::new(stream_body(receiver));
        *response.status_mut() = StatusCode::OK;
        apply_headers(&mut response, &step["headers"]);
        for value in advanced::cookie_values(&step, &format!("/mock/{}", server.id)) {
            if let Ok(value) = HeaderValue::from_str(&value) {
                response.headers_mut().append(header::SET_COOKIE, value);
            }
        }

        response.headers_mut().insert(
            header::CONTENT_TYPE,
            HeaderValue::from_static("text/event-stream; charset=utf-8"),
        );
        response
            .headers_mut()
            .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-cache"));
        finish_headers(&mut response);
        log["responseStatus"] = json!(200);
        log["responseHeaders"] = header_values(response.headers());
        let service = service.clone();
        tokio::spawn(async move {
            let mut sent = String::new();
            let mut incomplete = false;
            if method != "HEAD" {
                for (index, event) in events(text(&step, "body")).iter().enumerate() {
                    if index > 0 && number(&step, "intervalMs", 0) > 0 {
                        tokio::time::sleep(Duration::from_millis(number(&step, "intervalMs", 0)))
                            .await;
                    }
                    let data = format!("{event}\n\n");
                    if sender
                        .send(Ok(Frame::data(Bytes::from(data.clone()))))
                        .await
                        .is_err()
                    {
                        incomplete = true;
                        break;
                    }
                    sent.push_str(&data);
                }
            }
            if step["disconnectAfter"] == true {
                let _ = sender
                    .send(Err(io::Error::other("Mock SSE disconnected")))
                    .await;
            }
            log["responseBody"] = json!(sent);
            log["mockMatch"]["bodyTruncated"] = json!(incomplete);
            log["responseTime"] = json!(started.elapsed().as_millis() as u64);
            let _ = record(&service, &server.id, log);
        });
        return response;
    }
    let status = if selection.is_null() {
        StatusCode::NOT_FOUND
    } else {
        StatusCode::from_u16(number(&step, "statusCode", 200) as u16).unwrap_or(StatusCode::OK)
    };
    let bytes = if selection.is_null() {
        b"No matching Mock rule".to_vec()
    } else if action == "file" {
        B64.decode(text(&step["file"], "data")).unwrap_or_default()
    } else {
        text(&step, "body").as_bytes().to_vec()
    };
    let no_body = method == "HEAD" || [204, 205, 304].contains(&status.as_u16());
    let mut response = Response::new(full(if no_body { Vec::new() } else { bytes.clone() }));
    *response.status_mut() = status;
    apply_headers(&mut response, &step["headers"]);
    for value in advanced::cookie_values(&step, &format!("/mock/{}", server.id)) {
        if let Ok(value) = HeaderValue::from_str(&value) {
            response.headers_mut().append(header::SET_COOKIE, value);
        }
    }

    if action == "file" {
        let file = &step["file"];
        if let Ok(value) = HeaderValue::from_str(text(file, "contentType")) {
            response.headers_mut().insert(header::CONTENT_TYPE, value);
        }
        let filename = text(file, "name")
            .chars()
            .map(|c| {
                if c.is_ascii_graphic() && c != '"' && c != '\\' {
                    c
                } else {
                    '_'
                }
            })
            .collect::<String>();
        let encoded = url::form_urlencoded::byte_serialize(text(file, "name").as_bytes())
            .collect::<String>()
            .replace('+', "%20");
        let content = text(file, "contentType");
        let disposition = if content == "text/html" || content.ends_with("xml") {
            "attachment"
        } else {
            text(file, "disposition")
        };
        if let Ok(value) = HeaderValue::from_str(&format!(
            "{disposition}; filename=\"{filename}\"; filename*=UTF-8''{encoded}"
        )) {
            response
                .headers_mut()
                .insert(header::CONTENT_DISPOSITION, value);
        }
    }
    if !response.headers().contains_key(header::CONTENT_TYPE) {
        response.headers_mut().insert(
            header::CONTENT_TYPE,
            HeaderValue::from_static(if serde_json::from_slice::<Value>(&bytes).is_ok() {
                "application/json"
            } else {
                "text/plain"
            }),
        );
    }
    finish_headers(&mut response);
    log["responseStatus"] = json!(status.as_u16());
    log["responseHeaders"] = header_values(response.headers());
    log["responseBody"] = if no_body {
        json!("")
    } else {
        record_body(&bytes, text(&log["responseHeaders"], "content-type"))
    };
    log["responseTime"] = json!(started.elapsed().as_millis() as u64);
    let _ = record(service, &server.id, log);
    response
}

#[cfg(test)]
mod tests {
    use super::*;
    fn rule(id: &str, patch: Value) -> Value {
        let mut value = json!({"id":id,"name":id,"enabled":true,"method":"GET","path":"/users/:id","conditions":[],"exhausted":"repeat_last","steps":[{"action":"http","statusCode":200,"body":"{}","headers":{},"times":1,"delayMs":0,"intervalMs":0}]});
        for (k, v) in patch.as_object().into_iter().flatten() {
            value[k] = v.clone()
        }
        value
    }
    fn test_state(rules: Value) -> Value {
        json!({"kind":"collection","revision":0,"rules":parse_rules(&rules).unwrap(),"hits":{},"states":{},"options":{}})
    }
    #[test]
    fn creates_configured_rules_atomically_and_previews_without_persisting() {
        let root = std::env::temp_dir().join(format!("apirequest-draft-tests-{}", Uuid::new_v4()));
        let service = MockService::start_inner(Arc::new(Workspace::open(&root).unwrap()), None);
        let rules = json!([rule("rule-0001", json!({"path":"/saved"}))]);
        let preview = service
            .rules_command(
                "inspect",
                json!({"rules":rules,"request":{"path":"/saved"}}),
                true,
            )
            .unwrap();
        assert_eq!(preview["selection"]["rule"]["id"], "rule-0001");
        assert_eq!(
            service.rules_command("", json!({}), false).unwrap(),
            json!([])
        );
        assert!(
            service
                .rules_command(
                    "",
                    json!({"name":"invalid","kind":"single","rules":[]}),
                    true
                )
                .is_err()
        );
        assert_eq!(
            service.rules_command("", json!({}), false).unwrap(),
            json!([])
        );
        let created = service
            .rules_command(
                "",
                json!({"name":"Saved","kind":"single","rules":rules}),
                true,
            )
            .unwrap();
        let saved = state(&service, text(&created, "id")).unwrap();
        assert_eq!(saved["rules"][0]["path"], "/saved");
        assert_eq!(saved["revision"], 0);
        assert_eq!(saved["hits"], json!({}));
        let _ = std::fs::remove_dir_all(root);
    }
    #[test]
    fn advanced_structure_secure_and_script_workflows() {
        let schema = json!({"source":"body","operator":"json_schema","key":"$","value":json!({"type":"object","required":["items"],"properties":{"items":{"type":"array","minItems":1,"items":{"type":"integer","minimum":5}}}}).to_string()});
        assert!(advanced::matches_structure(&schema, &json!({"items":[10]})));
        assert!(!advanced::matches_structure(&schema, &json!({"items":[2]})));
        let query =
            json!({"operator":"jsonpath","key":"$..items[?(@.price > 10)].id","value":"premium"});
        assert!(advanced::matches_structure(
            &query,
            &json!({"order":{"items":[{"id":"premium","price":20}]}})
        ));
        let xml =
            json!("<o:orders xmlns:o=\"urn:orders\"><o:order id=\"7\">paid</o:order></o:orders>");
        assert!(advanced::matches_structure(
            &json!({"operator":"xpath","key":"/o:orders/o:order/@id","value":"7","namespaces":{"o":"urn:orders"}}),
            &xml
        ));
        assert!(!advanced::matches_structure(
            &json!({"operator":"xpath","key":"boolean(//missing)","value":""}),
            &xml
        ));
        let state = test_state(json!([rule("rule-0001", json!({"secure":true}))]));
        assert!(
            explain(
                &state,
                &normalize(&json!({"path":"/users/7","secure":false})).unwrap()
            )["selection"]
                .is_null()
        );
        assert!(
            !explain(
                &state,
                &normalize(&json!({"path":"/users/7","secure":true})).unwrap()
            )["selection"]
                .is_null()
        );
        let value=advanced::script("let total=0;for(const n of request.body.items)total+=n;function tax(n){return n>10?2:0;}return {body:{id:request.params.id,total:total+tax(total),host:typeof process}};",&json!({"body":{"items":[5,10]}}),&json!({"id":"7"}),1000).unwrap();
        assert_eq!(
            value,
            json!({"body":{"id":"7","total":17,"host":"undefined"}})
        );
        assert!(advanced::script("while(true){}", &json!({}), &json!({}), 20).is_err());
        assert_eq!(
            advanced::cookie_values(
                &json!({"cookies":["access_token=demo; Path=/; Domain=example.com; HttpOnly"]}),
                "/mock/server"
            ),
            vec!["access_token=demo; HttpOnly; Path=/mock/server"]
        );
    }
    #[tokio::test]
    async fn serves_script_callback_cookies_and_binary_websocket() {
        let root =
            std::env::temp_dir().join(format!("apirequest-advanced-tests-{}", Uuid::new_v4()));
        let service = MockService::start_inner(Arc::new(Workspace::open(&root).unwrap()), None);
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let upstream = tokio::spawn(async move {
            while let Ok((socket, _)) = listener.accept().await {
                tokio::spawn(async move {
                    let _=http1::Builder::new().serve_connection(TokioIo::new(socket),service_fn(|req:Request<Incoming>|async move{let bytes=req.into_body().collect().await.unwrap().to_bytes();let context:Value=serde_json::from_slice(&bytes).unwrap();Ok::<_,Infallible>(Response::new(Full::new(Bytes::from(json!({"statusCode":202,"body":{"callback":true,"id":context["params"]["id"]}}).to_string()))))})).await;
                });
            }
        });
        let script = json!({"action":"script","script":{"code":"return {statusCode:201,body:{id:request.params.id,total:request.body.items.reduce((a,b)=>a+b,0)},cookies:['session=new; HttpOnly','old=; Max-Age=0']};","timeoutMs":1000},"headers":{},"times":1,"delayMs":0});
        let callback = json!({"action":"callback","callback":{"url":format!("http://127.0.0.1:{port}"),"headers":{},"timeoutMs":1000},"headers":{},"times":1,"delayMs":0});
        let binary = json!({"action":"websocket","websocket":{"messages":[{"type":"binary","data":"AP8="}],"matchers":[{"type":"binary","operator":"equals","value":"AQI=","replies":[{"type":"binary","data":"AwQ="}],"close":true}],"closeCode":1000},"headers":{},"times":1,"delayMs":0});
        let created=service.rules_command("",json!({"name":"Advanced","kind":"collection","rules":[rule("rule-script",json!({"method":"POST","path":"/orders/:id","secure":false,"steps":[script]})),rule("rule-callback",json!({"path":"/callback/:id","steps":[callback]})),rule("rule-binary",json!({"path":"/binary","steps":[binary]}))]}),true).unwrap();
        let url = text(&created, "url");
        let client = reqwest::Client::builder().no_proxy().build().unwrap();
        let mut servers = service.servers().unwrap();
        let mut legacy = servers[0].clone();
        legacy.id = "removed-example".into();
        legacy.collection_id = "old-collection".into();
        servers.push(legacy.clone());
        write(&service.workspace, "mock", "servers", json!(servers)).unwrap();
        write(
            &service.workspace,
            "mock-rules",
            &legacy.id,
            state(&service, text(&created, "id")).unwrap(),
        )
        .unwrap();
        assert_eq!(
            service
                .rules_command("", json!({}), false)
                .unwrap()
                .as_array()
                .unwrap()
                .len(),
            1
        );
        assert!(service.rules_command(&legacy.id, json!({}), false).is_err());
        assert_eq!(
            client
                .get(format!(
                    "http://127.0.0.1:{}/mock/{}/callback/9",
                    service.port().unwrap(),
                    legacy.id
                ))
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::NOT_FOUND
        );
        assert!(
            service
                .servers()
                .unwrap()
                .iter()
                .any(|server| server.id == legacy.id)
        );
        let response = client
            .post(format!("{url}/orders/7"))
            .json(&json!({"items":[5,10]}))
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::CREATED);
        assert_eq!(
            response
                .headers()
                .get_all(header::SET_COOKIE)
                .iter()
                .count(),
            2
        );
        assert!(
            response
                .headers()
                .get(header::SET_COOKIE)
                .unwrap()
                .to_str()
                .unwrap()
                .contains(&format!("Path=/mock/{}", text(&created, "id")))
        );
        assert_eq!(
            response.json::<Value>().await.unwrap(),
            json!({"id":"7","total":15})
        );
        let response = client
            .get(format!("{url}/callback/9"))
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::ACCEPTED);
        assert_eq!(
            response.json::<Value>().await.unwrap(),
            json!({"callback":true,"id":"9"})
        );
        let (mut socket, _) =
            tokio_tungstenite::connect_async(format!("{}/binary", url.replacen("http:", "ws:", 1)))
                .await
                .unwrap();
        let first = socket.next().await.unwrap().unwrap();
        assert!(first.is_binary());
        assert_eq!(first.into_data().as_ref(), &[0, 255]);
        socket
            .send(Message::Binary(vec![1, 2].into()))
            .await
            .unwrap();
        let reply = socket.next().await.unwrap().unwrap();
        assert!(reply.is_binary());
        assert_eq!(reply.into_data().as_ref(), &[3, 4]);
        let _ = socket.next().await;
        tokio::time::sleep(Duration::from_millis(20)).await;
        upstream.abort();
        let _ = std::fs::remove_dir_all(root);
    }
    #[test]
    fn matches_priority_expiry_and_typed_templates() {
        let state = test_state(json!([
            rule("rule-0001", json!({})),
            rule(
                "rule-0002",
                json!({"priority":10,"steps":[{"action":"http","statusCode":201,"body":"{\"id\":\"{{path.id}}\",\"name\":\"{{body.name}}\",\"active\":\"{{body.active}}\",\"a\":\"{{uuid}}\",\"b\":\"{{uuid}}\"}","template":true,"headers":{},"times":1,"delayMs":0}]})
            ),
            rule(
                "rule-0003",
                json!({"priority":20,"expiresAt":"2020-01-01T00:00:00Z"})
            )
        ]));
        let request =
            normalize(&json!({"path":"/users/10","body":{"name":"a\"\nb","active":false}}))
                .unwrap();
        let result = explain(&state, &request);
        assert_eq!(result["selection"]["rule"]["id"], "rule-0002");
        assert_eq!(result["trace"][0]["reasons"][0]["code"], "expired");
        let step = render_step(
            &result["selection"]["step"],
            &request,
            &result["selection"]["params"],
        );
        let value: Value = serde_json::from_str(text(&step, "body")).unwrap();
        assert_eq!(value["name"], "a\"\nb");
        assert_eq!(value["active"], false);
        assert_eq!(value["a"], value["b"]);
        assert_eq!(state["hits"], json!({}));
    }
    #[test]
    fn shares_scenario_state_and_matches_nested_conditions() {
        let mut state = test_state(json!([
            rule(
                "rule-0001",
                json!({"path":"/login","scenario":{"name":"session","requiredState":"STARTED","nextState":"ready"}})
            ),
            rule(
                "rule-0002",
                json!({"path":"/users/**","pathMode":"glob","scenario":{"name":"session","requiredState":"ready","nextState":""},"conditions":[{"source":"body","key":"$","operator":"json_contains","value":"{\"users\":[{\"role\":\"admin\"}]}"},{"source":"query","key":"tag","operator":"contains","value":"blue"}]})
            )
        ]));
        let request=normalize(&json!({"path":"/users/a/b?tag=red&tag=blue","body":{"users":[{"id":1,"role":"admin"}]}})).unwrap();
        assert!(explain(&state, &request)["selection"].is_null());
        let login = explain(&state, &normalize(&json!({"path":"/login"})).unwrap());
        advance(&mut state, &login["selection"]);
        assert_eq!(
            explain(&state, &request)["selection"]["rule"]["id"],
            "rule-0002"
        );
    }
    #[test]
    fn rejects_invalid_patterns_and_incomplete_capture() {
        assert!(safe_regex("/(a+)+$").is_err());
        assert!(forward(&json!({"url":"file:///etc/passwd"})).is_err());
        assert!(parse_rules(&json!([rule("rule-0001",json!({"steps":[{"action":"file","times":1,"statusCode":200,"headers":{},"delayMs":0,"file":{"name":"file.bin","contentType":"application/octet-stream","data":"!!!!","disposition":"inline"}}]}))])).is_err());
        assert!(capture(&json!({"responseStatus":200,"responseBody":"ok","mockMatch":{"bodyTruncated":true}})).is_err());
    }
    #[test]
    fn decodes_compressed_recordings() {
        use std::io::Write;
        let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
        encoder.write_all(b"hello").unwrap();
        let bytes = encoder.finish().unwrap();
        let rule=capture(&json!({"requestMethod":"GET","requestPath":"/compressed","responseStatus":200,"responseHeaders":{"content-type":"text/plain","content-encoding":"gzip"},"responseBody":{"encoding":"base64","data":B64.encode(bytes)}})).unwrap();
        assert_eq!(rule["steps"][0]["body"], "hello");
        assert!(
            rule["steps"][0]["headers"]
                .get("content-encoding")
                .is_none()
        );
    }
    #[tokio::test]
    async fn serves_rules_streams_websocket_and_persists_progress() {
        let root = std::env::temp_dir().join(format!("apirequest-mock-tests-{}", Uuid::new_v4()));
        let workspace = Arc::new(Workspace::open(&root).unwrap());
        let service = MockService::start_inner(workspace.clone(), None);
        let server = service
            .rules_command(
                "",
                json!({"name":"Network workflow","kind":"collection"}),
                true,
            )
            .unwrap();
        let id = text(&server, "id");
        let base = text(&server, "url");
        let rules = json!([
            rule(
                "rule-http",
                json!({"path":"/users/:id","steps":[{"action":"http","template":true,"statusCode":201,"body":"{\"id\":\"{{path.id}}\"}","headers":{"content-type":"application/json"},"times":1,"delayMs":0}]})
            ),
            rule(
                "rule-stream",
                json!({"path":"/events","steps":[{"action":"sse","statusCode":200,"body":"data: one\n\ndata: two","headers":{},"times":1,"delayMs":0,"intervalMs":5}]})
            ),
            rule(
                "rule-socket",
                json!({"path":"/chat","steps":[{"action":"websocket","headers":{},"times":1,"delayMs":0,"intervalMs":0,"websocket":{"messages":["connected"],"matchers":[{"operator":"equals","value":"ping","replies":["pong"],"close":true}],"closeCode":1000}}]})
            )
        ]);
        service
            .rules_command(id, json!({"revision":0,"rules":rules}), true)
            .unwrap();
        let client = reqwest::Client::new();
        let response = client.get(format!("{base}/users/7")).send().await.unwrap();
        assert_eq!(response.status(), 201);
        assert_eq!(response.json::<Value>().await.unwrap(), json!({"id":"7"}));
        let response = client.get(format!("{base}/events")).send().await.unwrap();
        assert_eq!(
            response.headers()[header::CONTENT_TYPE],
            "text/event-stream; charset=utf-8"
        );
        assert_eq!(response.text().await.unwrap(), "data: one\n\ndata: two\n\n");
        let (mut socket, _) =
            tokio_tungstenite::connect_async(format!("{}/chat", base.replacen("http:", "ws:", 1)))
                .await
                .unwrap();
        assert_eq!(
            socket.next().await.unwrap().unwrap().into_text().unwrap(),
            "connected"
        );
        socket.send(Message::Text("ping".into())).await.unwrap();
        assert_eq!(
            socket.next().await.unwrap().unwrap().into_text().unwrap(),
            "pong"
        );
        let _ = socket.next().await;
        tokio::time::sleep(Duration::from_millis(20)).await;
        let saved = state(&service, id).unwrap();
        assert_eq!(saved["hits"]["rule-http"], 1);
        assert_eq!(saved["hits"]["rule-socket"], 1);
        let records = records(&service, id, 0, 100).unwrap();
        let http = records
            .iter()
            .find(|v| v["requestPath"] == "/users/7")
            .unwrap();
        assert_eq!(
            capture(&log(&service, id, text(http, "id")).unwrap()).unwrap()["steps"][0]["statusCode"],
            201
        );
        service
            .rules_command(&format!("{id}/reset"), json!({}), true)
            .unwrap();
        assert_eq!(state(&service, id).unwrap()["hits"], json!({}));
        let reopened = Workspace::open(&root).unwrap();
        assert_eq!(
            read::<Value>(&reopened, "mock-rules", id).unwrap().unwrap()["revision"],
            1
        );
        service
            .rules_command(&format!("{id}/delete"), json!({}), true)
            .unwrap();
        assert!(self::records(&service, id, 0, 100).unwrap().is_empty());
        record(
            &service,
            id,
            json!({"executedAt":timestamp(),"responseStatus":200}),
        )
        .unwrap();
        assert!(self::records(&service, id, 0, 100).unwrap().is_empty());
        let _ = std::fs::remove_dir_all(root);
    }
    #[tokio::test]
    async fn forwards_records_replays_and_captures_binary_responses() {
        let root = std::env::temp_dir().join(format!("apirequest-proxy-tests-{}", Uuid::new_v4()));
        let workspace = Arc::new(Workspace::open(&root).unwrap());
        let service = MockService::start_inner(workspace, None);
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let upstream = tokio::spawn(async move {
            while let Ok((socket, _)) = listener.accept().await {
                tokio::spawn(async move {
                    let outcome=http1::Builder::new().serve_connection(TokioIo::new(socket),service_fn(|request:Request<Incoming>|async move{let path=request.uri().to_string();let custom=request.headers().get("x-custom").and_then(|v|v.to_str().ok()).unwrap_or_default().to_owned();let bytes=request.into_body().collect().await.unwrap().to_bytes();let binary=path.starts_with("/binary");let mut response=Response::new(Full::new(if binary{Bytes::from_static(&[0,255,128,1])}else{Bytes::from(json!({"path":path,"custom":custom,"body":String::from_utf8_lossy(&bytes)}).to_string())}));*response.status_mut()=StatusCode::CREATED;response.headers_mut().insert(header::CONTENT_TYPE,HeaderValue::from_static(if binary{"application/octet-stream"}else{"application/json"}));Ok::<_,Infallible>(response)})).await;
                    if let Err(error) = outcome {
                        eprintln!("Test upstream connection: {error:?}");
                    }
                });
            }
        });
        let server = service
            .rules_command("", json!({"name":"Proxy","kind":"collection"}), true)
            .unwrap();
        let id = text(&server, "id");
        let base = text(&server, "url");
        let rule = rule(
            "proxy-rule",
            json!({"method":"POST","path":"/proxy","steps":[{"action":"forward","headers":{},"times":1,"delayMs":0,"forward":{"url":format!("http://127.0.0.1:{port}"),"path":"/echo","headers":{"x-custom":"override"},"removeHeaders":[],"timeoutMs":30000,"preserveQuery":true}}]}),
        );
        service.rules_command(id,json!({"revision":0,"rules":[rule],"options":{"recording":true,"fallback":{"url":format!("http://127.0.0.1:{port}"),"headers":{},"removeHeaders":[],"timeoutMs":30000,"preserveQuery":true}}}),true).unwrap();
        let client = reqwest::Client::new();
        let response = client
            .post(format!("{base}/proxy?tag=a&tag=b"))
            .header("cookie", "session=abc")
            .header("X-Count", "11")
            .body("hello")
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), 201);
        let response = response.json::<Value>().await.unwrap();
        assert_eq!(
            response,
            json!({"path":"/echo?tag=a&tag=b","custom":"override","body":"hello"})
        );
        let binary = client
            .get(format!("{base}/binary"))
            .send()
            .await
            .unwrap()
            .bytes()
            .await
            .unwrap();
        assert_eq!(binary.as_ref(), &[0, 255, 128, 1]);
        tokio::time::sleep(Duration::from_millis(10)).await;
        let records = records(&service, id, 0, 100).unwrap();
        let proxy_log = records
            .iter()
            .find(|v| v["requestPath"] == "/proxy")
            .unwrap();
        let binary_log = records
            .iter()
            .find(|v| v["requestPath"] == "/binary")
            .unwrap();
        let replay = dispatch(
            service.clone(),
            format!("{id}/logs/{}/replay", text(proxy_log, "id")),
            json!({}),
            true,
        )
        .await
        .unwrap();
        assert_eq!(replay["status"], 201);
        assert_eq!(
            serde_json::from_str::<Value>(text(&replay, "body")).unwrap()["body"],
            "hello"
        );
        let captured = capture(&log(&service, id, text(binary_log, "id")).unwrap()).unwrap();
        assert_eq!(
            captured["steps"][0]["file"]["data"],
            B64.encode([0, 255, 128, 1])
        );
        let current = state(&service, id).unwrap();
        service
            .rules_command(
                id,
                json!({"revision":current["revision"],"rules":[captured],"options":{}}),
                true,
            )
            .unwrap();
        upstream.abort();
        assert_eq!(
            client
                .get(format!("{base}/binary"))
                .send()
                .await
                .unwrap()
                .bytes()
                .await
                .unwrap()
                .as_ref(),
            &[0, 255, 128, 1]
        );
        let _ = std::fs::remove_dir_all(root);
    }
}
