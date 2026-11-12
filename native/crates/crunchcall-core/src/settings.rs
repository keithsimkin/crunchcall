use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

fn default_language() -> String {
    "auto".to_string()
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    #[serde(default)]
    pub speech: String,
    #[serde(default)]
    pub writer: String,
    #[serde(default)]
    pub coach: String,
    #[serde(default)]
    pub coach_pack: String,
    #[serde(default = "default_language")]
    pub language: String,
    #[serde(default)]
    pub model_overrides: Map<String, Value>,
}

impl Settings {
    pub fn from_defaults(defaults: &crate::catalog::Defaults) -> Self {
        Self {
            speech: defaults.speech.clone(),
            writer: defaults.writer.clone(),
            coach: defaults.coach.clone(),
            coach_pack: defaults.coach_pack.clone(),
            language: default_language(),
            model_overrides: Map::new(),
        }
    }
}
