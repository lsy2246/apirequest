use crate::{Result, Workspace, check_key};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoreEntry {
    pub scope: String,
    pub namespace: String,
    pub key: String,
    pub value: Value,
}

fn get(connection: &Connection, scope: &str, namespace: &str, key: &str) -> Result<Option<Value>> {
    let value: Option<String> = connection
        .query_row(
            "SELECT value FROM store_values WHERE scope=? AND namespace=? AND key=?",
            params![scope, namespace, key],
            |row| row.get(0),
        )
        .optional()?;
    Ok(value.map(|text| serde_json::from_str(&text)).transpose()?)
}

fn put(connection: &Connection, entry: &StoreEntry) -> Result<()> {
    connection.execute(
        "INSERT INTO store_values(scope, namespace, key, value) VALUES(?,?,?,?)
         ON CONFLICT(scope, namespace, key) DO UPDATE SET value=excluded.value",
        params![
            entry.scope,
            entry.namespace,
            entry.key,
            serde_json::to_string(&entry.value)?
        ],
    )?;
    Ok(())
}

fn validate(scope: &str, namespace: &str, key: &str) -> Result<()> {
    for key in [scope, namespace, key] {
        check_key(key)?;
    }
    Ok(())
}

impl Workspace {
    pub fn store_get(&self, scope: &str, namespace: &str, key: &str) -> Result<Option<Value>> {
        validate(scope, namespace, key)?;
        get(&*self.lock()?, scope, namespace, key)
    }

    pub fn store_put(&self, entry: &StoreEntry) -> Result<()> {
        validate(&entry.scope, &entry.namespace, &entry.key)?;
        put(&*self.lock()?, entry)
    }

    pub fn store_batch(
        &self,
        entries: &[StoreEntry],
        removals: &[(String, String, String)],
    ) -> Result<()> {
        for entry in entries {
            validate(&entry.scope, &entry.namespace, &entry.key)?;
        }
        for (scope, namespace, key) in removals {
            validate(scope, namespace, key)?;
        }
        let mut connection = self.lock()?;
        let tx = connection.transaction()?;
        for entry in entries {
            put(&tx, entry)?;
        }
        for (scope, namespace, key) in removals {
            tx.execute(
                "DELETE FROM store_values WHERE scope=? AND namespace=? AND key=?",
                params![scope, namespace, key],
            )?;
        }
        tx.commit()?;
        Ok(())
    }
    pub fn store_page_without(
        &self,
        scope: &str,
        namespace: &str,
        skip: usize,
        take: usize,
        omissions: &[&str],
    ) -> Result<Vec<Value>> {
        validate(scope, namespace, "page")?;
        let connection = self.lock()?;
        let expression = if omissions.is_empty() {
            "value".to_owned()
        } else {
            format!(
                "json_remove(value,{})",
                vec!["?"; omissions.len()].join(",")
            )
        };
        let sql = format!(
            "SELECT {expression} FROM store_values WHERE scope=? AND namespace=? ORDER BY key DESC LIMIT ? OFFSET ?"
        );
        let mut arguments: Vec<rusqlite::types::Value> = omissions
            .iter()
            .map(|v| rusqlite::types::Value::Text((*v).into()))
            .collect();
        arguments.extend([
            scope.to_owned().into(),
            namespace.to_owned().into(),
            (take as i64).into(),
            (skip as i64).into(),
        ]);
        let mut statement = connection.prepare(&sql)?;
        let rows = statement.query_map(rusqlite::params_from_iter(arguments), |row| {
            row.get::<_, String>(0)
        })?;
        let mut result = Vec::new();
        for row in rows {
            result.push(serde_json::from_str(&row?)?);
        }
        Ok(result)
    }
    pub fn store_remove(&self, scope: &str, namespace: &str, key: &str) -> Result<bool> {
        validate(scope, namespace, key)?;
        Ok(self.lock()?.execute(
            "DELETE FROM store_values WHERE scope=? AND namespace=? AND key=?",
            params![scope, namespace, key],
        )? > 0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn stores_batches_atomically_and_pages_without_loading_bodies() {
        let root = std::env::temp_dir().join(format!("apirequest-store-{}", uuid::Uuid::new_v4()));
        let workspace = Workspace::open(&root).unwrap();
        let first = StoreEntry {
            scope: "local".into(),
            namespace: "traffic".into(),
            key: "0001".into(),
            value: serde_json::json!({"id":"first","responseBody":"large","requestBody":"request","mockMatch":{"rawRequestBase64":"YWJj","recorded":true}}),
        };
        let mut second = first.clone();
        second.key = "0002".into();
        second.value["id"] = serde_json::json!("second");
        workspace
            .store_batch(&[first.clone(), second.clone()], &[])
            .unwrap();
        let page = workspace
            .store_page_without(
                "local",
                "traffic",
                0,
                1,
                &["$.responseBody", "$.mockMatch.rawRequestBase64"],
            )
            .unwrap();
        assert_eq!(page[0]["id"], "second");
        assert!(page[0].get("responseBody").is_none());
        assert!(page[0]["mockMatch"].get("rawRequestBase64").is_none());
        assert_eq!(page[0]["mockMatch"]["recorded"], true);
        let mut invalid = second.clone();
        invalid.key = "".into();
        let mut changed = first.clone();
        changed.value = serde_json::json!({"id":"changed"});
        assert!(workspace.store_batch(&[changed, invalid], &[]).is_err());
        assert_eq!(
            workspace
                .store_get("local", "traffic", "0001")
                .unwrap()
                .unwrap()["id"],
            "first"
        );
        workspace
            .store_batch(&[], &[("local".into(), "traffic".into(), "0002".into())])
            .unwrap();
        assert!(
            workspace
                .store_get("local", "traffic", "0002")
                .unwrap()
                .is_none()
        );
        drop(workspace);
        let _ = std::fs::remove_dir_all(root);
    }
}
