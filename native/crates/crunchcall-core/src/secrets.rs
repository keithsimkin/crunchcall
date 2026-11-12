use std::collections::HashMap;
use std::sync::Mutex;

use crate::error::EngineError;

pub trait SecretStore: Send + Sync {
    fn put(&self, account: &str, secret: &str) -> Result<(), EngineError>;
    fn get(&self, account: &str) -> Result<Option<String>, EngineError>;
    fn delete(&self, account: &str) -> Result<(), EngineError>;
}

pub struct MemorySecretStore {
    inner: Mutex<HashMap<String, String>>,
}

impl MemorySecretStore {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(HashMap::new()),
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, String>> {
        self.inner.lock().unwrap_or_else(|err| err.into_inner())
    }
}

impl Default for MemorySecretStore {
    fn default() -> Self {
        Self::new()
    }
}

impl SecretStore for MemorySecretStore {
    fn put(&self, account: &str, secret: &str) -> Result<(), EngineError> {
        self.lock().insert(account.to_string(), secret.to_string());
        Ok(())
    }

    fn get(&self, account: &str) -> Result<Option<String>, EngineError> {
        Ok(self.lock().get(account).cloned())
    }

    fn delete(&self, account: &str) -> Result<(), EngineError> {
        self.lock().remove(account);
        Ok(())
    }
}
