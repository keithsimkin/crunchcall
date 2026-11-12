use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use serde_json::{json, Value};

use crate::error::{provider_http, redact_snippet, EngineError};
use crate::ids::{new_id, now_ms};
use crate::wav::encode_base64;

pub fn is_unlinked_runtime(runtime: &str) -> bool {
    matches!(runtime, "whisper.cpp" | "sherpa-onnx" | "llama.cpp")
}

#[derive(Debug)]
pub struct PreparedRequest {
    pub method: String,
    pub url: String,
    pub headers: Vec<(String, String)>,
    pub body: RequestBody,
}

#[derive(Debug)]
pub enum RequestBody {
    Json(Value),
    Bytes { content_type: String, bytes: Vec<u8> },
    Empty,
}

pub struct HttpResponse {
    pub status: u16,
    pub body: String,
}

pub trait HttpTransport {
    fn send(&self, request: &PreparedRequest) -> Result<HttpResponse, EngineError>;
}

pub struct UreqTransport;

impl HttpTransport for UreqTransport {
    fn send(&self, request: &PreparedRequest) -> Result<HttpResponse, EngineError> {
        let secrets = secrets_from_headers(&request.headers);
        let agent = ureq::AgentBuilder::new()
            .timeout(Duration::from_secs(60))
            .timeout_connect(Duration::from_secs(60))
            .https_only(false)
            .user_agent("crunchcalld/0.1.0")
            .build();
        match dispatch(&agent, request) {
            Ok(response) => Ok(HttpResponse {
                status: response.status(),
                body: read_limited(response, 8 * 1024 * 1024),
            }),
            Err(ureq::Error::Status(status, response)) => {
                let body = read_limited(response, 4096);
                Err(provider_http(status, &body, &secrets))
            }
            Err(err) => {
                let message = redact_snippet(&err.to_string(), &secrets);
                Err(EngineError::new(
                    "provider_unreachable",
                    format!("Request failed: {message}"),
                ))
            }
        }
    }
}

fn dispatch(
    agent: &ureq::Agent,
    request: &PreparedRequest,
) -> Result<ureq::Response, ureq::Error> {
    let mut call = match request.method.as_str() {
        "POST" => agent.post(&request.url),
        "GET" => agent.get(&request.url),
        "PUT" => agent.put(&request.url),
        _ => agent.request(&request.method, &request.url),
    };
    for (name, value) in &request.headers {
        call = call.set(name, value);
    }
    match &request.body {
        RequestBody::Json(value) => {
            let bytes = serde_json::to_vec(value).unwrap_or_default();
            call = call.set("Content-Type", "application/json");
            call.send_bytes(&bytes)
        }
        RequestBody::Bytes { content_type, bytes } => {
            call = call.set("Content-Type", content_type);
            call.send_bytes(bytes)
        }
        RequestBody::Empty => call.call(),
    }
}

fn read_limited(response: ureq::Response, max: u64) -> String {
    let mut reader = response.into_reader().take(max);
    let mut buf = Vec::new();
    let _ = reader.read_to_end(&mut buf);
    String::from_utf8_lossy(&buf).into_owned()
}

#[derive(Debug, Clone, Copy)]
pub struct PullProgress {
    pub bytes_done: i64,
    pub bytes_total: Option<i64>,
    pub speed_bps: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PullStop {
    Finished,
    Paused,
}

pub fn download_to(url: &str, partial: &Path, dest: &Path) -> Result<i64, EngineError> {
    let pause = AtomicBool::new(false);
    match pull_file(url, partial, dest, &pause, |_| {})? {
        PullStop::Finished => Ok(file_len(dest) as i64),
        PullStop::Paused => Err(EngineError::new("bad_request", "Download paused.")),
    }
}

/// Download `url` into `partial`, then rename it to `dest`.
///
/// A short read timeout is a retry, not a failure, so `pause` is noticed between chunks.
/// The partial file is kept on pause and on error so a later call can resume with HTTP Range.
pub fn pull_file(
    url: &str,
    partial: &Path,
    dest: &Path,
    pause: &AtomicBool,
    mut on_progress: impl FnMut(PullProgress),
) -> Result<PullStop, EngineError> {
    if url.trim().is_empty() {
        return Err(EngineError::new("bad_request", "Download URL is empty."));
    }
    if pause.load(Ordering::SeqCst) {
        return Ok(PullStop::Paused);
    }
    if dest.is_file() && !partial.exists() {
        let len = file_len(dest) as i64;
        on_progress(PullProgress {
            bytes_done: len,
            bytes_total: Some(len),
            speed_bps: 0,
        });
        return Ok(PullStop::Finished);
    }
    if let Some(parent) = partial.parent() {
        fs::create_dir_all(parent).map_err(|err| {
            EngineError::new("io", format!("Could not create the model folder: {err}"))
        })?;
    }

    let mut speed = SpeedMeter::default();
    let mut stalls = 0u32;
    let mut ignored_range = false;

    loop {
        if pause.load(Ordering::SeqCst) {
            return Ok(PullStop::Paused);
        }
        let offset = file_len(partial);
        let agent = ureq::AgentBuilder::new()
            .timeout_connect(Duration::from_secs(20))
            .timeout_read(Duration::from_secs(2))
            .redirects(8)
            .user_agent("crunchcalld/0.1.0")
            .build();
        let mut call = agent.get(url);
        if offset > 0 {
            call = call.set("Range", &format!("bytes={offset}-"));
        }
        let response = match call.call() {
            Ok(response) => response,
            Err(ureq::Error::Status(416, _)) if offset > 0 => {
                return finish_download(partial, dest, &mut on_progress);
            }
            Err(err) if transport_retryable(&err) => {
                stalls += 1;
                if stalls > 12 {
                    return Err(EngineError::new("provider_unreachable", "Download stalled."));
                }
                continue;
            }
            Err(ureq::Error::Status(status, response)) => {
                let body = read_limited(response, 512);
                return Err(provider_http(status, &body, &[]));
            }
            Err(err) => {
                return Err(EngineError::new(
                    "provider_unreachable",
                    format!("Download failed: {err}"),
                ));
            }
        };

        let status = response.status();
        let restart = status == 200 && offset > 0;
        if restart && ignored_range {
            return Err(EngineError::new(
                "provider_http",
                "The server does not support resume.",
            ));
        }
        if restart {
            ignored_range = true;
        }
        if status != 200 && status != 206 {
            return Err(EngineError::new("provider_http", format!("HTTP {status}.")));
        }
        let total = header_total(&response, status, if restart { 0 } else { offset });
        let mut file = if restart || offset == 0 {
            File::create(partial)
        } else {
            OpenOptions::new().create(true).append(true).write(true).open(partial)
        }
        .map_err(|err| EngineError::new("io", format!("Could not write the model file: {err}")))?;

        let mut reader = response.into_reader();
        let mut buf = [0u8; 64 * 1024];
        let mut done = if restart { 0 } else { offset };
        loop {
            if pause.load(Ordering::SeqCst) {
                file.flush().ok();
                file.sync_all().ok();
                emit(&mut on_progress, done, total, 0);
                return Ok(PullStop::Paused);
            }
            match reader.read(&mut buf) {
                Ok(0) => {
                    file.flush().ok();
                    file.sync_all().ok();
                    drop(file);
                    let size = file_len(partial);
                    if let Some(total) = total {
                        if size < total {
                            stalls += 1;
                            if stalls > 12 {
                                return Err(EngineError::new("provider_unreachable", "Download stalled."));
                            }
                            break;
                        }
                    }
                    return finish_download(partial, dest, &mut on_progress);
                }
                Ok(n) => {
                    file.write_all(&buf[..n]).map_err(|err| {
                        EngineError::new("io", format!("Download failed: {err}"))
                    })?;
                    done += n as u64;
                    stalls = 0;
                    let bps = speed.observe(done);
                    emit(&mut on_progress, done, total, bps);
                }
                Err(err) if io_retryable(&err) => {
                    file.flush().ok();
                    if pause.load(Ordering::SeqCst) {
                        file.sync_all().ok();
                        emit(&mut on_progress, done, total, 0);
                        return Ok(PullStop::Paused);
                    }
                    stalls += 1;
                    if stalls > 12 {
                        return Err(EngineError::new("provider_unreachable", "Download stalled."));
                    }
                    break;
                }
                Err(err) => {
                    file.flush().ok();
                    return Err(EngineError::new("io", format!("Download failed: {err}")));
                }
            }
        }
    }
}

fn emit(on_progress: &mut impl FnMut(PullProgress), done: u64, total: Option<u64>, speed_bps: i64) {
    on_progress(PullProgress {
        bytes_done: done as i64,
        bytes_total: total.map(|value| value as i64),
        speed_bps,
    });
}

fn finish_download(
    partial: &Path,
    dest: &Path,
    on_progress: &mut impl FnMut(PullProgress),
) -> Result<PullStop, EngineError> {
    let bytes = file_len(partial) as i64;
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|err| {
            EngineError::new("io", format!("Could not create the model folder: {err}"))
        })?;
    }
    if dest.exists() {
        fs::remove_file(dest).map_err(|err| {
            EngineError::new("io", format!("Could not replace the model file: {err}"))
        })?;
    }
    fs::rename(partial, dest).map_err(|err| {
        EngineError::new("io", format!("Could not save the model file: {err}"))
    })?;
    emit(on_progress, bytes as u64, Some(bytes as u64), 0);
    Ok(PullStop::Finished)
}

fn file_len(path: &Path) -> u64 {
    fs::metadata(path).map(|meta| meta.len()).unwrap_or(0)
}

fn header_total(response: &ureq::Response, status: u16, offset: u64) -> Option<u64> {
    if let Some(total) = response
        .header("Content-Range")
        .and_then(total_from_content_range)
    {
        return Some(total);
    }
    let length = response
        .header("Content-Length")
        .and_then(|value| value.trim().parse::<u64>().ok());
    match (status, length) {
        (206, Some(length)) => Some(offset.saturating_add(length)),
        (200, Some(length)) => Some(length),
        _ => None,
    }
}

fn total_from_content_range(value: &str) -> Option<u64> {
    let total = value.rsplit('/').next()?.trim();
    if total == "*" {
        return None;
    }
    total.parse::<u64>().ok()
}

fn transport_retryable(err: &ureq::Error) -> bool {
    if text_retryable(&err.to_string()) {
        return true;
    }
    let mut source = std::error::Error::source(err);
    while let Some(inner) = source {
        if let Some(io_err) = inner.downcast_ref::<std::io::Error>() {
            return io_retryable(io_err);
        }
        if text_retryable(&inner.to_string()) {
            return true;
        }
        source = std::error::Error::source(inner);
    }
    false
}

fn text_retryable(message: &str) -> bool {
    let message = message.to_ascii_lowercase();
    message.contains("timed out")
        || message.contains("timeout")
        || message.contains("connection reset")
        || message.contains("connection abort")
        || message.contains("broken pipe")
}

fn io_retryable(err: &std::io::Error) -> bool {
    matches!(
        err.kind(),
        std::io::ErrorKind::TimedOut
            | std::io::ErrorKind::WouldBlock
            | std::io::ErrorKind::Interrupted
            | std::io::ErrorKind::ConnectionReset
            | std::io::ErrorKind::ConnectionAborted
            | std::io::ErrorKind::BrokenPipe
            | std::io::ErrorKind::UnexpectedEof
    ) || err.to_string().to_ascii_lowercase().contains("timed out")
}

#[derive(Default)]
struct SpeedMeter {
    last_at: Option<Instant>,
    last_bytes: u64,
    smoothed: f64,
}

impl SpeedMeter {
    fn observe(&mut self, bytes: u64) -> i64 {
        let now = Instant::now();
        let Some(last_at) = self.last_at else {
            self.last_at = Some(now);
            self.last_bytes = bytes;
            return 0;
        };
        let dt = now.duration_since(last_at).as_secs_f64();
        if dt < 0.1 {
            return self.smoothed.round() as i64;
        }
        let instant = bytes.saturating_sub(self.last_bytes) as f64 / dt;
        self.smoothed = if self.smoothed == 0.0 {
            instant
        } else {
            self.smoothed * 0.65 + instant * 0.35
        };
        self.last_at = Some(now);
        self.last_bytes = bytes;
        self.smoothed.round() as i64
    }
}

#[derive(Debug)]
pub enum SpeechOutcome {
    Text(String),
    Pending { id: String },
}

pub fn transcribe_with(
    transport: &dyn HttpTransport,
    runtime: &str,
    base_url: &str,
    model: &str,
    key: &str,
    wav: &[u8],
) -> Result<SpeechOutcome, EngineError> {
    if is_unlinked_runtime(runtime) {
        return Err(EngineError::new(
            "engine_not_linked",
            format!("{runtime} is not linked in this build yet."),
        ));
    }
    match runtime {
        "openai-audio" => {
            let request = build_openai_audio(base_url, model, key, wav)?;
            let response = transport.send(&request)?;
            let value = parse_json(&response, &secrets_from_headers(&request.headers))?;
            Ok(SpeechOutcome::Text(required_text(&value, "text", &response)?))
        }
        "deepgram" => {
            let request = build_deepgram(base_url, model, key, wav)?;
            let response = transport.send(&request)?;
            let value = parse_json(&response, &secrets_from_headers(&request.headers))?;
            let text = value
                .pointer("/results/channels/0/alternatives/0/transcript")
                .and_then(|v| v.as_str())
                .ok_or_else(|| missing_text(&response))?;
            Ok(SpeechOutcome::Text(text.to_string()))
        }
        "elevenlabs" => {
            let request = build_elevenlabs(base_url, model, key, wav)?;
            let response = transport.send(&request)?;
            let value = parse_json(&response, &secrets_from_headers(&request.headers))?;
            Ok(SpeechOutcome::Text(required_text(&value, "text", &response)?))
        }
        "google" => {
            let request = build_google_speech(base_url, model, key, wav)?;
            let response = transport.send(&request)?;
            let value = parse_json(&response, &secrets_from_headers(&request.headers))?;
            Ok(SpeechOutcome::Text(google_text(&value).ok_or_else(|| missing_text(&response))?))
        }
        "assemblyai" => transcribe_assembly(transport, base_url, model, key, wav),
        other => Err(EngineError::new(
            "not_ready",
            format!("{other} is not ready in this build yet."),
        )),
    }
}

pub fn complete_with(
    transport: &dyn HttpTransport,
    runtime: &str,
    base_url: &str,
    model: &str,
    key: &str,
    system: &str,
    prompt: &str,
) -> Result<String, EngineError> {
    if is_unlinked_runtime(runtime) {
        return Err(EngineError::new(
            "engine_not_linked",
            format!("{runtime} is not linked in this build yet."),
        ));
    }
    let request = match runtime {
        "openai-chat" => build_openai_chat(base_url, model, key, system, prompt)?,
        "anthropic" => build_anthropic(base_url, model, key, system, prompt)?,
        "google" => build_google_writer(base_url, model, key, system, prompt)?,
        "cohere" => build_cohere(base_url, model, key, system, prompt)?,
        other => {
            return Err(EngineError::new(
                "not_ready",
                format!("{other} is not ready in this build yet."),
            ));
        }
    };
    let secrets = secrets_from_headers(&request.headers);
    let response = transport.send(&request)?;
    let value = parse_json(&response, &secrets)?;
    match runtime {
        "openai-chat" => openai_chat_text(&value).ok_or_else(|| missing_text(&response)),
        "anthropic" => anthropic_text(&value).ok_or_else(|| missing_text(&response)),
        "google" => google_text(&value).ok_or_else(|| missing_text(&response)),
        "cohere" => cohere_text(&value).ok_or_else(|| missing_text(&response)),
        _ => Err(missing_text(&response)),
    }
}

fn transcribe_assembly(
    transport: &dyn HttpTransport,
    base_url: &str,
    model: &str,
    key: &str,
    wav: &[u8],
) -> Result<SpeechOutcome, EngineError> {
    let upload = build_assembly_upload(base_url, key, wav)?;
    let upload_response = transport.send(&upload)?;
    let upload_json = parse_json(&upload_response, &secrets_from_headers(&upload.headers))?;
    let audio_url = upload_json
        .get("upload_url")
        .and_then(|value| value.as_str())
        .ok_or_else(|| {
            EngineError::new(
                "provider_http",
                "AssemblyAI upload did not return an upload URL.",
            )
        })?;
    let submit = build_assembly_transcript(base_url, key, model, audio_url)?;
    let submit_response = transport.send(&submit)?;
    let submit_json = parse_json(&submit_response, &secrets_from_headers(&submit.headers))?;
    assembly_outcome(&submit_json)
}

fn assembly_outcome(value: &Value) -> Result<SpeechOutcome, EngineError> {
    let id = value
        .get("id")
        .and_then(|item| item.as_str())
        .unwrap_or("")
        .to_string();
    let status = value
        .get("status")
        .and_then(|item| item.as_str())
        .unwrap_or("");
    if let Some(text) = value.get("text").and_then(|item| item.as_str()) {
        if status == "completed" || status == "success" || !text.is_empty() {
            return Ok(SpeechOutcome::Text(text.to_string()));
        }
    }
    if status == "completed" {
        return Ok(SpeechOutcome::Text(String::new()));
    }
    if id.is_empty() {
        return Err(EngineError::new(
            "provider_http",
            "AssemblyAI did not return a transcript id.",
        ));
    }
    Ok(SpeechOutcome::Pending { id })
}

pub fn build_openai_chat(
    base_url: &str,
    model: &str,
    key: &str,
    system: &str,
    prompt: &str,
) -> Result<PreparedRequest, EngineError> {
    // Refuse before any socket. ureq is not used in this function.
    let key = require_key(key)?;
    let mut messages = Vec::new();
    if !system.is_empty() {
        messages.push(json!({ "role": "system", "content": system }));
    }
    messages.push(json!({ "role": "user", "content": prompt }));
    let mut headers = vec![("Authorization".to_string(), format!("Bearer {key}"))];
    if base_url.to_ascii_lowercase().contains("openrouter.ai") {
        headers.push((
            "HTTP-Referer".to_string(),
            "https://crunchcall.local".to_string(),
        ));
    }
    Ok(PreparedRequest {
        method: "POST".into(),
        url: join_url(base_url, "chat/completions"),
        headers,
        body: RequestBody::Json(json!({
            "model": model,
            "messages": messages,
        })),
    })
}

pub fn build_openai_audio(
    base_url: &str,
    model: &str,
    key: &str,
    wav: &[u8],
) -> Result<PreparedRequest, EngineError> {
    let key = require_key(key)?;
    let (content_type, bytes) = multipart(
        &[("model", model)],
        "file",
        "audio.wav",
        "audio/wav",
        wav,
    );
    Ok(PreparedRequest {
        method: "POST".into(),
        url: join_url(base_url, "audio/transcriptions"),
        headers: vec![("Authorization".to_string(), format!("Bearer {key}"))],
        body: RequestBody::Bytes { content_type, bytes },
    })
}

pub fn build_anthropic(
    base_url: &str,
    model: &str,
    key: &str,
    system: &str,
    prompt: &str,
) -> Result<PreparedRequest, EngineError> {
    let key = require_key(key)?;
    let mut body = json!({
        "model": model,
        "max_tokens": 1024,
        "messages": [{ "role": "user", "content": prompt }],
    });
    if !system.is_empty() {
        body["system"] = json!(system);
    }
    Ok(PreparedRequest {
        method: "POST".into(),
        url: endpoint_url(base_url, "/messages", "https://api.anthropic.com/v1/messages"),
        headers: vec![
            ("x-api-key".to_string(), key.to_string()),
            ("anthropic-version".to_string(), "2023-06-01".to_string()),
        ],
        body: RequestBody::Json(body),
    })
}

pub fn build_google_writer(
    base_url: &str,
    model: &str,
    key: &str,
    system: &str,
    prompt: &str,
) -> Result<PreparedRequest, EngineError> {
    let key = require_key(key)?;
    let mut body = json!({
        "contents": [{
            "role": "user",
            "parts": [{ "text": prompt }],
        }],
    });
    if !system.is_empty() {
        body["systemInstruction"] = json!({ "parts": [{ "text": system }] });
    }
    Ok(PreparedRequest {
        method: "POST".into(),
        url: google_url(base_url, model),
        headers: vec![("x-goog-api-key".to_string(), key.to_string())],
        body: RequestBody::Json(body),
    })
}

pub fn build_google_speech(
    base_url: &str,
    model: &str,
    key: &str,
    wav: &[u8],
) -> Result<PreparedRequest, EngineError> {
    let key = require_key(key)?;
    let body = json!({
        "contents": [{
            "role": "user",
            "parts": [
                { "text": "Transcribe this audio verbatim." },
                {
                    "inlineData": {
                        "mimeType": "audio/wav",
                        "data": encode_base64(wav),
                    }
                }
            ],
        }],
    });
    Ok(PreparedRequest {
        method: "POST".into(),
        url: google_url(base_url, model),
        headers: vec![("x-goog-api-key".to_string(), key.to_string())],
        body: RequestBody::Json(body),
    })
}

pub fn build_cohere(
    base_url: &str,
    model: &str,
    key: &str,
    system: &str,
    prompt: &str,
) -> Result<PreparedRequest, EngineError> {
    let key = require_key(key)?;
    let mut messages = Vec::new();
    if !system.is_empty() {
        messages.push(json!({ "role": "system", "content": system }));
    }
    messages.push(json!({ "role": "user", "content": prompt }));
    Ok(PreparedRequest {
        method: "POST".into(),
        url: endpoint_url(base_url, "/chat", "https://api.cohere.com/v2/chat"),
        headers: vec![("Authorization".to_string(), format!("Bearer {key}"))],
        body: RequestBody::Json(json!({
            "model": model,
            "messages": messages,
        })),
    })
}

pub fn build_deepgram(
    base_url: &str,
    model: &str,
    key: &str,
    wav: &[u8],
) -> Result<PreparedRequest, EngineError> {
    let key = require_key(key)?;
    let base = if base_url.trim().is_empty() {
        "https://api.deepgram.com/v1/listen"
    } else {
        base_url.trim().trim_end_matches('/')
    };
    let url = if model.is_empty() {
        base.to_string()
    } else {
        let sep = if base.contains('?') { '&' } else { '?' };
        format!("{base}{sep}model={}", query_encode(model))
    };
    Ok(PreparedRequest {
        method: "POST".into(),
        url,
        headers: vec![("Authorization".to_string(), format!("Token {key}"))],
        body: RequestBody::Bytes {
            content_type: "audio/wav".into(),
            bytes: wav.to_vec(),
        },
    })
}

pub fn build_assembly_upload(
    base_url: &str,
    key: &str,
    wav: &[u8],
) -> Result<PreparedRequest, EngineError> {
    let key = require_key(key)?;
    Ok(PreparedRequest {
        method: "POST".into(),
        url: join_url(assembly_base(base_url), "upload"),
        headers: vec![("Authorization".to_string(), key.to_string())],
        body: RequestBody::Bytes {
            content_type: "application/octet-stream".into(),
            bytes: wav.to_vec(),
        },
    })
}

pub fn build_assembly_transcript(
    base_url: &str,
    key: &str,
    model: &str,
    audio_url: &str,
) -> Result<PreparedRequest, EngineError> {
    let key = require_key(key)?;
    let speech_model = if model.is_empty() { "universal" } else { model };
    Ok(PreparedRequest {
        method: "POST".into(),
        url: join_url(assembly_base(base_url), "transcript"),
        headers: vec![("Authorization".to_string(), key.to_string())],
        body: RequestBody::Json(json!({
            "audio_url": audio_url,
            "speech_models": [speech_model],
        })),
    })
}

pub fn build_elevenlabs(
    base_url: &str,
    model: &str,
    key: &str,
    wav: &[u8],
) -> Result<PreparedRequest, EngineError> {
    let key = require_key(key)?;
    let url = if base_url.trim().is_empty() {
        "https://api.elevenlabs.io/v1/speech-to-text".to_string()
    } else {
        base_url.trim().trim_end_matches('/').to_string()
    };
    let (content_type, bytes) = multipart(
        &[("model_id", model)],
        "file",
        "audio.wav",
        "audio/wav",
        wav,
    );
    Ok(PreparedRequest {
        method: "POST".into(),
        url,
        headers: vec![("xi-api-key".to_string(), key.to_string())],
        body: RequestBody::Bytes { content_type, bytes },
    })
}

fn require_key(key: &str) -> Result<&str, EngineError> {
    let key = key.trim();
    if key.is_empty() {
        Err(EngineError::new(
            "missing_key",
            "No API key is saved for this module.",
        ))
    } else {
        Ok(key)
    }
}

fn join_url(base: &str, path: &str) -> String {
    format!(
        "{}/{}",
        base.trim().trim_end_matches('/'),
        path.trim_start_matches('/')
    )
}

fn endpoint_url(base: &str, suffix: &str, fallback: &str) -> String {
    let base = base.trim().trim_end_matches('/');
    if base.is_empty() {
        return fallback.to_string();
    }
    if base.ends_with(suffix) {
        base.to_string()
    } else {
        format!("{base}{suffix}")
    }
}

fn google_url(base: &str, model: &str) -> String {
    let base = if base.trim().is_empty() {
        "https://generativelanguage.googleapis.com/v1beta"
    } else {
        base.trim().trim_end_matches('/')
    };
    format!("{base}/models/{}:generateContent", query_encode(model))
}

fn assembly_base(base: &str) -> &str {
    if base.trim().is_empty() {
        "https://api.assemblyai.com/v2"
    } else {
        base.trim().trim_end_matches('/')
    }
}

fn query_encode(value: &str) -> String {
    let mut out = String::new();
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char);
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

fn multipart(
    fields: &[(&str, &str)],
    file_field: &str,
    filename: &str,
    mime: &str,
    file_bytes: &[u8],
) -> (String, Vec<u8>) {
    let boundary = format!("crunchcall{}{}", now_ms(), new_id("b"));
    let mut body = Vec::new();
    for (name, value) in fields {
        body.extend(
            format!("--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n")
                .into_bytes(),
        );
    }
    body.extend(
        format!(
            "--{boundary}\r\nContent-Disposition: form-data; name=\"{file_field}\"; filename=\"{filename}\"\r\nContent-Type: {mime}\r\n\r\n"
        )
        .into_bytes(),
    );
    body.extend_from_slice(file_bytes);
    body.extend(format!("\r\n--{boundary}--\r\n").into_bytes());
    (format!("multipart/form-data; boundary={boundary}"), body)
}

fn secrets_from_headers(headers: &[(String, String)]) -> Vec<String> {
    let mut secrets = Vec::new();
    for (name, value) in headers {
        let lower = name.to_ascii_lowercase();
        if matches!(
            lower.as_str(),
            "authorization" | "x-api-key" | "xi-api-key" | "x-goog-api-key"
        ) {
            let trimmed = value.trim();
            if let Some(rest) = trimmed
                .strip_prefix("Bearer ")
                .or_else(|| trimmed.strip_prefix("Token "))
            {
                push_secret(&mut secrets, rest.trim());
            }
            push_secret(&mut secrets, trimmed);
        }
    }
    secrets
}

fn push_secret(secrets: &mut Vec<String>, value: &str) {
    if value.len() >= 4 && !secrets.iter().any(|existing| existing == value) {
        secrets.push(value.to_string());
    }
}

fn parse_json(response: &HttpResponse, secrets: &[String]) -> Result<Value, EngineError> {
    if !(200..300).contains(&response.status) {
        return Err(provider_http(response.status, &response.body, secrets));
    }
    serde_json::from_str(&response.body).map_err(|err| {
        let snippet = redact_snippet(&response.body, secrets);
        EngineError::new(
            "provider_http",
            format!(
                "HTTP {}: response was not JSON ({err}) {snippet}",
                response.status
            ),
        )
    })
}

fn missing_text(response: &HttpResponse) -> EngineError {
    let snippet = redact_snippet(&response.body, &[]);
    EngineError::new(
        "provider_http",
        format!("HTTP {}: response did not include text {snippet}", response.status),
    )
}

fn required_text(value: &Value, field: &str, response: &HttpResponse) -> Result<String, EngineError> {
    value
        .get(field)
        .and_then(|item| item.as_str())
        .map(|text| text.to_string())
        .ok_or_else(|| missing_text(response))
}

fn openai_chat_text(value: &Value) -> Option<String> {
    let content = value.pointer("/choices/0/message/content")?;
    if let Some(text) = content.as_str() {
        return Some(text.to_string());
    }
    content.as_array().map(|parts| {
        parts
            .iter()
            .filter_map(|part| part.get("text").and_then(|text| text.as_str()))
            .collect::<String>()
    })
}

fn anthropic_text(value: &Value) -> Option<String> {
    let parts = value.get("content")?.as_array()?;
    let text: String = parts
        .iter()
        .filter_map(|part| part.get("text").and_then(|text| text.as_str()))
        .collect();
    if text.is_empty() {
        None
    } else {
        Some(text)
    }
}

fn google_text(value: &Value) -> Option<String> {
    let parts = value.pointer("/candidates/0/content/parts")?.as_array()?;
    let text: String = parts
        .iter()
        .filter_map(|part| part.get("text").and_then(|text| text.as_str()))
        .collect();
    if text.is_empty() {
        None
    } else {
        Some(text)
    }
}

fn cohere_text(value: &Value) -> Option<String> {
    let content = value.pointer("/message/content")?;
    if let Some(text) = content.as_str() {
        return Some(text.to_string());
    }
    if let Some(parts) = content.as_array() {
        let text: String = parts
            .iter()
            .filter_map(|part| part.get("text").and_then(|text| text.as_str()))
            .collect();
        if !text.is_empty() {
            return Some(text);
        }
    }
    value
        .get("text")
        .and_then(|text| text.as_str())
        .map(|text| text.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    struct PanicTransport;

    impl HttpTransport for PanicTransport {
        fn send(&self, _request: &PreparedRequest) -> Result<HttpResponse, EngineError> {
            panic!("ureq would have been called");
        }
    }

    #[test]
    fn openai_chat_empty_key_does_not_open_a_socket() {
        let err = build_openai_chat(
            "https://api.openai.com/v1",
            "gpt-4o-mini",
            "   ",
            "system",
            "hello",
        )
        .expect_err("empty key");
        assert_eq!(err.code, "missing_key");

        let err = complete_with(
            &PanicTransport,
            "openai-chat",
            "https://api.openai.com/v1",
            "gpt-4o-mini",
            "",
            "system",
            "hello",
        )
        .expect_err("empty key before transport");
        assert_eq!(err.code, "missing_key");
    }

    #[test]
    fn openai_chat_request_keeps_the_key_out_of_the_url() {
        let key = "sk-test-not-sent";
        let request = build_openai_chat(
            "https://api.openai.com/v1/",
            "gpt-4o-mini",
            key,
            "Be brief",
            "Summarize",
        )
        .unwrap();
        assert_eq!(request.method, "POST");
        assert_eq!(request.url, "https://api.openai.com/v1/chat/completions");
        assert!(!request.url.contains(key));
        assert!(request
            .headers
            .iter()
            .any(|(name, value)| name == "Authorization" && value == &format!("Bearer {key}")));
        match &request.body {
            RequestBody::Json(body) => {
                assert_eq!(body["model"], "gpt-4o-mini");
                assert_eq!(body["messages"][0]["role"], "system");
                assert_eq!(body["messages"][1]["content"], "Summarize");
            }
            other => panic!("expected json, got {other:?}"),
        }
    }

    #[test]
    fn openrouter_sends_referer() {
        let request = build_openai_chat(
            "https://openrouter.ai/api/v1",
            "openrouter/auto",
            "sk-or-test",
            "",
            "hi",
        )
        .unwrap();
        assert!(request.headers.iter().any(|(name, value)| {
            name == "HTTP-Referer" && value == "https://crunchcall.local"
        }));
    }

    #[test]
    fn redact_removes_the_key_then_truncates() {
        let key = "sk-secret-value";
        let body = format!("error near {key} and more");
        let snippet = redact_snippet(&body, &[key.to_string()]);
        assert!(!snippet.contains(key));
        assert!(snippet.contains("***"));
    }

    #[test]
    fn pull_file_pauses_and_resumes_with_range() {
        use std::io::{Read, Write};
        use std::net::TcpListener;
        use std::sync::atomic::{AtomicBool, Ordering};
        use std::sync::{Arc, Mutex};
        use std::thread;
        use std::time::Duration;

        let body = vec![9u8; 160 * 1024];
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let ranges = Arc::new(Mutex::new(Vec::<u64>::new()));
        let recorded = ranges.clone();
        let payload = body.clone();
        thread::spawn(move || {
            for _ in 0..6 {
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
                    thread::sleep(Duration::from_millis(20));
                }
            }
        });

        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("crunchcall-pull-{}-{nonce}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let partial = root.join("model.bin.partial");
        let dest = root.join("model.bin");
        let pause = AtomicBool::new(false);
        let url = format!("http://127.0.0.1:{port}/model.bin");
        let mut saw_bytes = 0i64;
        let first = pull_file(&url, &partial, &dest, &pause, |progress| {
            if progress.bytes_done > 24 * 1024 {
                pause.store(true, Ordering::SeqCst);
            }
            saw_bytes = saw_bytes.max(progress.bytes_done);
        })
        .unwrap();
        assert_eq!(first, PullStop::Paused);
        assert!(partial.is_file(), "pause deleted the partial");
        assert!(!dest.exists());
        let kept = std::fs::metadata(&partial).unwrap().len();
        assert!(kept > 0);
        assert!(kept < body.len() as u64);

        pause.store(false, Ordering::SeqCst);
        let second = pull_file(&url, &partial, &dest, &pause, |_| {}).unwrap();
        assert_eq!(second, PullStop::Finished);
        assert_eq!(std::fs::read(&dest).unwrap(), body);
        assert!(!partial.exists());
        let seen = ranges.lock().unwrap().clone();
        assert!(seen.iter().any(|start| *start > 0), "resume did not send Range, saw {seen:?}, first bytes {saw_bytes}");
        let _ = std::fs::remove_dir_all(&root);
    }
}
