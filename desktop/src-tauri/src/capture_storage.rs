//! 与 Python 引擎共用归档目录，历史查询只读取索引，正文独立分块加载。
use base64::{Engine as _, engine::general_purpose::STANDARD};
use serde_json::{Value, json};
use std::{
    fs,
    io::{BufRead, BufReader, Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
};
type Reply = Result<Value, String>;
fn id(value: &Value) -> Result<&str, String> {
    value
        .as_str()
        .filter(|s| {
            !s.is_empty()
                && s.len() <= 80
                && s.bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b))
        })
        .ok_or("entry_unavailable".into())
}
fn read(path: &Path) -> Reply {
    serde_json::from_slice(&fs::read(path).map_err(|_| "entry_unavailable")?)
        .map_err(|_| "entry_unavailable".into())
}
fn write(path: &Path, value: &Value) -> Result<(), String> {
    fs::write(path, value.to_string()).map_err(|_| "archive_failed".into())
}
fn lines(folder: &Path) -> Result<impl Iterator<Item = Value>, String> {
    let file = fs::File::open(folder.join("index.jsonl")).map_err(|_| "entry_unavailable")?;
    Ok(BufReader::new(file)
        .lines()
        .map_while(Result::ok)
        .filter_map(|line| serde_json::from_str(&line).ok()))
}
fn latest_summary(folder: &Path, source: Value) -> Value {
    // 与正文分离的小摘要供实时分页读取，避免把历史预览全部载入内存。
    source["id"]
        .as_str()
        .and_then(|id| read(&folder.join(id).join("summary.json")).ok())
        .unwrap_or(source)
}
fn matches(entry: &Value, body: &Value) -> bool {
    let Some(url) = entry["url"].as_str().and_then(|s| url::Url::parse(s).ok()) else {
        return false;
    };
    let host = url.port().map_or_else(
        || url.host_str().unwrap_or("").to_owned(),
        |port| format!("{}:{port}", url.host_str().unwrap_or("")),
    );
    let content = entry["contentType"].as_str().unwrap_or("").to_lowercase();
    let search = body["search"].as_str().unwrap_or("").to_lowercase();
    let kind = body["kind"].as_str().unwrap_or("");
    // 同组按并集匹配，域名与客户端两组之间取交集；空数组表示全部。
    (body["hosts"]
        .as_array()
        .is_none_or(|values| values.is_empty() || values.contains(&json!(host))))
        && body["clients"]
            .as_array()
            .is_none_or(|values| values.is_empty() || values.contains(&entry["client"]))
        && (body["status"].as_u64().unwrap_or(0) == 0
            || body["status"].as_u64().unwrap_or(0) == entry["status"].as_u64().unwrap_or(0) / 100)
        && format!(
            "{} {} {}",
            entry["method"].as_str().unwrap_or(""),
            url,
            entry["status"]
        )
        .to_lowercase()
        .contains(&search)
        && match kind {
            "" => true,
            "SSE" => content.contains("event-stream"),
            "WebSocket" => entry["status"] == 101,
            "JSON" => content.contains("json"),
            "image" => content.starts_with("image/"),
            "HTTP2" => entry["protocol"].as_str().unwrap_or("").contains('2'),
            _ => url.scheme() == kind,
        }
}
pub fn body_path(root: &Path, body: &Value) -> Result<PathBuf, String> {
    let side = body["side"]
        .as_str()
        .filter(|s| matches!(*s, "requestBody" | "responseBody"))
        .ok_or("entry_unavailable")?;
    Ok(root
        .join("sessions")
        .join(id(&body["session"])?)
        .join(id(&body["id"])?)
        .join(format!("{side}.bin")))
}
pub fn handle(root: &Path, action: &str, body: &Value, active: &str) -> Reply {
    let sessions = root.join("sessions");
    fs::create_dir_all(&sessions).map_err(|_| "archive_failed")?;
    if action == "archive_list" {
        let mut items = Vec::new();
        for item in fs::read_dir(&sessions)
            .map_err(|_| "archive_failed")?
            .flatten()
        {
            if let Ok(mut value) = read(&item.path().join("session.json")) {
                if value["importing"] == true {
                    continue;
                }
                value["active"] = json!(value["id"] == active);
                items.push(value)
            }
        }
        items.sort_by_key(|v| std::cmp::Reverse(v["date"].as_u64().unwrap_or(0)));
        return Ok(json!(items));
    }
    if action == "archive_create" {
        let session = uuid::Uuid::new_v4().to_string();
        let folder = sessions.join(&session);
        fs::create_dir(&folder).map_err(|_| "archive_failed")?;
        let value = json!({"id":session,"name":body["name"].as_str().unwrap_or("HAR").chars().take(120).collect::<String>(),"date":std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis() as u64,"count":0,"bytes":0,"dropped":0,"active":false});
        write(&folder.join("session.json"), &value)?;
        fs::write(folder.join("index.jsonl"), "").map_err(|_| "archive_failed")?;
        return Ok(value);
    }
    let session = id(&body["session"])?;
    let folder = sessions.join(session);
    if matches!(
        action,
        "archive_delete" | "archive_rename" | "archive_import"
    ) && session == active
    {
        return Err("busy".into());
    }
    if action == "archive_delete" {
        fs::remove_dir_all(folder).map_err(|_| "archive_failed")?;
        return Ok(json!({}));
    }
    let mut manifest = read(&folder.join("session.json"))?;
    if action == "archive_rename" {
        let name = body["name"]
            .as_str()
            .unwrap_or("")
            .trim()
            .chars()
            .take(120)
            .collect::<String>();
        if name.is_empty() {
            return Err("invalid_rules".into());
        };
        manifest["name"] = json!(name);
        write(&folder.join("session.json"), &manifest)?;
        return Ok(json!({}));
    }
    if action == "archive_page" {
        let mut hosts = std::collections::BTreeSet::new();
        let mut clients = std::collections::BTreeSet::new();
        let filtered = body["hosts"]
            .as_array()
            .is_some_and(|values| !values.is_empty())
            || body["clients"]
                .as_array()
                .is_some_and(|values| !values.is_empty())
            || ["search", "kind"]
                .iter()
                .any(|key| body[key].as_str().is_some_and(|value| !value.is_empty()))
            || body["status"].as_u64().unwrap_or(0) > 0;
        let before = body["before"]
            .as_u64()
            .map(|value| value as usize)
            .unwrap_or(usize::MAX);
        let mut boundary = 0;
        let mut total = 0;
        if manifest["count"] == 0 {
            return Ok(json!({"entries":[],"total":0,"hosts":[],"clients":[]}));
        }
        for source in lines(&folder)?.take(before) {
            boundary += 1;
            let entry = if filtered {
                latest_summary(&folder, source)
            } else {
                source
            };
            if hosts.len() < 1000 {
                if let Some(url) = entry["url"].as_str().and_then(|s| url::Url::parse(s).ok()) {
                    hosts.insert(url.port().map_or_else(
                        || url.host_str().unwrap_or("").to_owned(),
                        |port| format!("{}:{port}", url.host_str().unwrap_or("")),
                    ));
                }
            }
            if clients.len() < 1000 {
                if let Some(client) = entry["client"].as_str() {
                    clients.insert(client.to_owned());
                }
            }
            if matches(&entry, body) {
                total += 1usize
            }
        }
        let offset = body["offset"].as_u64().unwrap_or(0) as usize;
        let limit = body["limit"].as_u64().unwrap_or(200).clamp(1, 500) as usize;
        let mut entries: Vec<_> = lines(&folder)?
            .take(boundary)
            .enumerate()
            .map(|(index, entry)| {
                let mut entry = if filtered {
                    latest_summary(&folder, entry)
                } else {
                    entry
                };
                entry["sequence"] = json!(index + 1);
                entry
            })
            .filter(|e| matches(e, body))
            .enumerate()
            .filter_map(|(i, e)| {
                (i >= total.saturating_sub(offset + limit) && i < total.saturating_sub(offset))
                    .then(|| {
                        if filtered {
                            e
                        } else {
                            let sequence = e["sequence"].clone();
                            let mut entry = latest_summary(&folder, e);
                            entry["sequence"] = sequence;
                            entry
                        }
                    })
            })
            .collect();
        entries.reverse();
        return Ok(
            json!({"entries":entries,"total":total,"boundary":boundary,"hosts":hosts,"clients":clients}),
        );
    }
    if action == "archive_export" {
        let destination = body["destination"]
            .as_str()
            .filter(|s| !s.is_empty())
            .ok_or("archive_failed")?;
        if body["format"] == "har" {
            let mut file = fs::File::create(destination).map_err(|_| "archive_failed")?;
            export_har(root, body, &mut file)?;
            return Ok(json!({}));
        }
        fs::copy(body_path(root, body)?, destination).map_err(|_| "archive_failed")?;
        return Ok(json!({}));
    }
    if action == "archive_import" {
        let mut entry = body["entry"].clone();
        let directory = folder.join(id(&entry["id"])?);
        fs::create_dir_all(&directory).map_err(|_| "archive_failed")?;
        entry["replayable"] = json!(false);
        entry["paused"] = Value::Null;
        for side in ["requestBody", "responseBody"] {
            let content = &entry[side];
            if content["truncated"] == false {
                let bytes = if let Some(encoded) = content["base64"].as_str() {
                    STANDARD.decode(encoded).map_err(|_| "invalid_har")?
                } else if let Some(text) = content["text"].as_str() {
                    text.as_bytes().to_vec()
                } else {
                    continue;
                };
                fs::write(directory.join(format!("{side}.bin")), &bytes)
                    .map_err(|_| "archive_failed")?;
                manifest["bytes"] =
                    json!(manifest["bytes"].as_u64().unwrap_or(0) + bytes.len() as u64);
            }
        }
        write(&directory.join("entry.json"), &entry)?;
        for key in [
            "requestBody",
            "responseBody",
            "requestHeaders",
            "responseHeaders",
            "frames",
        ] {
            entry.as_object_mut().ok_or("invalid_har")?.remove(key);
        }
        write(&directory.join("summary.json"), &entry)?;
        let mut index = fs::OpenOptions::new()
            .append(true)
            .open(folder.join("index.jsonl"))
            .map_err(|_| "archive_failed")?;
        writeln!(index, "{entry}").map_err(|_| "archive_failed")?;
        manifest["count"] = json!(manifest["count"].as_u64().unwrap_or(0) + 1);
        write(&folder.join("session.json"), &manifest)?;
        return Ok(json!({}));
    }
    let directory = folder.join(id(&body["id"])?);
    if action == "archive_entry" {
        let mut value = read(&directory.join("entry.json"))?;
        if body["live"] != true || session != active {
            value["paused"] = Value::Null;
        }
        value["replayable"] =
            json!(value["originalRequest"] == true && value["replayable"] == true);
        return Ok(value);
    }
    if action == "archive_body" {
        let mut file = fs::File::open(body_path(root, body)?).map_err(|_| "entry_unavailable")?;
        let recorded = file.metadata().map_err(|_| "archive_failed")?.len();
        let expected =
            read(&directory.join("entry.json"))?[body["side"].as_str().unwrap_or("")]["size"]
                .as_u64()
                .unwrap_or(0);
        let size = recorded.max(expected);
        let offset = body["offset"].as_u64().unwrap_or(0);
        file.seek(SeekFrom::Start(offset))
            .map_err(|_| "archive_failed")?;
        let mut bytes = vec![0; 65536];
        let count = file.read(&mut bytes).map_err(|_| "archive_failed")?;
        bytes.truncate(count);
        return Ok(
            json!({"base64":STANDARD.encode(bytes),"size":size,"next":if offset+(count as u64)<recorded{Some(offset+count as u64)}else{None}}),
        );
    }
    if action == "archive_frames" {
        let Ok(file) = fs::File::open(directory.join("frames.jsonl")) else {
            return Ok(json!({"entries":[],"next":null}));
        };
        let offset = body["offset"].as_u64().unwrap_or(0) as usize;
        let entries: Vec<Value> = BufReader::new(file)
            .lines()
            .map_while(Result::ok)
            .skip(offset)
            .take(200)
            .filter_map(|s| serde_json::from_str(&s).ok())
            .collect();
        return Ok(
            json!({"next":if entries.len()==200{Some(offset+200)}else{None},"entries":entries}),
        );
    }
    Err("forbidden".into())
}

fn export_har(root: &Path, body: &Value, output: &mut fs::File) -> Result<(), String> {
    fn put(output: &mut fs::File, text: &str) -> Result<(), String> {
        output
            .write_all(text.as_bytes())
            .map_err(|_| "archive_failed".into())
    }
    fn encode_file(output: &mut fs::File, path: &Path) -> Result<(), String> {
        let mut file = fs::File::open(path).map_err(|_| "entry_unavailable")?;
        let mut buffer = [0u8; 65535];
        let mut pending = Vec::with_capacity(65538);
        loop {
            let size = file.read(&mut buffer).map_err(|_| "archive_failed")?;
            if size == 0 {
                break;
            };
            pending.extend_from_slice(&buffer[..size]);
            let end = pending.len() - pending.len() % 3;
            put(output, &STANDARD.encode(&pending[..end]))?;
            pending.drain(..end);
        }
        if !pending.is_empty() {
            put(output, &STANDARD.encode(&pending))?
        }
        Ok(())
    }
    let folder = root.join("sessions").join(id(&body["session"])?);
    put(
        output,
        "{\"log\":{\"version\":\"1.2\",\"creator\":{\"name\":\"ApiRequest\",\"version\":\"2\"},\"entries\":[",
    )?;
    let mut first = true;
    for summary in lines(&folder)? {
        if !matches(&latest_summary(&folder, summary.clone()), body) {
            continue;
        }
        let directory = folder.join(id(&summary["id"])?);
        let entry = read(&directory.join("entry.json"))?;
        if entry["responseComplete"] != true && entry["failed"] != true {
            continue;
        }
        if !first {
            put(output, ",")?
        }
        first = false;
        let headers = |key: &str| -> Value {
            json!(
                entry[key]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .map(|pair| json!({"name":pair[0],"value":pair[1]}))
                    .collect::<Vec<_>>()
            )
        };
        let date = time::OffsetDateTime::from_unix_timestamp_nanos(
            entry["startedAt"].as_i64().unwrap_or(0) as i128 * 1_000_000,
        )
        .map_err(|_| "invalid_har")?
        .format(&time::format_description::well_known::Rfc3339)
        .map_err(|_| "invalid_har")?;
        let mut prefix=json!({"startedDateTime":date,"time":entry["elapsedMs"].as_f64().unwrap_or(0.0),"cache":{},"timings":entry["timings"]}).to_string();
        prefix.pop();
        put(output, &prefix)?;
        let mut request=json!({"method":entry["method"],"url":entry["url"],"httpVersion":entry["protocol"],"headers":headers("requestHeaders"),"cookies":[],"queryString":[],"headersSize":-1,"bodySize":entry["requestSize"].as_u64().unwrap_or(entry["requestBody"]["size"].as_u64().unwrap_or(0))}).to_string();
        request.pop();
        put(output, ",\"request\":")?;
        put(output, &request)?;
        let request_body = directory.join("requestBody.bin");
        if body["includeBodies"] == true && request_body.is_file() {
            put(
                output,
                ",\"postData\":{\"mimeType\":\"application/octet-stream\",\"_encoding\":\"base64\",\"text\":\"",
            )?;
            encode_file(output, &request_body)?;
            put(output, "\"}")?
        }
        let mut response=json!({"status":entry["status"].as_u64().unwrap_or(0),"statusText":"","httpVersion":entry["responseProtocol"].as_str().unwrap_or(entry["protocol"].as_str().unwrap_or("")),"headers":headers("responseHeaders"),"cookies":[],"redirectURL":"","headersSize":-1,"bodySize":entry["responseSize"].as_u64().unwrap_or(entry["responseBody"]["size"].as_u64().unwrap_or(0))}).to_string();
        response.pop();
        put(output, "},\"response\":")?;
        put(output, &response)?;
        let mut content=json!({"mimeType":entry["contentType"].as_str().unwrap_or(""),"size":entry["responseSize"].as_u64().unwrap_or(entry["responseBody"]["size"].as_u64().unwrap_or(0))}).to_string();
        content.pop();
        put(output, ",\"content\":")?;
        put(output, &content)?;
        let response_body = directory.join("responseBody.bin");
        if body["includeBodies"] == true && response_body.is_file() {
            put(output, ",\"encoding\":\"base64\",\"text\":\"")?;
            encode_file(output, &response_body)?;
            put(output, "\"")?
        }
        put(output, "}}")?;
        if body["includeBodies"] == true {
            if let Ok(file) = fs::File::open(directory.join("frames.jsonl")) {
                put(output, ",\"_webSocketMessages\":[")?;
                let mut first_frame = true;
                for line in BufReader::new(file).lines() {
                    let line = line.map_err(|_| "archive_failed")?;
                    if !first_frame {
                        put(output, ",")?
                    }
                    first_frame = false;
                    put(output, &line)?;
                }
                put(output, "]")?;
            }
        }
        put(output, "}")?;
    }
    put(output, "]}}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn multiple_hosts_and_clients_filter_pages_and_export() {
        let root = std::env::temp_dir().join(format!("capture-filters-{}", uuid::Uuid::new_v4()));
        let outcome = std::panic::catch_unwind(|| {
            let session =
                handle(&root, "archive_create", &json!({"name":"multi"}), "").unwrap()["id"]
                    .clone();
            for (index, host) in ["alpha.test", "beta.test", "gamma.test"].iter().enumerate() {
                for (client_index, client) in ["192.0.2.10", "198.51.100.20"].iter().enumerate() {
                    let entry = json!({"id":format!("flow-{index}-{client_index}"),"method":"GET","url":format!("https://{host}/{client_index}"),"protocol":"HTTP/1.1","startedAt":1700000000000u64,"status":200,"responseComplete":true,"requestComplete":true,"requestHeaders":[],"client":client});
                    handle(
                        &root,
                        "archive_import",
                        &json!({"session":session,"entry":entry}),
                        "",
                    )
                    .unwrap();
                }
            }
            // 域名组与客户端组内部取并集，组间取交集；筛选不能缩减可勾选的候选集合。
            for (hosts, clients, expected) in [
                (json!([]), json!([]), 6),
                (json!(["alpha.test"]), json!([]), 2),
                (json!(["alpha.test", "beta.test"]), json!([]), 4),
                (json!([]), json!(["192.0.2.10"]), 3),
                (json!([]), json!(["192.0.2.10", "198.51.100.20"]), 6),
                (json!(["alpha.test", "beta.test"]), json!(["192.0.2.10"]), 2),
            ] {
                let page = handle(
                    &root,
                    "archive_page",
                    &json!({"session":session,"hosts":hosts,"clients":clients}),
                    "",
                )
                .unwrap();
                assert_eq!(page["total"], expected);
                assert_eq!(page["entries"].as_array().unwrap().len(), expected as usize);
                assert_eq!(page["hosts"].as_array().unwrap().len(), 3);
                assert_eq!(page["clients"].as_array().unwrap().len(), 2);
                for entry in page["entries"].as_array().unwrap() {
                    let parts: Vec<_> = entry["id"].as_str().unwrap().split('-').collect();
                    let host: usize = parts[1].parse().unwrap();
                    let client: usize = parts[2].parse().unwrap();
                    assert_eq!(entry["sequence"], host * 2 + client + 1);
                }
            }
            let page = handle(
                &root,
                "archive_page",
                &json!({"session":session,"hosts":["alpha.test","beta.test"],"limit":1,"offset":1}),
                "",
            )
            .unwrap();
            assert_eq!(page["total"], 4);
            assert_eq!(page["entries"].as_array().unwrap().len(), 1);
            assert_eq!(page["entries"][0]["sequence"], 3);
            let destination = root.join("filtered.har");
            handle(&root,"archive_export",&json!({"session":session,"format":"har","destination":destination,"hosts":["alpha.test","beta.test"],"clients":["192.0.2.10"]}),"").unwrap();
            let har: Value = serde_json::from_slice(&fs::read(destination).unwrap()).unwrap();
            let entries = har["log"]["entries"].as_array().unwrap();
            assert_eq!(entries.len(), 2);
            assert!(
                entries
                    .iter()
                    .all(|entry| entry["request"]["url"].as_str().unwrap().ends_with("/0"))
            );
        });
        fs::remove_dir_all(root).unwrap();
        if let Err(error) = outcome {
            std::panic::resume_unwind(error)
        }
    }

    #[test]
    fn disk_export_preserves_body_headers_and_websocket_frames() {
        let root = std::env::temp_dir().join(format!("capture-export-{}", uuid::Uuid::new_v4()));
        let outcome = std::panic::catch_unwind(|| {
            let session =
                handle(&root, "archive_create", &json!({"name":"export"}), "").unwrap()["id"]
                    .clone();
            let entry = json!({"id":"first","method":"POST","url":"https://example.test/upload","protocol":"HTTP/1.1","startedAt":1700000000000u64,"status":200,"responseComplete":true,"requestSize":300000,"requestHeaders":(0..70).map(|i|json!([format!("X-Long-{i}"),"h".repeat(3072)])).collect::<Vec<_>>(),"frameCount":25});
            handle(
                &root,
                "archive_import",
                &json!({"session":session,"entry":entry}),
                "",
            )
            .unwrap();
            // 夹具使用引擎的归档格式，验证导出不依赖已删除的 HAR 文件导入功能。
            let directory = root
                .join("sessions")
                .join(session.as_str().unwrap())
                .join("first");
            let bytes = vec![b'x'; 300000];
            fs::write(directory.join("requestBody.bin"), &bytes).unwrap();
            let mut frames = fs::File::create(directory.join("frames.jsonl")).unwrap();
            for i in 0..25 {
                writeln!(
                    frames,
                    "{}",
                    json!({"outgoing":true,"size":12000,"text":"m".repeat(12000),"timestamp":i})
                )
                .unwrap();
            }
            drop(frames);
            let input =
                json!({"session":session,"id":"first","side":"requestBody","offset":262144});
            let tail = handle(&root, "archive_body", &input, "").unwrap();
            assert_eq!(
                STANDARD.decode(tail["base64"].as_str().unwrap()).unwrap(),
                bytes[262144..]
            );
            let frames = handle(
                &root,
                "archive_frames",
                &json!({"session":session,"id":"first"}),
                "",
            )
            .unwrap();
            assert_eq!(frames["entries"].as_array().unwrap().len(), 25);
            let path = root.join("export.har");
            handle(
                &root,
                "archive_export",
                &json!({"session":session,"format":"har","includeBodies":true,"destination":path}),
                "",
            )
            .unwrap();
            let har: Value = serde_json::from_slice(&fs::read(path).unwrap()).unwrap();
            let entry = &har["log"]["entries"][0];
            assert_eq!(entry["request"]["headers"].as_array().unwrap().len(), 70);
            assert_eq!(
                entry["request"]["headers"][69]["value"]
                    .as_str()
                    .unwrap()
                    .len(),
                3072
            );
            assert_eq!(
                entry["_webSocketMessages"][24]["text"]
                    .as_str()
                    .unwrap()
                    .len(),
                12000
            );
            assert_eq!(
                STANDARD
                    .decode(entry["request"]["postData"]["text"].as_str().unwrap())
                    .unwrap(),
                bytes
            );
        });
        fs::remove_dir_all(root).unwrap();
        if let Err(error) = outcome {
            std::panic::resume_unwind(error)
        }
    }
}
