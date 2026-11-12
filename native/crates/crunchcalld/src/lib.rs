use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crunchcall_core::cloud::{
    complete_with, is_unlinked_runtime, pull_file, transcribe_with, PullStop, SpeechOutcome,
    UreqTransport,
};
use crunchcall_core::coach;
use crunchcall_core::ids::new_id;
use crunchcall_core::wav::{decode_base64, wrap_pcm_wav};
use crunchcall_core::{Catalog, EngineError, Module, SecretStore, Settings};
use crunchcall_db::{ActionDraft, Db, DbError};
use serde_json::{json, Map, Value};

const VERSION: &str = "0.1.0";
const PCM_CAP: usize = 32 * 1024 * 1024;

struct Session {
    module_id: String,
    sample_rate: u32,
    pcm: Vec<u8>,
}

struct DownloadControl {
    pause: AtomicBool,
    alive: AtomicBool,
    gate: Mutex<()>,
}

pub struct Engine {
    db: Mutex<Db>,
    catalog: Catalog,
    secrets: Box<dyn SecretStore>,
    sessions: Mutex<HashMap<String, Session>>,
    jobs: Mutex<HashMap<String, Arc<DownloadControl>>>,
    data_dir: PathBuf,
}

struct KeyringSecretStore;

impl SecretStore for KeyringSecretStore {
    fn put(&self, account: &str, secret: &str) -> Result<(), EngineError> {
        let entry = keyring::Entry::new("CrunchCall", account).map_err(keyring_err)?;
        entry.set_password(secret).map_err(keyring_err)
    }

    fn get(&self, account: &str) -> Result<Option<String>, EngineError> {
        let entry = keyring::Entry::new("CrunchCall", account).map_err(keyring_err)?;
        match entry.get_password() {
            Ok(secret) => Ok(Some(secret)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(err) => Err(keyring_err(err)),
        }
    }

    fn delete(&self, account: &str) -> Result<(), EngineError> {
        let entry = keyring::Entry::new("CrunchCall", account).map_err(keyring_err)?;
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(err) => Err(keyring_err(err)),
        }
    }
}

fn keyring_err(err: keyring::Error) -> EngineError {
    EngineError::new("secret_store", err.to_string())
}

impl Engine {
    pub fn open_default() -> Result<Self, EngineError> {
        Self::open_in(&data_dir_from_env(), Box::new(KeyringSecretStore))
    }

    pub fn open_in(data_dir: &Path, secrets: Box<dyn SecretStore>) -> Result<Self, EngineError> {
        let db = Db::open(data_dir).map_err(db_err)?;
        db.mark_interrupted_downloads().map_err(db_err)?;
        let catalog = Catalog::load()?;
        catalog.validate()?;
        Ok(Self {
            db: Mutex::new(db),
            catalog,
            secrets,
            sessions: Mutex::new(HashMap::new()),
            jobs: Mutex::new(HashMap::new()),
            data_dir: data_dir.to_path_buf(),
        })
    }

    pub fn handle_line(&self, line: &str) -> Value {
        let line = line.trim();
        if line.is_empty() {
            return error_line(Value::from(0), "bad_request", "Expected a JSON request.");
        }
        let value: Value = match serde_json::from_str(line) {
            Ok(value) => value,
            Err(_) => return error_line(Value::from(0), "bad_request", "Expected a JSON request."),
        };
        if !value.is_object() {
            return error_line(Value::from(0), "bad_request", "Expected a JSON object.");
        }
        let id = value.get("id").cloned().unwrap_or(Value::from(0));
        let method = value.get("method").and_then(|item| item.as_str()).unwrap_or("");
        if method.is_empty() {
            return error_line(id, "bad_request", "Expected a method.");
        }
        let params = value.get("params").cloned().unwrap_or_else(|| json!({}));
        match self.dispatch(method, &params) {
            Ok(result) => json!({ "id": id, "ok": true, "result": result }),
            Err(err) => error_line(id, err.code, &err.message),
        }
    }

    fn dispatch(&self, method: &str, params: &Value) -> Result<Value, EngineError> {
        match method {
            "ping" => Ok(json!({ "name": "crunchcalld", "version": VERSION })),
            "catalog.list" => Ok(self.catalog.to_value()),
            "settings.get" => self.settings_get(),
            "settings.set" => self.settings_set(params),
            "secrets.put" => self.secrets_put(params),
            "secrets.has" => self.secrets_has(params),
            "secrets.delete" => self.secrets_delete(params),
            "models.list" => self.models_list(),
            "models.install" => self.models_install(params),
            "models.pause" => self.models_pause(params),
            "models.resume" => self.models_resume(params),
            "models.status" => self.models_status(params),
            "meetings.create" => self.meetings_create(params),
            "meetings.list" => self.meetings_list(),
            "meetings.get" => self.meetings_get(params),
            "meetings.update" => self.meetings_update(params),
            "meetings.delete" => self.meetings_delete(params),
            "folders.get" => self.folders_get(),
            "folders.set" => self.folders_set(params),
            "mcp.get" => self.mcp_get(),
            "mcp.set" => self.mcp_set(params),
            "utterances.append" => self.utterances_append(params),
            "utterances.list" => self.utterances_list(params),
            "notes.get" => self.notes_get(params),
            "notes.put" => self.notes_put(params),
            "actions.list" => self.actions_list(params),
            "actions.replace" => self.actions_replace(params),
            "search.query" => self.search_query(params),
            "coach.scan" => self.coach_scan(params),
            "dictate.start" => self.dictate_start(params),
            "dictate.push" => self.dictate_push(params),
            "dictate.stop" => self.dictate_stop(params),
            "dictate.commit" => self.dictate_commit(params),
            "dictate.list" => self.dictate_list(params),
            "speech.transcribe" => self.speech_transcribe(params),
            "writer.complete" => self.writer_complete(params),
            other => Err(EngineError::new(
                "bad_request",
                format!("Unknown method {other}."),
            )),
        }
    }

    fn settings_get(&self) -> Result<Value, EngineError> {
        let db = self.lock_db();
        let settings = db
            .get_settings()
            .map_err(db_err)?
            .unwrap_or_else(|| Settings::from_defaults(&self.catalog.defaults));
        Ok(json!({ "values": settings }))
    }

    fn settings_set(&self, params: &Value) -> Result<Value, EngineError> {
        let values = params.get("values").cloned().unwrap_or_else(|| params.clone());
        let mut settings: Settings = serde_json::from_value(values)
            .map_err(|err| EngineError::new("bad_request", format!("Settings: {err}")))?;
        let defaults = &self.catalog.defaults;
        if settings.speech.is_empty() {
            settings.speech = defaults.speech.clone();
        }
        if settings.writer.is_empty() {
            settings.writer = defaults.writer.clone();
        }
        if settings.coach.is_empty() {
            settings.coach = defaults.coach.clone();
        }
        if settings.coach_pack.is_empty() {
            settings.coach_pack = defaults.coach_pack.clone();
        }
        if settings.language.is_empty() {
            settings.language = "auto".to_string();
        }
        self.lock_db().set_settings(&settings).map_err(db_err)?;
        Ok(json!({ "values": settings }))
    }

    fn secrets_put(&self, params: &Value) -> Result<Value, EngineError> {
        let module_id = req_str(params, "moduleId")?;
        self.module(module_id)?;
        let key = req_str(params, "key")?;
        self.secrets.put(module_id, key)?;
        let target = format!("CrunchCall/{module_id}");
        self.lock_db()
            .set_secret_ref(module_id, &target)
            .map_err(db_err)?;
        Ok(json!({ "saved": true }))
    }

    fn secrets_has(&self, params: &Value) -> Result<Value, EngineError> {
        let module_id = req_str(params, "moduleId")?;
        let saved = self
            .secrets
            .get(module_id)?
            .map(|key| !key.trim().is_empty())
            .unwrap_or(false);
        Ok(json!({ "saved": saved }))
    }

    fn secrets_delete(&self, params: &Value) -> Result<Value, EngineError> {
        let module_id = req_str(params, "moduleId")?;
        self.secrets.delete(module_id)?;
        self.lock_db()
            .delete_secret_ref(module_id)
            .map_err(db_err)?;
        Ok(json!({ "saved": false }))
    }

    fn models_list(&self) -> Result<Value, EngineError> {
        let rows = self.lock_db().list_installs().map_err(db_err)?;
        Ok(json!({ "modules": rows }))
    }

    fn models_install(&self, params: &Value) -> Result<Value, EngineError> {
        let module_id = req_str(params, "moduleId")?;
        let module = self.module(module_id)?.clone();
        if module.download != "direct" {
            return self.install_without_download(&module);
        }
        if let Some(row) = self.lock_db().get_install(module_id).map_err(db_err)? {
            if row.status == "installed" && installed_file(row.path.as_deref()) {
                return Ok(row_value(&row));
            }
            if row.status == "downloading" && self.job_alive(module_id) {
                return Ok(row_value(&row));
            }
            if row.status == "paused" && self.job_alive(module_id) {
                return self.models_resume(params);
            }
        }
        self.begin_download(&module, params)
    }

    fn models_pause(&self, params: &Value) -> Result<Value, EngineError> {
        let module_id = req_str(params, "moduleId")?;
        self.module(module_id)?;
        let control = self.job(module_id);
        let _gate = control.as_ref().map(|control| lock_gate(&control.gate));
        if let Some(control) = &control {
            control.pause.store(true, Ordering::SeqCst);
        }
        let db = self.lock_db();
        let Some(row) = db.get_install(module_id).map_err(db_err)? else {
            return Err(EngineError::new("bad_request", "This model is not downloading."));
        };
        if row.status != "downloading" {
            return Ok(row_value(&row));
        }
        let saved = db
            .upsert_install(
                module_id,
                "paused",
                row.path.as_deref(),
                row.bytes_done,
                row.bytes_total,
                0,
                Some("Paused."),
            )
            .map_err(db_err)?;
        Ok(row_value(&saved))
    }

    fn models_resume(&self, params: &Value) -> Result<Value, EngineError> {
        let module_id = req_str(params, "moduleId")?;
        let module = self.module(module_id)?.clone();
        if module.download != "direct" {
            return Err(EngineError::new(
                "bad_request",
                format!("{} is not a direct download.", module.name),
            ));
        }
        if let Some(row) = self.lock_db().get_install(module_id).map_err(db_err)? {
            if row.status == "installed" && installed_file(row.path.as_deref()) {
                return Ok(row_value(&row));
            }
        }
        if let Some(control) = self.job(module_id) {
            if control.alive.load(Ordering::SeqCst) {
                let _gate = lock_gate(&control.gate);
                control.pause.store(false, Ordering::SeqCst);
                return self.mark_downloading(&module);
            }
        }
        self.begin_download(&module, params)
    }

    fn install_without_download(&self, module: &Module) -> Result<Value, EngineError> {
        match module.download.as_str() {
            "gated" => self.mark_manual(
                module,
                &format!(
                    "{} is gated. Accept the license with the maker, then put the file in the models folder.",
                    module.name
                ),
            ),
            "none" => {
                let row = self
                    .lock_db()
                    .upsert_install(&module.id, "installed", None, 0, Some(0), 0, Some("Already in the app."))
                    .map_err(db_err)?;
                Ok(row_value(&row))
            }
            _ => self.mark_manual(
                module,
                &format!(
                    "{} has no direct download yet. Put the model file in the models folder when you have it.",
                    module.name
                ),
            ),
        }
    }

    fn begin_download(&self, module: &Module, params: &Value) -> Result<Value, EngineError> {
        let url = direct_url(module, params);
        if url.trim().is_empty() {
            return self.mark_manual(module, "This module has no direct file yet.");
        }
        let dest = self.model_path(module);
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent).map_err(|err| {
                EngineError::new("io", format!("Could not create the model folder: {err}"))
            })?;
        }
        let control = {
            let mut jobs = self.lock_jobs();
            if let Some(existing) = jobs.get(&module.id) {
                if existing.alive.load(Ordering::SeqCst) {
                    let _gate = lock_gate(&existing.gate);
                    existing.pause.store(false, Ordering::SeqCst);
                    return self.mark_downloading(module);
                }
            }
            let control = Arc::new(DownloadControl {
                pause: AtomicBool::new(false),
                alive: AtomicBool::new(true),
                gate: Mutex::new(()),
            });
            jobs.insert(module.id.clone(), control.clone());
            control
        };
        let row = self.mark_downloading(module)?;
        let data_dir = self.data_dir.clone();
        let module_id = module.id.clone();
        std::thread::spawn(move || run_download(data_dir, module_id, url, dest, control));
        Ok(row)
    }

    fn mark_downloading(&self, module: &Module) -> Result<Value, EngineError> {
        let dest = self.model_path(module);
        let existing = self.lock_db().get_install(&module.id).map_err(db_err)?;
        let on_disk = file_len(&partial_path(&dest)).max(if dest.is_file() { file_len(&dest) } else { 0 });
        let bytes_done = existing
            .as_ref()
            .map(|row| row.bytes_done)
            .unwrap_or(0)
            .max(on_disk as i64);
        let bytes_total = existing.as_ref().and_then(|row| row.bytes_total);
        let message = if bytes_done > 0 { "Continuing." } else { "Download started." };
        let row = self
            .lock_db()
            .upsert_install(
                &module.id,
                "downloading",
                Some(&dest.display().to_string()),
                bytes_done,
                bytes_total,
                0,
                Some(message),
            )
            .map_err(db_err)?;
        Ok(row_value(&row))
    }

    fn mark_manual(&self, module: &Module, message: &str) -> Result<Value, EngineError> {
        let row = self
            .lock_db()
            .upsert_install(&module.id, "manual", None, 0, None, 0, Some(message))
            .map_err(db_err)?;
        Ok(row_value(&row))
    }

    fn job(&self, module_id: &str) -> Option<Arc<DownloadControl>> {
        self.lock_jobs().get(module_id).cloned()
    }

    fn job_alive(&self, module_id: &str) -> bool {
        self.job(module_id)
            .map(|job| job.alive.load(Ordering::SeqCst))
            .unwrap_or(false)
    }

    fn models_status(&self, params: &Value) -> Result<Value, EngineError> {
        let module_id = req_str(params, "moduleId")?;
        self.module(module_id)?;
        match self.lock_db().get_install(module_id).map_err(db_err)? {
            Some(row) => Ok(serde_json::to_value(row).unwrap_or_else(|_| json!({}))),
            None => Ok(json!({ "moduleId": module_id, "status": "missing" })),
        }
    }

    fn meetings_create(&self, params: &Value) -> Result<Value, EngineError> {
        let title = params.get("title").and_then(|value| value.as_str()).unwrap_or("");
        let status = params.get("status").and_then(|value| value.as_str()).unwrap_or("draft");
        let started_at = opt_i64(params, "startedAt");
        let meeting = self
            .lock_db()
            .create_meeting(title, status, started_at)
            .map_err(db_err)?;
        Ok(serde_json::to_value(meeting).unwrap_or_else(|_| json!({})))
    }

    fn meetings_list(&self) -> Result<Value, EngineError> {
        let meetings = self.lock_db().list_meetings().map_err(db_err)?;
        Ok(json!({ "meetings": meetings }))
    }

    fn meetings_get(&self, params: &Value) -> Result<Value, EngineError> {
        let id = req_str(params, "id")?;
        let meeting = self.lock_db().get_meeting(id).map_err(db_err)?;
        Ok(serde_json::to_value(meeting).unwrap_or_else(|_| json!({})))
    }

    fn meetings_update(&self, params: &Value) -> Result<Value, EngineError> {
        let id = req_str(params, "id")?;
        let mut patch = Map::new();
        for key in ["title", "status", "startedAt", "endedAt"] {
            if let Some(value) = params.get(key) {
                patch.insert(key.to_string(), value.clone());
            }
        }
        let meeting = self.lock_db().update_meeting(id, &patch).map_err(db_err)?;
        Ok(serde_json::to_value(meeting).unwrap_or_else(|_| json!({})))
    }

    fn meetings_delete(&self, params: &Value) -> Result<Value, EngineError> {
        let id = req_str(params, "id")?;
        self.lock_db().delete_meeting(id).map_err(db_err)?;
        Ok(json!({ "deleted": true }))
    }

    fn folders_get(&self) -> Result<Value, EngineError> {
        let raw = self.lock_db().get_blob("folders").map_err(db_err)?;
        let folders = raw
            .and_then(|text| serde_json::from_str::<Value>(&text).ok())
            .filter(|value| value.is_array())
            .unwrap_or_else(|| json!([]));
        Ok(json!({ "folders": folders }))
    }

    fn folders_set(&self, params: &Value) -> Result<Value, EngineError> {
        let folders = params.get("folders").cloned().unwrap_or_else(|| json!([]));
        if !folders.is_array() {
            return Err(EngineError::new("bad_request", "Folders must be a list."));
        }
        let raw = serde_json::to_string(&folders)
            .map_err(|err| EngineError::new("bad_request", format!("Folders: {err}")))?;
        if raw.len() > 500_000 {
            return Err(EngineError::new("bad_request", "That folder list is too large."));
        }
        self.lock_db().set_blob("folders", &raw).map_err(db_err)?;
        Ok(json!({ "folders": folders }))
    }

    fn mcp_get(&self) -> Result<Value, EngineError> {
        Ok(json!({ "policy": policy_json(read_mcp_policy(&self.lock_db())) }))
    }

    fn mcp_set(&self, params: &Value) -> Result<Value, EngineError> {
        let current = read_mcp_policy(&self.lock_db());
        let enabled = params.get("enabled").and_then(|value| value.as_bool()).unwrap_or(current.enabled);
        let transcripts = params
            .get("transcripts")
            .and_then(|value| value.as_bool())
            .unwrap_or(current.transcripts);
        let actions = params.get("actions").and_then(|value| value.as_bool()).unwrap_or(current.actions);
        let policy = json!({ "enabled": enabled, "transcripts": transcripts, "actions": actions });
        let raw = serde_json::to_string(&policy).unwrap_or_else(|_| "{}".to_string());
        self.lock_db().set_blob("mcp", &raw).map_err(db_err)?;
        Ok(json!({ "policy": policy }))
    }

    fn utterances_append(&self, params: &Value) -> Result<Value, EngineError> {
        let meeting_id = req_str(params, "meetingId")?;
        let text = req_str(params, "text")?;
        let speaker = params.get("speaker").and_then(|value| value.as_str());
        let utterance = self
            .lock_db()
            .append_utterance(meeting_id, speaker, text, opt_i64(params, "startedAt"), opt_i64(params, "endedAt"))
            .map_err(db_err)?;
        Ok(serde_json::to_value(utterance).unwrap_or_else(|_| json!({})))
    }

    fn utterances_list(&self, params: &Value) -> Result<Value, EngineError> {
        let meeting_id = req_str(params, "meetingId")?;
        let rows = self.lock_db().list_utterances(meeting_id).map_err(db_err)?;
        Ok(json!({ "utterances": rows }))
    }

    fn notes_get(&self, params: &Value) -> Result<Value, EngineError> {
        let meeting_id = req_str(params, "meetingId")?;
        let notes = self.lock_db().get_notes(meeting_id).map_err(db_err)?;
        Ok(json!({ "notes": notes }))
    }

    fn notes_put(&self, params: &Value) -> Result<Value, EngineError> {
        let meeting_id = req_str(params, "meetingId")?;
        let summary = params.get("summary").and_then(|value| value.as_str()).unwrap_or("");
        let markdown = params.get("markdown").and_then(|value| value.as_str()).unwrap_or("");
        let takeaways = string_list(params.get("takeaways"))?;
        let notes = self
            .lock_db()
            .put_notes(meeting_id, summary, &takeaways, markdown)
            .map_err(db_err)?;
        Ok(serde_json::to_value(notes).unwrap_or_else(|_| json!({})))
    }

    fn actions_list(&self, params: &Value) -> Result<Value, EngineError> {
        let meeting_id = req_str(params, "meetingId")?;
        let items = self.lock_db().list_actions(meeting_id).map_err(db_err)?;
        Ok(json!({ "items": items }))
    }

    fn actions_replace(&self, params: &Value) -> Result<Value, EngineError> {
        let meeting_id = req_str(params, "meetingId")?;
        let raw = params.get("items").and_then(|value| value.as_array());
        let mut drafts = Vec::new();
        if let Some(items) = raw {
            for item in items {
                let text = item.get("text").and_then(|value| value.as_str()).unwrap_or("").to_string();
                if text.trim().is_empty() {
                    continue;
                }
                drafts.push(ActionDraft {
                    text,
                    owner: item.get("owner").and_then(|value| value.as_str()).map(|value| value.to_string()),
                    due: item.get("due").and_then(|value| value.as_str()).map(|value| value.to_string()),
                });
            }
        }
        let items = self.lock_db().replace_actions(meeting_id, &drafts).map_err(db_err)?;
        Ok(json!({ "items": items }))
    }

    fn search_query(&self, params: &Value) -> Result<Value, EngineError> {
        let q = params.get("q").and_then(|value| value.as_str()).unwrap_or("");
        let hits = self.lock_db().search(q).map_err(db_err)?;
        Ok(json!({ "hits": hits }))
    }

    fn coach_scan(&self, params: &Value) -> Result<Value, EngineError> {
        let lines = string_list(params.get("lines"))?;
        let pack = params
            .get("pack")
            .and_then(|value| value.as_str())
            .map(|value| value.to_string())
            .unwrap_or_else(|| self.current_settings().coach_pack);
        let cues = coach::scan(&lines, &pack);
        Ok(json!({ "cues": cues }))
    }

    fn dictate_start(&self, params: &Value) -> Result<Value, EngineError> {
        let module_id = req_str(params, "moduleId")?;
        let module = self.module(module_id)?.clone();
        if module.kind != "speech" {
            return Err(EngineError::new("bad_request", "Dictate needs a speech module."));
        }
        if module.place == "external" {
            return Err(EngineError::new(
                "use_commit",
                format!("{} hears the mic. Paste the text with dictate.commit.", module.name),
            ));
        }
        let sample_rate = params.get("sampleRate").and_then(|value| value.as_u64()).unwrap_or(16000);
        let sample_rate = u32::try_from(sample_rate).unwrap_or(16000).max(1);
        let session_id = new_id("s");
        self.lock_sessions().insert(
            session_id.clone(),
            Session {
                module_id: module.id,
                sample_rate,
                pcm: Vec::new(),
            },
        );
        Ok(json!({ "sessionId": session_id }))
    }

    fn dictate_push(&self, params: &Value) -> Result<Value, EngineError> {
        let session_id = req_str(params, "sessionId")?;
        let pcm_b64 = req_str(params, "pcmBase64")?;
        let module_id = {
            let sessions = self.lock_sessions();
            sessions
                .get(session_id)
                .map(|session| session.module_id.clone())
                .ok_or_else(|| EngineError::new("not_found", "That dictation session is gone."))?
        };
        let module = self.module(&module_id)?.clone();
        if is_unlinked_runtime(&module.runtime) {
            return Err(self.unlinked(&module));
        }
        if !module.client_ready {
            return Err(not_ready(&module));
        }
        let bytes = decode_base64(pcm_b64)?;
        let mut sessions = self.lock_sessions();
        let session = sessions
            .get_mut(session_id)
            .ok_or_else(|| EngineError::new("not_found", "That dictation session is gone."))?;
        if session.pcm.len().saturating_add(bytes.len()) > PCM_CAP {
            return Err(EngineError::new(
                "too_long",
                "That dictation is longer than this build will hold.",
            ));
        }
        session.pcm.extend_from_slice(&bytes);
        Ok(json!({ "buffered": session.pcm.len() }))
    }

    fn dictate_stop(&self, params: &Value) -> Result<Value, EngineError> {
        let session_id = req_str(params, "sessionId")?;
        let session = self
            .lock_sessions()
            .remove(session_id)
            .ok_or_else(|| EngineError::new("not_found", "That dictation session is gone."))?;
        let module = self.module(&session.module_id)?.clone();
        if is_unlinked_runtime(&module.runtime) {
            return Err(self.unlinked(&module));
        }
        if !module.client_ready {
            return Err(not_ready(&module));
        }
        if session.pcm.is_empty() {
            return Err(EngineError::new("bad_request", "No audio arrived."));
        }
        let wav = wrap_pcm_wav(&session.pcm, session.sample_rate);
        let outcome = self.transcribe_module(&module, &wav, None)?;
        self.finish_speech(&module.id, outcome)
    }

    fn dictate_commit(&self, params: &Value) -> Result<Value, EngineError> {
        let text = req_str(params, "text")?;
        let module_id = req_str(params, "moduleId")?;
        self.module(module_id)?;
        let meeting_id = params.get("meetingId").and_then(|value| value.as_str());
        let dictation = self
            .lock_db()
            .insert_dictation(meeting_id, module_id, text)
            .map_err(db_err)?;
        Ok(json!({ "text": dictation.text, "dictation": dictation }))
    }

    fn dictate_list(&self, params: &Value) -> Result<Value, EngineError> {
        let limit = params.get("limit").and_then(|value| value.as_i64()).unwrap_or(20).clamp(1, 200);
        let rows = self.lock_db().list_dictations(limit).map_err(db_err)?;
        Ok(json!({ "dictations": rows }))
    }

    fn speech_transcribe(&self, params: &Value) -> Result<Value, EngineError> {
        let module_id = req_str(params, "moduleId")?;
        let module = self.module(module_id)?.clone();
        if module.kind != "speech" {
            return Err(EngineError::new("bad_request", "That module does not transcribe."));
        }
        let wav = decode_base64(req_str(params, "wavBase64")?)?;
        let language = params.get("language").and_then(|value| value.as_str());
        let outcome = self.transcribe_module(&module, &wav, language)?;
        Ok(outcome_value(outcome))
    }

    fn writer_complete(&self, params: &Value) -> Result<Value, EngineError> {
        let module_id = req_str(params, "moduleId")?;
        let module = self.module(module_id)?.clone();
        if module.kind != "writer" {
            return Err(EngineError::new("bad_request", "That module does not write notes."));
        }
        if is_unlinked_runtime(&module.runtime) {
            return Err(self.unlinked(&module));
        }
        if !module.client_ready {
            return Err(not_ready(&module));
        }
        let key = self.saved_key(&module.id)?;
        let model = self.model_for(&module);
        let system = params.get("system").and_then(|value| value.as_str()).unwrap_or("");
        let prompt = params.get("prompt").and_then(|value| value.as_str()).unwrap_or("");
        let base = module.base_url.clone().unwrap_or_default();
        let text = complete_with(&UreqTransport, &module.runtime, &base, &model, &key, system, prompt)?;
        Ok(json!({ "text": text, "model": model }))
    }

    fn transcribe_module(&self, module: &Module, wav: &[u8], language: Option<&str>) -> Result<SpeechOutcome, EngineError> {
        if module.place == "external" {
            return Err(EngineError::new(
                "use_commit",
                format!("{} hears the mic. Paste the text instead.", module.name),
            ));
        }
        if is_unlinked_runtime(&module.runtime) {
            return Err(self.unlinked(module));
        }
        if !module.client_ready {
            return Err(not_ready(module));
        }
        let key = self.saved_key(&module.id)?;
        let model = self.model_for(module);
        let base = module.base_url.clone().unwrap_or_default();
        let saved = self.current_settings().language;
        let language = language.unwrap_or(saved.as_str());
        transcribe_with(&UreqTransport, &module.runtime, &base, &model, &key, wav, language)
    }

    fn finish_speech(&self, module_id: &str, outcome: SpeechOutcome) -> Result<Value, EngineError> {
        match outcome {
            SpeechOutcome::Text(text) => {
                let dictation = self
                    .lock_db()
                    .insert_dictation(None, module_id, &text)
                    .map_err(db_err)?;
                Ok(json!({ "text": text, "dictation": dictation }))
            }
            SpeechOutcome::Pending { id } => Err(EngineError::new(
                "pending",
                format!("The transcript is still running ({id})."),
            )),
        }
    }

    fn saved_key(&self, module_id: &str) -> Result<String, EngineError> {
        match self.secrets.get(module_id)? {
            Some(key) if !key.trim().is_empty() => Ok(key),
            _ => Err(EngineError::new(
                "missing_key",
                "No API key is saved for this module.",
            )),
        }
    }

    fn model_for(&self, module: &Module) -> String {
        let settings = self.current_settings();
        if let Some(value) = settings
            .model_overrides
            .get(&module.id)
            .and_then(|value| value.as_str())
        {
            let value = value.trim();
            if !value.is_empty() {
                return value.to_string();
            }
        }
        module.model.clone().unwrap_or_default()
    }

    fn current_settings(&self) -> Settings {
        self.lock_db()
            .get_settings()
            .ok()
            .flatten()
            .unwrap_or_else(|| Settings::from_defaults(&self.catalog.defaults))
    }

    fn unlinked(&self, module: &Module) -> EngineError {
        let ready = self
            .lock_db()
            .get_install(&module.id)
            .ok()
            .flatten()
            .map(|row| row.status == "installed" && row.path.as_deref().map(|path| Path::new(path).is_file()).unwrap_or(false))
            .unwrap_or(false);
        let message = if ready {
            format!(
                "{} is downloaded. {} is not linked in this build yet.",
                module.name, module.runtime
            )
        } else {
            format!("{} is not linked in this build yet.", module.runtime)
        };
        EngineError::new("engine_not_linked", message)
    }

    fn module(&self, id: &str) -> Result<&Module, EngineError> {
        self.catalog
            .get(id)
            .ok_or_else(|| EngineError::new("not_found", format!("No module {id}.")))
    }

    fn model_path(&self, module: &Module) -> PathBuf {
        let filename = module
            .model
            .as_deref()
            .map(str::trim)
            .filter(|name| !name.is_empty() && !name.contains(['/', '\\', ':']))
            .unwrap_or("model.bin");
        self.data_dir.join("models").join(&module.id).join(filename)
    }

    fn lock_db(&self) -> std::sync::MutexGuard<'_, Db> {
        self.db.lock().unwrap_or_else(|err| err.into_inner())
    }

    fn lock_jobs(&self) -> std::sync::MutexGuard<'_, HashMap<String, Arc<DownloadControl>>> {
        self.jobs.lock().unwrap_or_else(|err| err.into_inner())
    }

    fn lock_sessions(&self) -> std::sync::MutexGuard<'_, HashMap<String, Session>> {
        self.sessions.lock().unwrap_or_else(|err| err.into_inner())
    }
}

fn run_download(
    data_dir: PathBuf,
    module_id: String,
    url: String,
    dest: PathBuf,
    control: Arc<DownloadControl>,
) {
    let partial = partial_path(&dest);
    let db = match Db::open(&data_dir) {
        Ok(db) => db,
        Err(err) => {
            eprintln!("crunchcalld: {err}");
            control.alive.store(false, Ordering::SeqCst);
            return;
        }
    };
    let outcome = loop {
        {
            let _gate = lock_gate(&control.gate);
            if control.pause.load(Ordering::SeqCst) {
                remember_paused(&db, &module_id, &dest);
                drop(_gate);
                while control.pause.load(Ordering::SeqCst) {
                    std::thread::sleep(Duration::from_millis(150));
                }
                let _gate = lock_gate(&control.gate);
                remember_downloading(&db, &module_id, &dest);
            }
        }
        let mut last_write = Instant::now() - Duration::from_secs(1);
        match pull_file(&url, &partial, &dest, &control.pause, |progress| {
            if control.pause.load(Ordering::SeqCst) {
                return;
            }
            if last_write.elapsed() < Duration::from_millis(200) {
                return;
            }
            last_write = Instant::now();
            let _ = db.touch_download_progress(
                &module_id,
                progress.bytes_done,
                progress.bytes_total,
                progress.speed_bps,
                "Downloading.",
            );
        }) {
            Ok(PullStop::Finished) => break Ok(()),
            Ok(PullStop::Paused) => continue,
            Err(err) => break Err(err),
        }
    };
    {
        let _gate = lock_gate(&control.gate);
        match outcome {
            Ok(()) => {
                let bytes = file_len(&dest) as i64;
                let _ = db.upsert_install(
                    &module_id,
                    "installed",
                    Some(&dest.display().to_string()),
                    bytes,
                    Some(bytes),
                    0,
                    Some("Downloaded."),
                );
            }
            Err(err) => {
                eprintln!("crunchcalld: {}", err.message);
                let done = file_len(&partial) as i64;
                let _ = db.upsert_install(
                    &module_id,
                    "error",
                    Some(&dest.display().to_string()),
                    done,
                    None,
                    0,
                    Some(&err.message),
                );
            }
        }
        control.alive.store(false, Ordering::SeqCst);
    }
}

fn remember_paused(db: &Db, module_id: &str, dest: &Path) {
    let done = file_len(&partial_path(dest)) as i64;
    let existing = db.get_install(module_id).ok().flatten();
    let total = existing.as_ref().and_then(|row| row.bytes_total);
    let bytes = done.max(existing.as_ref().map(|row| row.bytes_done).unwrap_or(0));
    let _ = db.upsert_install(
        module_id,
        "paused",
        Some(&dest.display().to_string()),
        bytes,
        total,
        0,
        Some("Paused."),
    );
}

fn remember_downloading(db: &Db, module_id: &str, dest: &Path) {
    let done = file_len(&partial_path(dest)) as i64;
    let existing = db.get_install(module_id).ok().flatten();
    let total = existing.as_ref().and_then(|row| row.bytes_total);
    let bytes = done.max(existing.as_ref().map(|row| row.bytes_done).unwrap_or(0));
    let message = if bytes > 0 { "Continuing." } else { "Download started." };
    let _ = db.upsert_install(
        module_id,
        "downloading",
        Some(&dest.display().to_string()),
        bytes,
        total,
        0,
        Some(message),
    );
}

fn partial_path(dest: &Path) -> PathBuf {
    let mut name = dest.file_name().map(|name| name.to_os_string()).unwrap_or_default();
    name.push(".partial");
    dest.with_file_name(name)
}

fn file_len(path: &Path) -> u64 {
    fs::metadata(path).map(|meta| meta.len()).unwrap_or(0)
}

fn installed_file(path: Option<&str>) -> bool {
    path.map(|path| Path::new(path).is_file()).unwrap_or(false)
}

fn row_value(row: &crunchcall_db::InstallRow) -> Value {
    serde_json::to_value(row).unwrap_or_else(|_| json!({}))
}

fn lock_gate(gate: &Mutex<()>) -> std::sync::MutexGuard<'_, ()> {
    gate.lock().unwrap_or_else(|err| err.into_inner())
}

fn direct_url(module: &Module, params: &Value) -> String {
    #[cfg(test)]
    if let Some(url) = params.get("downloadUrl").and_then(|value| value.as_str()) {
        let url = url.trim();
        if url.starts_with("http://127.0.0.1:") || url.starts_with("http://localhost:") {
            return url.to_string();
        }
    }
    #[cfg(not(test))]
    let _ = params;
    module.download_url.clone().unwrap_or_default()
}

fn outcome_value(outcome: SpeechOutcome) -> Value {
    match outcome {
        SpeechOutcome::Text(text) => json!({ "text": text }),
        SpeechOutcome::Pending { id } => json!({ "pending": true, "id": id }),
    }
}

fn not_ready(module: &Module) -> EngineError {
    EngineError::new(
        "not_ready",
        format!("{} is listed. Its client is not in this build yet.", module.name),
    )
}

pub fn data_dir() -> PathBuf {
    data_dir_from_env()
}

pub fn read_mcp_policy(db: &Db) -> McpPolicy {
    let raw = db.get_blob("mcp").ok().flatten();
    let parsed = raw.and_then(|text| serde_json::from_str::<Value>(&text).ok());
    match parsed {
        Some(value) => McpPolicy {
            enabled: value.get("enabled").and_then(|item| item.as_bool()).unwrap_or(true),
            transcripts: value.get("transcripts").and_then(|item| item.as_bool()).unwrap_or(true),
            actions: value.get("actions").and_then(|item| item.as_bool()).unwrap_or(true),
        },
        None => McpPolicy::default(),
    }
}

#[derive(Debug, Clone, Copy)]
pub struct McpPolicy {
    pub enabled: bool,
    pub transcripts: bool,
    pub actions: bool,
}

impl Default for McpPolicy {
    fn default() -> Self {
        Self {
            enabled: true,
            transcripts: true,
            actions: true,
        }
    }
}

fn policy_json(policy: McpPolicy) -> Value {
    json!({
        "enabled": policy.enabled,
        "transcripts": policy.transcripts,
        "actions": policy.actions,
    })
}

fn data_dir_from_env() -> PathBuf {
    if let Ok(dir) = std::env::var("CRUNCHCALL_DATA_DIR") {
        let dir = dir.trim();
        if !dir.is_empty() {
            return PathBuf::from(dir);
        }
    }
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        let local = local.trim();
        if !local.is_empty() {
            return PathBuf::from(local).join("CrunchCall");
        }
    }
    PathBuf::from(".crunchcall-data")
}

fn req_str<'a>(params: &'a Value, key: &str) -> Result<&'a str, EngineError> {
    params
        .get(key)
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| EngineError::new("bad_request", format!("Missing {key}.")))
}

fn opt_i64(params: &Value, key: &str) -> Option<i64> {
    params.get(key).and_then(|value| value.as_i64())
}

fn string_list(value: Option<&Value>) -> Result<Vec<String>, EngineError> {
    let Some(value) = value else {
        return Ok(Vec::new());
    };
    let Some(items) = value.as_array() else {
        return Err(EngineError::new("bad_request", "Expected a list of strings."));
    };
    let mut out = Vec::with_capacity(items.len());
    for item in items {
        if let Some(text) = item.as_str() {
            out.push(text.to_string());
        }
    }
    Ok(out)
}

fn error_line(id: Value, code: &str, message: &str) -> Value {
    json!({
        "id": id,
        "ok": false,
        "error": { "code": code, "message": message },
    })
}

fn db_err(err: DbError) -> EngineError {
    EngineError::new(err.code(), err.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crunchcall_core::MemorySecretStore;

    struct TempDir(PathBuf);

    impl TempDir {
        fn new(label: &str) -> Self {
            let path = std::env::temp_dir().join(format!(
                "crunchcall-engine-{label}-{}-{}",
                std::process::id(),
                new_id("t")
            ));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn engine(dir: &Path) -> Engine {
        Engine::open_in(dir, Box::new(MemorySecretStore::new())).unwrap()
    }

    #[test]
    fn secret_is_not_stored_in_sqlite() {
        let dir = TempDir::new("secret");
        let engine = engine(&dir.0);
        let key = "super-secret-key-xyz";
        let line = format!(
            r#"{{"id":1,"method":"secrets.put","params":{{"moduleId":"writer.openai","key":"{key}"}}}}"#
        );
        let response = engine.handle_line(&line);
        assert_eq!(response["ok"], true);
        let has = engine.handle_line(r#"{"id":2,"method":"secrets.has","params":{"moduleId":"writer.openai"}}"#);
        assert_eq!(has["result"]["saved"], true);
        {
            let db = engine.lock_db();
            db.checkpoint().unwrap();
        }
        drop(engine);
        let mut haystack = Vec::new();
        for name in ["crunchcall.db", "crunchcall.db-wal", "crunchcall.db-shm"] {
            let path = dir.0.join(name);
            if let Ok(bytes) = fs::read(path) {
                haystack.extend(bytes);
            }
        }
        let text = String::from_utf8_lossy(&haystack);
        assert!(
            !text.contains(key),
            "the API key was written into the database files"
        );
        assert!(text.contains("CrunchCall/writer.openai"));
    }

    #[test]
    fn dictate_commit_and_manual_install_do_not_download() {
        let dir = TempDir::new("commit");
        let engine = engine(&dir.0);
        let committed = engine.handle_line(
            r#"{"id":1,"method":"dictate.commit","params":{"text":"Ship the notes","moduleId":"speech.ext.willow"}}"#,
        );
        assert_eq!(committed["ok"], true, "{committed}");
        assert_eq!(committed["result"]["text"], "Ship the notes");
        let listed = engine.handle_line(r#"{"id":2,"method":"dictate.list","params":{"limit":5}}"#);
        assert_eq!(listed["result"]["dictations"][0]["text"], "Ship the notes");

        let install = engine.handle_line(
            r#"{"id":3,"method":"models.install","params":{"moduleId":"writer.llama3.2-3b"}}"#,
        );
        assert_eq!(install["ok"], true, "{install}");
        assert_eq!(install["result"]["status"], "manual");
        let whisper = engine.handle_line(
            r#"{"id":4,"method":"dictate.start","params":{"moduleId":"speech.whisper.tiny","sampleRate":16000}}"#,
        );
        let session = whisper["result"]["sessionId"].as_str().unwrap();
        let pushed = engine.handle_line(&format!(
            r#"{{"id":5,"method":"dictate.push","params":{{"sessionId":"{session}","pcmBase64":"AAAA"}}}}"#
        ));
        assert_eq!(pushed["ok"], false);
        assert_eq!(pushed["error"]["code"], "engine_not_linked");
    }

    #[test]
    fn pause_and_resume_report_bytes_and_speed() {
        use std::io::{Read, Write};
        use std::net::TcpListener;
        use std::sync::{Arc, Mutex};
        use std::thread;
        use std::time::Duration;

        let body = vec![5u8; 192 * 1024];
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let ranges = Arc::new(Mutex::new(Vec::<u64>::new()));
        let recorded = ranges.clone();
        let payload = body.clone();
        thread::spawn(move || {
            for _ in 0..8 {
                let Ok((mut sock, _)) = listener.accept() else { break };
                let _ = sock.set_nodelay(true);
                let _ = sock.set_read_timeout(Some(Duration::from_secs(2)));
                let mut got = Vec::new();
                let mut buf = [0u8; 1024];
                while got.windows(4).all(|item| item != b"\r\n\r\n") && got.len() < 8192 {
                    match sock.read(&mut buf) {
                        Ok(0) | Err(_) => break,
                        Ok(n) => got.extend_from_slice(&buf[..n]),
                    }
                }
                let request = String::from_utf8_lossy(&got);
                let mut start = 0u64;
                for line in request.split("\r\n") {
                    let lower = line.to_ascii_lowercase();
                    if let Some(rest) = lower.strip_prefix("range:") {
                        if let Some(spec) = rest.trim().strip_prefix("bytes=") {
                            start = spec.split('-').next().unwrap_or("0").trim().parse().unwrap_or(0);
                        }
                    }
                }
                if start > 0 {
                    recorded.lock().unwrap().push(start);
                }
                let start_at = start.min(payload.len() as u64) as usize;
                let slice = &payload[start_at..];
                let header = if start_at == 0 {
                    format!(
                        "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nAccept-Ranges: bytes\r\nConnection: close\r\n\r\n",
                        payload.len()
                    )
                } else {
                    format!(
                        "HTTP/1.1 206 Partial Content\r\nContent-Range: bytes {}-{}/{}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                        start_at,
                        payload.len() - 1,
                        payload.len(),
                        slice.len()
                    )
                };
                if sock.write_all(header.as_bytes()).is_err() {
                    continue;
                }
                for chunk in slice.chunks(8 * 1024) {
                    if sock.write_all(chunk).is_err() {
                        break;
                    }
                    thread::sleep(Duration::from_millis(30));
                }
            }
        });

        let dir = TempDir::new("pull");
        let engine = engine(&dir.0);
        let line = format!(
            r#"{{"id":1,"method":"models.install","params":{{"moduleId":"speech.whisper.tiny","downloadUrl":"http://127.0.0.1:{port}/ggml-tiny.bin"}}}}"#
        );
        let started = engine.handle_line(&line);
        assert_eq!(started["ok"], true, "{started}");

        let mut saw_speed = false;
        let deadline = std::time::Instant::now() + Duration::from_secs(8);
        loop {
            assert!(std::time::Instant::now() < deadline, "download never reported progress");
            let status = engine.handle_line(
                r#"{"id":2,"method":"models.status","params":{"moduleId":"speech.whisper.tiny"}}"#,
            );
            let bytes = status["result"]["bytesDone"].as_i64().unwrap_or(0);
            let speed = status["result"]["speedBps"].as_i64().unwrap_or(0);
            let state = status["result"]["status"].as_str().unwrap_or("");
            if speed > 0 {
                saw_speed = true;
            }
            if state == "installed" {
                panic!("finished before pause: {status}");
            }
            if saw_speed && bytes > 0 && state == "downloading" {
                break;
            }
            thread::sleep(Duration::from_millis(40));
        }
        assert!(saw_speed, "download speed stayed at 0");

        let paused = engine.handle_line(
            r#"{"id":3,"method":"models.pause","params":{"moduleId":"speech.whisper.tiny"}}"#,
        );
        assert_eq!(paused["ok"], true, "{paused}");
        assert_eq!(paused["result"]["status"], "paused");
        assert_eq!(paused["result"]["speedBps"], 0);
        let paused_bytes = paused["result"]["bytesDone"].as_i64().unwrap_or(0);
        assert!(paused_bytes > 0, "pause reported no bytes");
        let partial = dir
            .0
            .join("models")
            .join("speech.whisper.tiny")
            .join("ggml-tiny.bin.partial");
        thread::sleep(Duration::from_millis(250));
        assert!(partial.is_file(), "pause removed the partial file");
        let held = engine.handle_line(
            r#"{"id":4,"method":"models.status","params":{"moduleId":"speech.whisper.tiny"}}"#,
        );
        assert_eq!(held["result"]["status"], "paused");
        assert!(held["result"]["bytesDone"].as_i64().unwrap_or(0) >= paused_bytes);

        let resumed = engine.handle_line(&format!(
            r#"{{"id":5,"method":"models.resume","params":{{"moduleId":"speech.whisper.tiny","downloadUrl":"http://127.0.0.1:{port}/ggml-tiny.bin"}}}}"#
        ));
        assert_eq!(resumed["ok"], true, "{resumed}");
        assert_eq!(resumed["result"]["status"], "downloading");

        let deadline = std::time::Instant::now() + Duration::from_secs(8);
        loop {
            assert!(std::time::Instant::now() < deadline, "download did not finish");
            let status = engine.handle_line(
                r#"{"id":6,"method":"models.status","params":{"moduleId":"speech.whisper.tiny"}}"#,
            );
            if status["result"]["status"] == "installed" {
                assert_eq!(status["result"]["bytesDone"].as_i64().unwrap_or(0), body.len() as i64);
                assert_eq!(status["result"]["speedBps"].as_i64().unwrap_or(-1), 0);
                break;
            }
            if status["result"]["status"] == "error" {
                panic!("download failed: {status}");
            }
            thread::sleep(Duration::from_millis(40));
        }
        let saved = dir
            .0
            .join("models")
            .join("speech.whisper.tiny")
            .join("ggml-tiny.bin");
        assert_eq!(fs::read(&saved).unwrap(), body);
        assert!(!partial.exists());
        let seen = ranges.lock().unwrap().clone();
        assert!(
            seen.iter().any(|start| *start > 0),
            "continue did not resume with Range, saw {seen:?}"
        );
        thread::sleep(Duration::from_millis(200));
    }

    #[test]
    fn malformed_line_uses_id_zero() {
        let dir = TempDir::new("bad");
        let engine = engine(&dir.0);
        let response = engine.handle_line("not json");
        assert_eq!(response["id"], 0);
        assert_eq!(response["ok"], false);
    }

    #[test]
    fn meeting_delete_and_folders_roundtrip() {
        let dir = TempDir::new("desk");
        let engine = engine(&dir.0);
        let created = engine.handle_line(
            r#"{"id":1,"method":"meetings.create","params":{"title":"Pilot","status":"live"}}"#,
        );
        assert_eq!(created["ok"], true, "{created}");
        let id = created["result"]["id"].as_str().unwrap();
        let appended = engine.handle_line(&format!(
            r#"{{"id":2,"method":"utterances.append","params":{{"meetingId":"{id}","speaker":"You","text":"Ship the checklist Friday"}}}}"#
        ));
        assert_eq!(appended["ok"], true, "{appended}");
        let folders = engine.handle_line(
            r#"{"id":3,"method":"folders.set","params":{"folders":[{"id":"f1","name":"Northwind","meetingIds":[]}]}}"#,
        );
        assert_eq!(folders["ok"], true, "{folders}");
        let listed = engine.handle_line(r#"{"id":4,"method":"folders.get","params":{}}"#);
        assert_eq!(listed["result"]["folders"][0]["name"], "Northwind");
        let removed = engine.handle_line(&format!(
            r#"{{"id":5,"method":"meetings.delete","params":{{"id":"{id}"}}}}"#
        ));
        assert_eq!(removed["ok"], true, "{removed}");
        let again = engine.handle_line(r#"{"id":6,"method":"meetings.list","params":{}}"#);
        assert_eq!(again["result"]["meetings"].as_array().unwrap().len(), 0);
    }
}
