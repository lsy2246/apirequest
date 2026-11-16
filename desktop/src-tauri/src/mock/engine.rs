use super::advanced;
use super::*;
use base64::{Engine, engine::general_purpose::STANDARD as B64};
use regex::Regex;
use std::collections::HashMap;

pub const MAX_BYTES: usize = 10 * 1024 * 1024;
pub fn text<'a>(value: &'a Value, key: &str) -> &'a str {
    value[key].as_str().unwrap_or_default()
}
pub fn number(value: &Value, key: &str, default: u64) -> u64 {
    value[key].as_u64().unwrap_or(default)
}
pub fn bad(message: &str) -> String {
    format!("Invalid Mock field: {message}")
}
fn check(value: bool, message: &str) -> CommandResult<()> {
    if value { Ok(()) } else { Err(bad(message)) }
}
fn bounded(value: &Value, key: &str, max: usize) -> CommandResult<String> {
    let s = value[key].as_str().ok_or_else(|| bad(key))?;
    check(s.len() <= max, key)?;
    Ok(s.to_owned())
}
fn bounded_number(value: &Value, key: &str, min: u64, max: u64) -> CommandResult<()> {
    let n = value[key].as_u64().ok_or_else(|| bad(key))?;
    check(n >= min && n <= max, key)
}
pub fn safe_regex(pattern: &str) -> CommandResult<Regex> {
    check(pattern.len() <= 256, "regular expression")?;
    let unsafe_pattern = Regex::new(r"\(\?|\\[1-9]|[+*?}]\s*[+*?{]|\)[+*{?]").unwrap();
    check(!unsafe_pattern.is_match(pattern), "regular expression")?;
    Regex::new(pattern).map_err(|_| bad("regular expression"))
}
pub fn forward(value: &Value) -> CommandResult<Value> {
    let url = bounded(value, "url", 2000)?;
    let parsed = url::Url::parse(&url).map_err(|_| bad("upstream URL"))?;
    check(
        matches!(parsed.scheme(), "http" | "https")
            && parsed.username().is_empty()
            && parsed.password().is_none()
            && parsed.fragment().is_none(),
        "upstream URL",
    )?;
    let mut result = value.clone();
    if !result.is_object() {
        return Err(bad("forward"));
    }
    if result["headers"].is_null() {
        result["headers"] = json!({})
    }
    headers(&result["headers"], true)?;
    if result["removeHeaders"].is_null() {
        result["removeHeaders"] = json!([])
    }
    check(
        result["removeHeaders"].as_array().is_some_and(|a| {
            a.len() <= 50 && a.iter().all(|v| v.as_str().is_some_and(|s| s.len() <= 100))
        }),
        "removed headers",
    )?;
    if result["timeoutMs"].is_null() {
        result["timeoutMs"] = json!(30000)
    }
    bounded_number(&result, "timeoutMs", 100, 120000)?;
    if result["path"].is_null() {
        result["path"] = json!("")
    }
    let path = bounded(&result, "path", 2000)?;
    check(
        path.is_empty()
            || path.starts_with('/')
                && !path.starts_with("//")
                && !path.contains(['\r', '\n', '#']),
        "forward path",
    )?;
    if result["method"].is_null() {
        result["method"] = json!("")
    }
    check(
        matches!(
            text(&result, "method"),
            "" | "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS"
        ),
        "forward method",
    )?;
    result["preserveQuery"] = json!(result["preserveQuery"] != false);
    Ok(result)
}
fn headers(value: &Value, request: bool) -> CommandResult<()> {
    let obj = value.as_object().ok_or_else(|| bad("headers"))?;
    for (key, v) in obj {
        let name = HeaderName::from_bytes(key.as_bytes()).map_err(|_| bad("header name"))?;
        let value = v.as_str().ok_or_else(|| bad("header value"))?;
        check(
            value.len() <= 8192 && HeaderValue::from_str(value).is_ok(),
            "header value",
        )?;
        check(
            !matches!(
                name.as_str(),
                "host"
                    | "connection"
                    | "content-length"
                    | "transfer-encoding"
                    | "upgrade"
                    | "keep-alive"
                    | "trailer"
                    | "proxy-connection"
            ) && (request
                || !matches!(
                    name.as_str(),
                    "set-cookie"
                        | "content-disposition"
                        | "content-security-policy"
                        | "x-content-type-options"
                        | "x-frame-options"
                )),
            "protected header",
        )?;
    }
    Ok(())
}
pub fn options(value: &Value) -> CommandResult<Value> {
    let mut result = json!({"recording":value["recording"]==true});
    if !text(&value["fallback"], "url").is_empty() {
        result["fallback"] = forward(&value["fallback"])?;
    }
    Ok(result)
}
pub fn parse_rules(input: &Value) -> CommandResult<Value> {
    let rows = input.as_array().ok_or_else(|| bad("rules"))?;
    check(rows.len() <= 1000, "rule count")?;
    let mut ids = std::collections::HashSet::new();
    let mut file_bytes = 0;
    let mut rules = Vec::new();
    for raw in rows {
        let mut rule = raw.clone();
        let id = bounded(&rule, "id", 64)?;
        check(
            id.len() >= 8
                && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
                && ids.insert(id),
            "rule ID",
        )?;
        bounded(&rule, "name", 100)?;
        let path = bounded(&rule, "path", 1000)?;
        if rule["pathMode"].is_null() {
            rule["pathMode"] = json!("template")
        }
        check(
            matches!(
                text(&rule, "pathMode"),
                "template" | "exact" | "glob" | "regex"
            ),
            "path mode",
        )?;
        if text(&rule, "pathMode") == "regex" {
            safe_regex(&path)?;
        } else {
            check(
                path.starts_with('/')
                    && !path.contains(['?', '#'])
                    && !path.chars().any(char::is_whitespace),
                "path",
            )?;
        }
        if rule["priority"].is_null() {
            rule["priority"] = json!(0)
        }
        check(
            rule["priority"]
                .as_i64()
                .is_some_and(|n| (-100000..=100000).contains(&n)),
            "priority",
        )?;
        check(
            matches!(
                text(&rule, "method"),
                "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS" | "ANY"
            ),
            "method",
        )?;
        check(
            rule["secure"].is_null() || rule["secure"].is_boolean(),
            "secure",
        )?;
        check(rule["enabled"].is_boolean(), "enabled")?;
        check(
            matches!(
                text(&rule, "exhausted"),
                "repeat_last" | "loop" | "fallthrough"
            ),
            "exhausted",
        )?;
        if !text(&rule, "expiresAt").is_empty() {
            OffsetDateTime::parse(text(&rule, "expiresAt"), &Rfc3339).map_err(|_| bad("expiry"))?;
        }
        if !text(&rule["scenario"], "name").is_empty() {
            bounded(&rule["scenario"], "name", 100)?;
            bounded(&rule["scenario"], "requiredState", 100)?;
            bounded(&rule["scenario"], "nextState", 100)?;
        }
        let conditions = rule["conditions"]
            .as_array_mut()
            .ok_or_else(|| bad("conditions"))?;
        check(conditions.len() <= 20, "condition count")?;
        for condition in conditions {
            check(
                matches!(
                    text(condition, "source"),
                    "query" | "header" | "body" | "cookie"
                ),
                "condition source",
            )?;
            check(
                !bounded(condition, "key", 2000)?.is_empty(),
                "condition key",
            )?;
            if text(condition, "source") == "header" {
                condition["key"] = json!(text(condition, "key").to_lowercase())
            }
            if condition["value"].is_null() {
                condition["value"] = json!("")
            }
            let value = bounded(condition, "value", 65536)?;
            if condition["operator"].is_null() {
                condition["operator"] = json!("equals")
            }
            check(
                matches!(
                    text(condition, "operator"),
                    "equals"
                        | "not_equals"
                        | "contains"
                        | "regex"
                        | "exists"
                        | "absent"
                        | "gt"
                        | "gte"
                        | "lt"
                        | "lte"
                        | "json_contains"
                        | "json_schema"
                        | "jsonpath"
                        | "xpath"
                ),
                "condition operator",
            )?;
            if advanced::structural(text(condition, "operator")) {
                check(condition["source"] == "body", "structural condition source")?;
                advanced::validate_structure(condition)?;
            }
            if text(condition, "operator") == "regex" {
                safe_regex(&value)?;
            }
            if text(condition, "operator") == "json_contains" {
                serde_json::from_str::<Value>(&value).map_err(|_| bad("condition JSON"))?;
            }
        }
        let steps = rule["steps"].as_array_mut().ok_or_else(|| bad("steps"))?;
        check(!steps.is_empty() && steps.len() <= 30, "steps")?;
        for step in steps {
            if step["action"].is_null() {
                step["action"] = json!("http")
            }
            check(
                matches!(
                    text(step, "action"),
                    "http"
                        | "disconnect"
                        | "sse"
                        | "file"
                        | "forward"
                        | "websocket"
                        | "script"
                        | "callback"
                ),
                "response action",
            )?;
            bounded_number(step, "times", 1, 10000)?;
            if !step["delayMs"].is_null() {
                bounded_number(step, "delayMs", 0, 60000)?;
            }
            let cookie_keys = step["headers"]
                .as_object()
                .into_iter()
                .flatten()
                .filter(|(k, _)| k.eq_ignore_ascii_case("set-cookie"))
                .map(|(k, _)| k.clone())
                .collect::<Vec<_>>();
            if !cookie_keys.is_empty() {
                let mut cookies = step
                    .get("cookies")
                    .and_then(Value::as_array)
                    .cloned()
                    .unwrap_or_default();
                for key in cookie_keys {
                    let value = step["headers"]
                        .as_object_mut()
                        .unwrap()
                        .remove(&key)
                        .unwrap();
                    if let Some(values) = value.as_array() {
                        cookies.extend(values.clone());
                    } else {
                        cookies.push(value);
                    }
                }
                step["cookies"] = json!(cookies);
            }
            headers(&step["headers"], false)?;
            if let Some(cookies) = step.get("cookies") {
                let values = cookies.as_array().ok_or_else(|| bad("cookies"))?;
                check(values.len() <= 50, "cookies")?;
                for value in values {
                    let value = value.as_str().ok_or_else(|| bad("Set-Cookie"))?;
                    check(
                        value.len() <= 8192
                            && !value.contains(['\r', '\n'])
                            && Regex::new("^[!#$%&'*+.^_`|~0-9A-Za-z-]+=")
                                .unwrap()
                                .is_match(value)
                            && HeaderValue::from_str(value).is_ok(),
                        "Set-Cookie",
                    )?;
                }
            }
            if step["action"] == "script" {
                bounded(&step["script"], "code", 65536)?;
                if step["script"]["timeoutMs"].is_null() {
                    step["script"]["timeoutMs"] = json!(1000);
                }
                bounded_number(&step["script"], "timeoutMs", 10, 5000)?;
            }
            if step["action"] == "callback" {
                step["callback"] = forward(&step["callback"])?;
            }

            let action = text(step, "action").to_owned();
            if matches!(action.as_str(), "http" | "file") {
                bounded_number(step, "statusCode", 200, 599)?;
            } else {
                step["statusCode"] = json!(200)
            }
            if matches!(
                action.as_str(),
                "disconnect" | "file" | "forward" | "websocket" | "script" | "callback"
            ) || [204, 205, 304].contains(&number(step, "statusCode", 200))
            {
                step["body"] = json!("")
            } else {
                bounded(step, "body", 262144)?;
            }
            if matches!(action.as_str(), "sse" | "websocket") {
                if step["intervalMs"].is_null() {
                    step["intervalMs"] = json!(0)
                }
                bounded_number(step, "intervalMs", 0, 60000)?;
            } else {
                step["intervalMs"] = json!(0)
            }
            if action == "sse" {
                let events = events(text(step, "body"));
                check(
                    !events.is_empty()
                        && events.len() <= 50
                        && (events.len() - 1) as u64 * number(step, "intervalMs", 0) <= 60000,
                    "SSE events or duration",
                )?;
            }
            if action == "forward" {
                step["forward"] = forward(&step["forward"])?;
            }
            if action == "file" {
                check(
                    ![204, 205, 304].contains(&number(step, "statusCode", 200)),
                    "file status",
                )?;
                let file = &step["file"];
                let name = bounded(file, "name", 255)?;
                check(
                    !name.is_empty()
                        && !name.contains(['/', '\\'])
                        && !name.chars().any(char::is_control),
                    "filename",
                )?;
                let content = bounded(file, "contentType", 127)?;
                check(
                    Regex::new(r"^[a-z0-9!#$&^_.+-]+/[a-z0-9!#$&^_.+-]+$")
                        .unwrap()
                        .is_match(&content),
                    "content type",
                )?;
                let data = B64
                    .decode(text(file, "data"))
                    .map_err(|_| bad("file data"))?;
                check(
                    data.len() <= MAX_BYTES && B64.encode(&data) == text(file, "data"),
                    "file size",
                )?;
                file_bytes += data.len();
                check(file_bytes <= 2 * MAX_BYTES, "files exceed 20 MiB")?;
                check(
                    matches!(text(file, "disposition"), "inline" | "attachment"),
                    "file disposition",
                )?;
            }
            if action == "websocket" {
                let ws = &mut step["websocket"];
                check(ws.is_object(), "WebSocket")?;
                if ws["messages"].is_null() {
                    ws["messages"] = json!([])
                }
                message_list(&ws["messages"])?;
                if ws["matchers"].is_null() {
                    ws["matchers"] = json!([])
                }
                let matchers = ws["matchers"]
                    .as_array_mut()
                    .ok_or_else(|| bad("WebSocket matchers"))?;
                check(matchers.len() <= 50, "WebSocket matcher count")?;
                for matcher in matchers {
                    check(
                        matches!(
                            text(matcher, "operator"),
                            "equals" | "contains" | "regex" | "any"
                        ),
                        "WebSocket operator",
                    )?;
                    bounded(matcher, "value", 2000)?;
                    if matcher["type"].is_null() {
                        matcher["type"] = json!("text");
                    }
                    check(
                        matches!(text(matcher, "type"), "text" | "binary" | "any"),
                        "WebSocket matcher type",
                    )?;
                    if text(matcher, "operator") == "regex" {
                        safe_regex(text(matcher, "value"))?;
                    }
                    message_list(&matcher["replies"])?;
                }
                if ws["closeCode"].is_null() {
                    ws["closeCode"] = json!(1000)
                }
                let code = number(ws, "closeCode", 0);
                check(
                    [
                        1000, 1001, 1002, 1003, 1007, 1008, 1009, 1010, 1011, 1012, 1013, 1014,
                    ]
                    .contains(&code)
                        || (3000..=4999).contains(&code),
                    "WebSocket close code",
                )?;
            }
        }
        rules.push(rule);
    }
    let mut metadata = rules.clone();
    for rule in &mut metadata {
        for step in rule["steps"].as_array_mut().unwrap() {
            if step["action"] == "file" {
                step["file"]["data"] = json!("")
            }
        }
    }
    check(
        serde_json::to_vec(&metadata)
            .map_err(|e| e.to_string())?
            .len()
            <= 1024 * 1024,
        "rules exceed 1 MiB",
    )?;
    Ok(json!(rules))
}
fn message_list(value: &Value) -> CommandResult<()> {
    check(
        value.as_array().is_some_and(|a| {
            a.len() <= 50
                && a.iter().all(|v| {
                    v.as_str().is_some_and(|s| s.len() <= 65536)
                        || (v["type"] == "binary"
                            && v["data"].as_str().is_some_and(|s| {
                                s.len() <= 87384
                                    && (s.contains("{{")
                                        || B64.decode(s).is_ok_and(|bytes| B64.encode(bytes) == s))
                            }))
                })
        }),
        "WebSocket messages",
    )
}
pub fn field<'a>(value: &'a Value, path: &str) -> Option<&'a Value> {
    if path == "$" || path.is_empty() {
        return Some(value);
    }
    let mut current = value;
    for key in path.split('.') {
        current = if let Some(array) = current.as_array() {
            array.get(key.parse::<usize>().ok()?)?
        } else {
            current.get(key)?
        };
    }
    Some(current)
}
fn subset(actual: &Value, expected: &Value) -> bool {
    match expected {
        Value::Object(o) => o
            .iter()
            .all(|(k, v)| actual.get(k).is_some_and(|a| subset(a, v))),
        Value::Array(a) => actual
            .as_array()
            .is_some_and(|values| a.iter().all(|e| values.iter().any(|v| subset(v, e)))),
        _ => actual == expected,
    }
}
pub fn display(value: &Value) -> String {
    value
        .as_str()
        .map(str::to_owned)
        .unwrap_or_else(|| value.to_string())
}
pub fn compare(actual: Option<&Value>, op: &str, expected: &str) -> bool {
    if op == "exists" {
        return actual.is_some();
    }
    if op == "absent" {
        return actual.is_none();
    }
    let Some(actual) = actual else { return false };
    if op == "not_equals" {
        return !compare(Some(actual), "equals", expected);
    }
    if op == "json_contains" {
        return serde_json::from_str::<Value>(expected).is_ok_and(|v| subset(actual, &v));
    }
    if let Some(values) = actual.as_array() {
        return values.iter().any(|v| compare(Some(v), op, expected));
    }
    let value = display(actual);
    match op {
        "equals" => value == expected,
        "contains" => value.contains(expected),
        "regex" => safe_regex(expected)
            .is_ok_and(|r| r.is_match(&value.chars().take(65536).collect::<String>())),
        "gt" | "gte" | "lt" | "lte" => match (value.parse::<f64>(), expected.parse::<f64>()) {
            (Ok(a), Ok(b)) if a.is_finite() && b.is_finite() => match op {
                "gt" => a > b,
                "gte" => a >= b,
                "lt" => a < b,
                _ => a <= b,
            },
            _ => false,
        },
        _ => false,
    }
}
pub fn path_params(rule: &Value, path: &str) -> Option<Value> {
    let pattern = text(rule, "path");
    let mode = text(rule, "pathMode");
    if mode == "regex" {
        return safe_regex(pattern).ok()?.is_match(path).then(|| json!({}));
    }
    if mode == "glob" {
        let pattern = pattern
            .split("**")
            .map(|p| {
                p.split('*')
                    .map(regex::escape)
                    .collect::<Vec<_>>()
                    .join("[^/]*")
            })
            .collect::<Vec<_>>()
            .join(".*");
        return Regex::new(&format!("^{pattern}$"))
            .ok()?
            .is_match(path)
            .then(|| json!({}));
    }
    if pattern == path {
        return Some(json!({}));
    }
    if mode == "exact" {
        return None;
    }
    let parts: Vec<_> = pattern.split('/').collect();
    let actual: Vec<_> = path.split('/').collect();
    if parts.len() != actual.len() {
        return None;
    }
    let mut params = json!({});
    for (p, a) in parts.into_iter().zip(actual) {
        if p.starts_with(':') && p.len() > 1 && !a.is_empty() {
            params[&p[1..]] = json!(
                url::form_urlencoded::parse(format!("x={}", a.replace('+', "%2B")).as_bytes())
                    .next()
                    .map(|(_, v)| v.to_string())
                    .unwrap_or_else(|| a.to_owned())
            )
        } else if p != a {
            return None;
        }
    }
    Some(params)
}
pub fn normalize(input: &Value) -> CommandResult<Value> {
    let path = if text(input, "path").is_empty() {
        "/"
    } else {
        text(input, "path")
    };
    check(
        path.starts_with('/')
            && !path.starts_with("//")
            && !path.contains(['\r', '\n', '#'])
            && path.len() <= 4000,
        "request path",
    )?;
    let url =
        url::Url::parse(&format!("http://mock.local{path}")).map_err(|_| bad("request path"))?;
    let mut query = json!({});
    for (k, v) in url.query_pairs() {
        let current = &mut query[k.as_ref()];
        if current.is_null() {
            *current = json!(v)
        } else if let Some(a) = current.as_array_mut() {
            a.push(json!(v))
        } else {
            *current = json!([current.clone(), v])
        }
    }
    if let Some(values) = input["query"].as_object() {
        for (k, v) in values {
            query[k] = v.clone()
        }
    }
    let mut headers = json!({});
    if let Some(values) = input["headers"].as_object() {
        for (k, v) in values {
            check(
                v.as_str().is_some_and(|s| s.len() <= 8192),
                "request header",
            )?;
            headers[k.to_lowercase()] = v.clone();
        }
    }
    Ok(
        json!({"method":if text(input,"method").is_empty(){"GET".into()}else{text(input,"method").to_uppercase()},"path":url.path(),"query":query,"headers":headers,"body":if input["rawBody"]==""{json!("")}else{input.get("body").cloned().unwrap_or_else(||json!(""))},"rawBody":input["rawBody"],"secure":input["secure"]==true,"protocol":if input["protocol"]=="websocket"{"websocket"}else{"http"}}),
    )
}
pub fn cookie_values(request: &Value) -> Value {
    let mut result = json!({});
    for item in text(&request["headers"], "cookie").split(';') {
        if let Some((k, v)) = item.split_once('=') {
            result[k.trim()] = json!(v.trim())
        }
    }
    result
}
pub fn explain(state: &Value, request: &Value) -> Value {
    let mut rules: Vec<_> = state["rules"]
        .as_array()
        .into_iter()
        .flatten()
        .enumerate()
        .collect();
    rules.sort_by_key(|(i, r)| (-r["priority"].as_i64().unwrap_or(0), *i));
    let mut trace = Vec::new();
    let mut selection = Value::Null;
    let cookies = cookie_values(request);
    for (_, rule) in rules {
        let mut reasons = Vec::new();
        let name = if text(rule, "name").is_empty() {
            text(rule, "path")
        } else {
            text(rule, "name")
        };
        if rule["enabled"] != true {
            reasons.push(json!({"code":"disabled"}))
        }
        if !text(rule, "expiresAt").is_empty()
            && OffsetDateTime::parse(text(rule, "expiresAt"), &Rfc3339)
                .is_ok_and(|t| t <= OffsetDateTime::now_utc())
        {
            reasons.push(json!({"code":"expired","expected":rule["expiresAt"]}))
        }
        if rule["method"] != "ANY" && rule["method"] != request["method"] {
            reasons
                .push(json!({"code":"method","actual":request["method"],"expected":rule["method"]}))
        }
        if rule["secure"].is_boolean() && rule["secure"] != json!(request["secure"] == true) {
            reasons.push(
                json!({"code":"secure","actual":request["secure"]==true,"expected":rule["secure"]}),
            );
        }
        let params = path_params(rule, text(request, "path"));
        if params.is_none() {
            reasons.push(json!({"code":"path","actual":request["path"],"expected":rule["path"]}))
        }
        for condition in rule["conditions"].as_array().into_iter().flatten() {
            let key = text(condition, "key");
            let source = text(condition, "source");
            let op = if text(condition, "operator").is_empty() {
                "equals"
            } else {
                text(condition, "operator")
            };
            let actual = match source {
                "body" => {
                    if matches!(op, "jsonpath" | "xpath") {
                        Some(&request["body"])
                    } else {
                        field(&request["body"], key)
                    }
                }
                "query" => request["query"].get(key),
                "cookie" => cookies.get(key),
                _ => request["headers"].get(key),
            };
            if !(if advanced::structural(op) {
                advanced::matches_structure(condition, actual.unwrap_or(&Value::Null))
            } else {
                compare(actual, op, text(condition, "value"))
            }) {
                reasons.push(json!({"code":"condition","field":format!("{source}.{key} {op}"),"actual":actual,"expected":condition["value"]}))
            }
        }
        let scenario = text(&rule["scenario"], "name");
        if !scenario.is_empty() {
            let actual = state["states"][scenario].as_str().unwrap_or("STARTED");
            let expected = text(&rule["scenario"], "requiredState");
            if !expected.is_empty() && expected != actual {
                reasons.push(
                    json!({"code":"scenario","field":scenario,"actual":actual,"expected":expected}),
                )
            }
        }
        let hit = state["hits"][text(rule, "id")].as_u64().unwrap_or(0) + 1;
        let steps = rule["steps"].as_array().unwrap();
        let total: u64 = steps.iter().map(|s| number(s, "times", 1)).sum();
        if rule["exhausted"] == "fallthrough" && hit > total {
            reasons.push(json!({"code":"exhausted","actual":hit-1,"expected":total}))
        }
        let mut remaining = if rule["exhausted"] == "loop" {
            (hit - 1) % total + 1
        } else {
            hit.min(total)
        };
        let index = steps
            .iter()
            .position(|s| {
                let times = number(s, "times", 1);
                if remaining <= times {
                    true
                } else {
                    remaining -= times;
                    false
                }
            })
            .unwrap_or(0);
        let step = &steps[index];
        if (step["action"] == "websocket") != (request["protocol"] == "websocket") {
            reasons.push(json!({"code":"protocol","expected":if step["action"]=="websocket"{"websocket"}else{"http"}}))
        }
        let matched = reasons.is_empty();
        if matched {
            if selection.is_null() {
                selection =
                    json!({"rule":rule,"step":step,"stepNumber":index+1,"hit":hit,"params":params});
            } else {
                reasons.push(json!({"code":"shadowed","expected":selection["rule"]["id"]}))
            }
        }
        trace.push(json!({"ruleID":rule["id"],"name":name,"matched":matched,"reasons":reasons}));
    }
    json!({"selection":selection,"trace":trace,"states":state["states"],"fallback":if selection.is_null(){state["options"]["fallback"].clone()}else{Value::Null}})
}
pub fn advance(state: &mut Value, selection: &Value) {
    state["hits"][text(&selection["rule"], "id")] = selection["hit"].clone();
    let scenario = &selection["rule"]["scenario"];
    if !text(scenario, "nextState").is_empty() {
        if !state["states"].is_object() {
            state["states"] = json!({})
        }
        state["states"][text(scenario, "name")] = scenario["nextState"].clone();
    }
}
pub fn render(text_value: &str, request: &Value, params: &Value, extra: &Value) -> String {
    let mut values = json!({"request":request,"query":request["query"],"headers":request["headers"],"body":request["body"],"path":params});
    if let Some(obj) = extra.as_object() {
        for (k, v) in obj {
            values[k] = v.clone()
        }
    }
    let mut cache = HashMap::<String, Value>::new();
    let re = Regex::new(r"\{\{\s*([^{}]+?)\s*\}\}").unwrap();
    let mut resolve = |key: &str| -> Value {
        let key = key.trim();
        if let Some(v) = cache.get(key) {
            return v.clone();
        }
        let value = match key {
            "uuid" => json!(Uuid::new_v4().to_string()),
            "timestamp" => json!(OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000_000),
            "isoDate" => json!(timestamp()),
            _ => {
                if let Some(range) = key.strip_prefix("randomInt:") {
                    let parts: Vec<_> = range.split(':').collect();
                    match (
                        parts.first().and_then(|v| v.parse::<i64>().ok()),
                        parts.get(1).and_then(|v| v.parse::<i64>().ok()),
                    ) {
                        (Some(a), Some(b))
                            if b >= a
                                && b.checked_sub(a).is_some_and(|n| n < 1_000_000_000_000) =>
                        {
                            json!(
                                a + (u64::from_le_bytes(
                                    Uuid::new_v4().as_bytes()[..8].try_into().unwrap()
                                ) % ((b - a) as u64 + 1))
                                    as i64
                            )
                        }
                        _ => json!(""),
                    }
                } else {
                    field(&values, key).cloned().unwrap_or(json!(""))
                }
            }
        };
        cache.insert(key.to_owned(), value.clone());
        value
    };
    fn visit(value: &Value, re: &Regex, resolve: &mut impl FnMut(&str) -> Value) -> Value {
        match value {
            Value::String(s) => {
                if let Some(c) = re.captures(s) {
                    if c.get(0).unwrap().as_str() == s {
                        return resolve(&c[1]);
                    }
                }
                json!(
                    re.replace_all(s, |c: &regex::Captures| display(&resolve(&c[1])))
                        .to_string()
                )
            }
            Value::Array(a) => json!(a.iter().map(|v| visit(v, re, resolve)).collect::<Vec<_>>()),
            Value::Object(o) => Value::Object(
                o.iter()
                    .map(|(k, v)| (k.clone(), visit(v, re, resolve)))
                    .collect(),
            ),
            _ => value.clone(),
        }
    }
    match serde_json::from_str::<Value>(text_value) {
        Ok(value) => visit(&value, &re, &mut resolve).to_string(),
        Err(_) => re
            .replace_all(text_value, |c: &regex::Captures| display(&resolve(&c[1])))
            .to_string(),
    }
}
pub fn render_step(step: &Value, request: &Value, params: &Value) -> Value {
    let mut result = step.clone();
    if step["template"] == true {
        if let Some(cookies) = step["cookies"].as_array() {
            result["cookies"] = json!(
                cookies
                    .iter()
                    .map(|v| render(v.as_str().unwrap_or_default(), request, params, &json!({})))
                    .collect::<Vec<_>>()
            );
        }
        result["body"] = json!(render(text(step, "body"), request, params, &Value::Null));
        if let Some(headers) = step["headers"].as_object() {
            for (k, v) in headers {
                result["headers"][k] = json!(render(
                    v.as_str().unwrap_or_default(),
                    request,
                    params,
                    &Value::Null
                ));
            }
        }
    }
    result
}
pub fn events(body: &str) -> Vec<String> {
    Regex::new(r"\n{2,}")
        .unwrap()
        .split(&body.replace("\r\n", "\n"))
        .filter(|v| !v.trim().is_empty())
        .map(str::to_owned)
        .collect()
}
pub fn summary(state: &Value) -> Value {
    json!({"kind":state["kind"],"revision":state["revision"],"options":state["options"],"states":state["states"],"rules":state["rules"].as_array().into_iter().flatten().map(|r|json!({"id":r["id"],"name":r["name"],"enabled":r["enabled"],"method":r["method"],"path":r["path"],"pathMode":r["pathMode"],"secure":r["secure"],"priority":r["priority"],"expiresAt":r["expiresAt"],"scenario":r["scenario"],"exhausted":r["exhausted"],"hits":state["hits"][text(r,"id")].as_u64().unwrap_or(0),"steps":r["steps"].as_array().into_iter().flatten().map(|s|json!({"action":s["action"],"statusCode":s["statusCode"],"times":s["times"],"delayMs":s["delayMs"]})).collect::<Vec<_>>()})).collect::<Vec<_>>()})
}
pub fn record_body(bytes: &[u8], content_type: &str) -> Value {
    match std::str::from_utf8(bytes) {
        Ok(s) if !s.contains('\0') || content_type.starts_with("text/") => json!(s),
        _ => json!({"encoding":"base64","data":B64.encode(bytes)}),
    }
}
