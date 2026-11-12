use thiserror::Error;

#[derive(Debug, Error)]
#[error("{message}")]
pub struct EngineError {
    pub code: &'static str,
    pub message: String,
}

impl EngineError {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

pub fn provider_http(status: u16, body: &str, secrets: &[String]) -> EngineError {
    let snippet = redact_snippet(body, secrets);
    EngineError::new("provider_http", format!("HTTP {status}: {snippet}"))
}

/// Truncate to 300 chars after removing the caller's key. Other body text stays.
pub fn redact_snippet(body: &str, secrets: &[String]) -> String {
    let mut text = body.to_string();
    for secret in secrets {
        if secret.len() >= 4 {
            text = text.replace(secret, "***");
        }
    }
    text.chars().take(300).collect()
}
