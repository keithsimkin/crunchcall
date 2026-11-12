use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::EngineError;

const EMBEDDED: &str = include_str!("../../../catalog/providers.json");

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Defaults {
    pub speech: String,
    pub writer: String,
    pub coach: String,
    pub coach_pack: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Module {
    pub id: String,
    pub kind: String,
    #[serde(rename = "where")]
    pub place: String,
    pub name: String,
    pub maker: String,
    pub blurb: String,
    #[serde(default)]
    pub size: Option<String>,
    #[serde(default)]
    pub license: Option<String>,
    pub streaming: bool,
    pub audio_leaves_device: bool,
    pub text_leaves_device: bool,
    pub needs_key: bool,
    #[serde(default)]
    pub key_hint: Option<String>,
    pub run: String,
    pub runtime: String,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub base_url: Option<String>,
    #[serde(default)]
    pub hotkey: Option<String>,
    pub download: String,
    #[serde(default)]
    pub download_url: Option<String>,
    pub languages: String,
    pub client_ready: bool,
}

#[derive(Debug, Clone)]
pub struct Catalog {
    pub version: u32,
    pub defaults: Defaults,
    pub modules: Vec<Module>,
    raw: Value,
}

impl Catalog {
    pub fn embedded() -> Result<Self, EngineError> {
        Self::parse(EMBEDDED)
    }

    /// Dev runs prefer the catalog file on disk. The binary still works from the embedded copy.
    pub fn load() -> Result<Self, EngineError> {
        if let Some(text) = read_dev_file() {
            if let Ok(catalog) = Self::parse(&text) {
                return Ok(catalog);
            }
        }
        Self::embedded()
    }

    pub fn parse(text: &str) -> Result<Self, EngineError> {
        let raw: Value = serde_json::from_str(text)
            .map_err(|err| EngineError::new("bad_catalog", format!("Catalog JSON: {err}")))?;
        let version = raw
            .get("version")
            .and_then(|v| v.as_u64())
            .unwrap_or(0) as u32;
        let defaults: Defaults = serde_json::from_value(
            raw.get("defaults").cloned().unwrap_or(Value::Null),
        )
        .map_err(|err| EngineError::new("bad_catalog", format!("Catalog defaults: {err}")))?;
        let modules: Vec<Module> = serde_json::from_value(
            raw.get("modules").cloned().unwrap_or(Value::Null),
        )
        .map_err(|err| EngineError::new("bad_catalog", format!("Catalog modules: {err}")))?;
        Ok(Self {
            version,
            defaults,
            modules,
            raw,
        })
    }

    pub fn get(&self, id: &str) -> Option<&Module> {
        self.modules.iter().find(|module| module.id == id)
    }

    pub fn to_value(&self) -> Value {
        self.raw.clone()
    }

    pub fn validate(&self) -> Result<(), EngineError> {
        let mut seen = HashSet::new();
        for module in &self.modules {
            if module.id.is_empty() || !seen.insert(module.id.clone()) {
                return Err(EngineError::new(
                    "bad_catalog",
                    format!("Duplicate module id {}", module.id),
                ));
            }
        }
        for id in [
            &self.defaults.speech,
            &self.defaults.writer,
            &self.defaults.coach,
            &self.defaults.coach_pack,
        ] {
            if self.get(id).is_none() {
                return Err(EngineError::new(
                    "bad_catalog",
                    format!("Default {id} is not a module."),
                ));
            }
        }
        Ok(())
    }
}

fn read_dev_file() -> Option<String> {
    let mut candidates = Vec::new();
    if let Ok(path) = std::env::var("CRUNCHCALL_CATALOG") {
        if !path.trim().is_empty() {
            candidates.push(PathBuf::from(path));
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd.join("catalog").join("providers.json"));
        candidates.push(cwd.join("native").join("catalog").join("providers.json"));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join("catalog").join("providers.json"));
            candidates.push(dir.join("..").join("catalog").join("providers.json"));
        }
    }
    for path in candidates {
        if let Ok(text) = fs::read_to_string(&path) {
            if !text.trim().is_empty() {
                return Some(text);
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_ids_are_unique_and_defaults_exist() {
        let catalog = Catalog::embedded().expect("embedded catalog");
        catalog.validate().expect("defaults point at real modules");
        assert!(catalog.version >= 1);
        assert!(catalog.modules.len() > 10);
        let speech = catalog.get(&catalog.defaults.speech).unwrap();
        let writer = catalog.get(&catalog.defaults.writer).unwrap();
        let coach = catalog.get(&catalog.defaults.coach).unwrap();
        let pack = catalog.get(&catalog.defaults.coach_pack).unwrap();
        assert_eq!(speech.kind, "speech");
        assert_eq!(writer.kind, "writer");
        assert_eq!(coach.id, "coach.rules");
        assert_eq!(pack.model.as_deref(), Some("crisp"));
    }
}
