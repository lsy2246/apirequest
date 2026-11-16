use super::engine::*;
use super::*;
use jsonpath_rust::JsonPath;
use rquickjs::{CatchResultExt, Context as JsContext, Runtime};

pub fn structural(op: &str) -> bool {
    matches!(op, "json_schema" | "jsonpath" | "xpath")
}
fn schema(value: &str) -> CommandResult<jsonschema::Validator> {
    let parsed: Value = serde_json::from_str(value).map_err(|e| e.to_string())?;
    let mut builder = jsonschema::options().should_validate_formats(true);
    if parsed.get("$schema").is_none() {
        builder = builder.with_draft(jsonschema::Draft::Draft7);
    }
    builder.build(&parsed).map_err(|e| e.to_string())
}
pub fn validate_structure(condition: &Value) -> CommandResult<()> {
    match text(condition, "operator") {
        "json_schema" => {
            schema(text(condition, "value"))?;
        }
        "jsonpath" => {
            json!({})
                .query(text(condition, "key"))
                .map_err(|e| e.to_string())?;
        }
        "xpath" => {
            sxd_xpath::Factory::new()
                .build(text(condition, "key"))
                .map_err(|e| e.to_string())?
                .ok_or("Empty XPath")?;
        }
        _ => {}
    }
    if let Some(namespaces) = condition.get("namespaces") {
        if !namespaces.is_object()
            || !namespaces
                .as_object()
                .unwrap()
                .values()
                .all(Value::is_string)
        {
            return Err(bad("namespaces"));
        }
    }
    Ok(())
}
pub fn matches_structure(condition: &Value, actual: &Value) -> bool {
    let op = text(condition, "operator");
    let expected = text(condition, "value");
    let key = text(condition, "key");
    if op == "json_schema" {
        return schema(expected).is_ok_and(|s| s.is_valid(actual));
    }
    if op == "jsonpath" {
        return actual.query(key).is_ok_and(|items| {
            if expected.is_empty() {
                !items.is_empty()
            } else {
                items.iter().any(|v| display(v) == expected)
            }
        });
    }
    let Some(xml) = actual.as_str() else {
        return false;
    };
    if xml.len() > 1048576
        || xml.to_uppercase().contains("<!DOCTYPE")
        || xml.to_uppercase().contains("<!ENTITY")
    {
        return false;
    }
    let Ok(package) = sxd_document::parser::parse(xml) else {
        return false;
    };
    let document = package.as_document();
    let Ok(Some(xpath)) = sxd_xpath::Factory::new().build(key) else {
        return false;
    };
    let mut context = sxd_xpath::Context::new();
    for (prefix, uri) in condition["namespaces"].as_object().into_iter().flatten() {
        context.set_namespace(prefix, uri.as_str().unwrap_or_default());
    }
    let Ok(value) = xpath.evaluate(&context, document.root()) else {
        return false;
    };
    if expected.is_empty() {
        return value.boolean();
    }
    match value {
        sxd_xpath::Value::Nodeset(nodes) => nodes.iter().any(|v| v.string_value() == expected),
        v => v.string() == expected,
    }
}
pub fn script(code: &str, request: &Value, params: &Value, timeout: u64) -> CommandResult<Value> {
    let runtime = Runtime::new().map_err(|e| e.to_string())?;
    runtime.set_memory_limit(32 * 1024 * 1024);
    runtime.set_max_stack_size(512 * 1024);
    let deadline = Instant::now() + Duration::from_millis(timeout);
    runtime.set_interrupt_handler(Some(Box::new(move || Instant::now() >= deadline)));
    let context = JsContext::full(&runtime).map_err(|e| e.to_string())?;
    let mut input = request.clone();
    input["params"] = params.clone();
    let source =
        format!("JSON.stringify((function(request) {{ 'use strict';\n{code}\n}})({input}))");
    let output = context.with(|ctx| {
        ctx.eval::<String, _>(source)
            .catch(&ctx)
            .map_err(|e| format!("Mock script: {e}"))
    })?;
    if output.len() > 1048576 {
        return Err("Mock script response exceeds 1 MiB".into());
    }
    serde_json::from_str(&output).map_err(|e| format!("Mock script response: {e}"))
}
pub fn generated(step: &Value, response: Value) -> CommandResult<Value> {
    if !response.is_object() {
        return Err("Mock action must return a response object".into());
    }
    let mut next = step.clone();
    next["action"] = json!("http");
    next["template"] = json!(false);
    next["statusCode"] = response.get("statusCode").cloned().unwrap_or(json!(200));
    next["headers"] = response.get("headers").cloned().unwrap_or(json!({}));
    next["cookies"] = response
        .get("cookies")
        .cloned()
        .unwrap_or_else(|| step.get("cookies").cloned().unwrap_or(json!([])));
    next["body"] = json!(
        response["body"]
            .as_str()
            .map(str::to_owned)
            .unwrap_or_else(|| response["body"].to_string())
    );
    let parsed = parse_rules(
        &json!([{"id":"generated-response","name":"Generated response","enabled":true,"method":"GET","path":"/","conditions":[],"exhausted":"repeat_last","steps":[next]}]),
    )?;
    Ok(parsed[0]["steps"][0].clone())
}
pub fn preview_step(step: &Value, request: &Value, params: &Value) -> CommandResult<Value> {
    let step = render_step(step, request, params);
    if step["action"] == "script" {
        let result = script(
            text(&step["script"], "code"),
            request,
            params,
            number(&step["script"], "timeoutMs", 1000),
        )?;
        generated(&step, result)
    } else {
        Ok(step)
    }
}
pub async fn resolve(step: Value, request: Value, params: Value) -> CommandResult<Value> {
    if step["action"] == "script" {
        tokio::task::spawn_blocking(move || preview_step(&step, &request, &params))
            .await
            .map_err(|e| e.to_string())?
    } else if step["action"] == "callback" {
        let config = &step["callback"];
        let mut payload = request;
        payload["params"] = params;
        let mut builder = reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_millis(number(config, "timeoutMs", 10000)))
            .build()
            .map_err(|e| e.to_string())?
            .post(text(config, "url"))
            .json(&payload);
        for (k, v) in config["headers"].as_object().into_iter().flatten() {
            builder = builder.header(k, text_value(v));
        }
        let mut response = builder
            .send()
            .await
            .map_err(|e| format!("Mock callback: {e}"))?
            .error_for_status()
            .map_err(|e| e.to_string())?;
        if !response.status().is_success() {
            return Err(format!("Mock callback HTTP {}", response.status()));
        }
        let mut body = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
            if body.len() + chunk.len() > 1048576 {
                return Err("Mock callback response exceeds 1 MiB".into());
            }
            body.extend_from_slice(&chunk);
        }
        generated(
            &step,
            serde_json::from_slice(&body)
                .map_err(|_| "Mock callback must return JSON".to_owned())?,
        )
    } else {
        Ok(step)
    }
}
fn text_value(value: &Value) -> &str {
    value.as_str().unwrap_or_default()
}
pub fn cookie_values(step: &Value, prefix: &str) -> Vec<String> {
    step["cookies"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(|v| {
            let mut parts = v
                .split(';')
                .map(str::trim)
                .filter(|v| !v.is_empty())
                .collect::<Vec<_>>();
            let path = parts
                .iter()
                .find_map(|v| v.strip_prefix("Path=").or_else(|| v.strip_prefix("path=")))
                .filter(|v| v.starts_with(prefix))
                .unwrap_or(prefix)
                .to_owned();
            parts.retain(|v| {
                !v.to_ascii_lowercase().starts_with("path=")
                    && !v.to_ascii_lowercase().starts_with("domain=")
            });
            format!("{}; Path={path}", parts.join("; "))
        })
        .collect()
}
