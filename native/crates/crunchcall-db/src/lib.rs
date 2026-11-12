use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

use crunchcall_core::ids::{new_id, now_ms};
use crunchcall_core::Settings;
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use thiserror::Error;

const SCHEMA_V1: &str = r#"
CREATE TABLE meetings (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    started_at INTEGER,
    ended_at INTEGER,
    status TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE utterances (
    id TEXT PRIMARY KEY,
    meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    speaker TEXT,
    text TEXT NOT NULL,
    started_at INTEGER,
    ended_at INTEGER,
    seq INTEGER NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE INDEX idx_utterances_meeting ON utterances(meeting_id, seq);

CREATE VIRTUAL TABLE utterance_fts USING fts5(
    utterance_id UNINDEXED,
    meeting_id UNINDEXED,
    speaker,
    body
);

CREATE TABLE notes (
    meeting_id TEXT PRIMARY KEY REFERENCES meetings(id) ON DELETE CASCADE,
    summary TEXT NOT NULL DEFAULT '',
    takeaways_json TEXT NOT NULL DEFAULT '[]',
    markdown TEXT NOT NULL DEFAULT '',
    updated_at INTEGER NOT NULL
);

CREATE TABLE action_items (
    id TEXT PRIMARY KEY,
    meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    owner TEXT,
    due TEXT,
    position INTEGER NOT NULL
);

CREATE INDEX idx_actions_meeting ON action_items(meeting_id, position);

CREATE TABLE coaching_cues (
    id TEXT PRIMARY KEY,
    meeting_id TEXT REFERENCES meetings(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    message TEXT NOT NULL,
    at_line INTEGER,
    created_at INTEGER NOT NULL
);

CREATE TABLE dictations (
    id TEXT PRIMARY KEY,
    meeting_id TEXT REFERENCES meetings(id) ON DELETE SET NULL,
    module_id TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE INDEX idx_dictations_created ON dictations(created_at);

CREATE TABLE app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE installed_modules (
    module_id TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    path TEXT,
    bytes_done INTEGER NOT NULL DEFAULT 0,
    bytes_total INTEGER,
    message TEXT,
    updated_at INTEGER NOT NULL
);

CREATE TABLE secret_refs (
    module_id TEXT PRIMARY KEY,
    credential_target TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);
"#;

#[derive(Debug, Error)]
pub enum DbError {
    #[error("{0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("{0}")]
    Io(#[from] std::io::Error),
    #[error("{0}")]
    Json(#[from] serde_json::Error),
    #[error("{message}")]
    App { code: &'static str, message: String },
}

impl DbError {
    pub fn msg(code: &'static str, message: impl Into<String>) -> Self {
        Self::App {
            code,
            message: message.into(),
        }
    }

    pub fn code(&self) -> &'static str {
        match self {
            DbError::App { code, .. } => code,
            DbError::Io(_) => "io",
            _ => "internal",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Meeting {
    pub id: String,
    pub title: String,
    pub started_at: Option<i64>,
    pub ended_at: Option<i64>,
    pub status: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Utterance {
    pub id: String,
    pub meeting_id: String,
    pub speaker: Option<String>,
    pub text: String,
    pub started_at: Option<i64>,
    pub ended_at: Option<i64>,
    pub seq: i64,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Notes {
    pub meeting_id: String,
    pub summary: String,
    pub takeaways: Vec<String>,
    pub markdown: String,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ActionItem {
    pub id: String,
    pub meeting_id: String,
    pub text: String,
    pub owner: Option<String>,
    pub due: Option<String>,
    pub position: i64,
}

#[derive(Debug, Clone)]
pub struct ActionDraft {
    pub text: String,
    pub owner: Option<String>,
    pub due: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Dictation {
    pub id: String,
    pub meeting_id: Option<String>,
    pub module_id: String,
    pub text: String,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InstallRow {
    pub module_id: String,
    pub status: String,
    pub path: Option<String>,
    pub bytes_done: i64,
    pub bytes_total: Option<i64>,
    pub speed_bps: i64,
    pub message: Option<String>,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub utterance_id: String,
    pub meeting_id: String,
    pub speaker: Option<String>,
    pub text: String,
}

pub struct Db {
    conn: Connection,
    path: PathBuf,
    data_dir: PathBuf,
}

impl Db {
    pub fn open(data_dir: &Path) -> Result<Self, DbError> {
        fs::create_dir_all(data_dir)?;
        let path = data_dir.join("crunchcall.db");
        let conn = Connection::open(&path)?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        conn.busy_timeout(Duration::from_secs(5))?;
        migrate(&conn)?;
        Ok(Self {
            conn,
            path,
            data_dir: data_dir.to_path_buf(),
        })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn data_dir(&self) -> &Path {
        &self.data_dir
    }

    pub fn checkpoint(&self) -> Result<(), DbError> {
        self.conn
            .query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |_| Ok(()))?;
        Ok(())
    }

    pub fn mark_interrupted_downloads(&self) -> Result<(), DbError> {
        self.conn.execute(
            "UPDATE installed_modules
             SET status = 'paused',
                 speed_bps = 0,
                 message = 'Paused when the app closed.',
                 updated_at = ?1
             WHERE status = 'downloading'",
            [now_ms()],
        )?;
        Ok(())
    }

    pub fn create_meeting(
        &self,
        title: &str,
        status: &str,
        started_at: Option<i64>,
    ) -> Result<Meeting, DbError> {
        let now = now_ms();
        let meeting = Meeting {
            id: new_id("m"),
            title: if title.trim().is_empty() {
                "Untitled meeting".to_string()
            } else {
                title.to_string()
            },
            started_at,
            ended_at: None,
            status: if status.trim().is_empty() {
                "draft".to_string()
            } else {
                status.to_string()
            },
            created_at: now,
            updated_at: now,
        };
        self.conn.execute(
            "INSERT INTO meetings (id, title, started_at, ended_at, status, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                meeting.id,
                meeting.title,
                meeting.started_at,
                meeting.ended_at,
                meeting.status,
                meeting.created_at,
                meeting.updated_at
            ],
        )?;
        Ok(meeting)
    }

    pub fn list_meetings(&self) -> Result<Vec<Meeting>, DbError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, title, started_at, ended_at, status, created_at, updated_at
             FROM meetings
             ORDER BY updated_at DESC, created_at DESC",
        )?;
        let rows = stmt.query_map([], map_meeting)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(DbError::from)
    }

    pub fn get_meeting(&self, id: &str) -> Result<Meeting, DbError> {
        self.conn
            .query_row(
                "SELECT id, title, started_at, ended_at, status, created_at, updated_at
                 FROM meetings WHERE id = ?1",
                [id],
                map_meeting,
            )
            .map_err(|err| match err {
                rusqlite::Error::QueryReturnedNoRows => {
                    DbError::msg("not_found", format!("No meeting {id}."))
                }
                other => other.into(),
            })
    }

    pub fn update_meeting(&self, id: &str, patch: &Map<String, Value>) -> Result<Meeting, DbError> {
        let mut meeting = self.get_meeting(id)?;
        if let Some(title) = patch.get("title").and_then(|value| value.as_str()) {
            meeting.title = title.to_string();
        }
        if patch.contains_key("startedAt") {
            meeting.started_at = patch.get("startedAt").and_then(|value| value.as_i64());
        }
        if patch.contains_key("endedAt") {
            meeting.ended_at = patch.get("endedAt").and_then(|value| value.as_i64());
        }
        if let Some(status) = patch.get("status").and_then(|value| value.as_str()) {
            meeting.status = status.to_string();
        }
        meeting.updated_at = now_ms();
        self.conn.execute(
            "UPDATE meetings
             SET title = ?1, started_at = ?2, ended_at = ?3, status = ?4, updated_at = ?5
             WHERE id = ?6",
            params![
                meeting.title,
                meeting.started_at,
                meeting.ended_at,
                meeting.status,
                meeting.updated_at,
                meeting.id
            ],
        )?;
        Ok(meeting)
    }

    pub fn delete_meeting(&self, id: &str) -> Result<(), DbError> {
        self.require_meeting(id)?;
        self.conn
            .execute("DELETE FROM utterance_fts WHERE meeting_id = ?1", [id])?;
        self.conn.execute("DELETE FROM meetings WHERE id = ?1", [id])?;
        Ok(())
    }

    pub fn append_utterance(
        &self,
        meeting_id: &str,
        speaker: Option<&str>,
        text: &str,
        started_at: Option<i64>,
        ended_at: Option<i64>,
    ) -> Result<Utterance, DbError> {
        self.require_meeting(meeting_id)?;
        let tx = self.conn.unchecked_transaction()?;
        let seq: i64 = tx.query_row(
            "SELECT COALESCE(MAX(seq), 0) + 1 FROM utterances WHERE meeting_id = ?1",
            [meeting_id],
            |row| row.get(0),
        )?;
        let speaker = speaker
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(|value| value.to_string());
        let utterance = Utterance {
            id: new_id("u"),
            meeting_id: meeting_id.to_string(),
            speaker,
            text: text.to_string(),
            started_at,
            ended_at,
            seq,
            created_at: now_ms(),
        };
        tx.execute(
            "INSERT INTO utterances
             (id, meeting_id, speaker, text, started_at, ended_at, seq, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                utterance.id,
                utterance.meeting_id,
                utterance.speaker,
                utterance.text,
                utterance.started_at,
                utterance.ended_at,
                utterance.seq,
                utterance.created_at
            ],
        )?;
        tx.execute(
            "INSERT INTO utterance_fts (utterance_id, meeting_id, speaker, body)
             VALUES (?1, ?2, ?3, ?4)",
            params![
                utterance.id,
                utterance.meeting_id,
                utterance.speaker.clone().unwrap_or_default(),
                utterance.text
            ],
        )?;
        tx.commit()?;
        Ok(utterance)
    }

    pub fn list_utterances(&self, meeting_id: &str) -> Result<Vec<Utterance>, DbError> {
        self.require_meeting(meeting_id)?;
        let mut stmt = self.conn.prepare(
            "SELECT id, meeting_id, speaker, text, started_at, ended_at, seq, created_at
             FROM utterances
             WHERE meeting_id = ?1
             ORDER BY seq ASC",
        )?;
        let rows = stmt.query_map([meeting_id], map_utterance)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(DbError::from)
    }

    pub fn search(&self, query: &str) -> Result<Vec<SearchHit>, DbError> {
        let query = query.trim();
        if query.is_empty() {
            return Ok(Vec::new());
        }
        let phrase = fts_phrase(query);
        let mut stmt = self.conn.prepare(
            "SELECT utterance_id, meeting_id, speaker, body
             FROM utterance_fts
             WHERE utterance_fts MATCH ?1
             LIMIT 50",
        )?;
        let rows = stmt.query_map([phrase], |row| {
            let speaker: String = row.get(2)?;
            Ok(SearchHit {
                utterance_id: row.get(0)?,
                meeting_id: row.get(1)?,
                speaker: if speaker.is_empty() {
                    None
                } else {
                    Some(speaker)
                },
                text: row.get(3)?,
            })
        })?;
        let mut hits = Vec::new();
        for row in rows {
            match row {
                Ok(hit) => hits.push(hit),
                Err(err) if fts_error(&err) => {
                    return Err(DbError::msg("bad_request", "Could not search for that text."));
                }
                Err(err) => return Err(err.into()),
            }
        }
        Ok(hits)
    }

    pub fn get_notes(&self, meeting_id: &str) -> Result<Option<Notes>, DbError> {
        let raw = self
            .conn
            .query_row(
                "SELECT meeting_id, summary, takeaways_json, markdown, updated_at
                 FROM notes WHERE meeting_id = ?1",
                [meeting_id],
                |row| {
                    let takeaways_json: String = row.get(2)?;
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        takeaways_json,
                        row.get::<_, String>(3)?,
                        row.get::<_, i64>(4)?,
                    ))
                },
            )
            .optional()?;
        let Some((meeting_id, summary, takeaways_json, markdown, updated_at)) = raw else {
            return Ok(None);
        };
        let takeaways = serde_json::from_str(&takeaways_json).unwrap_or_default();
        Ok(Some(Notes {
            meeting_id,
            summary,
            takeaways,
            markdown,
            updated_at,
        }))
    }

    pub fn put_notes(
        &self,
        meeting_id: &str,
        summary: &str,
        takeaways: &[String],
        markdown: &str,
    ) -> Result<Notes, DbError> {
        self.require_meeting(meeting_id)?;
        let updated_at = now_ms();
        let takeaways_json = serde_json::to_string(takeaways)?;
        self.conn.execute(
            "INSERT INTO notes (meeting_id, summary, takeaways_json, markdown, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(meeting_id) DO UPDATE SET
               summary = excluded.summary,
               takeaways_json = excluded.takeaways_json,
               markdown = excluded.markdown,
               updated_at = excluded.updated_at",
            params![meeting_id, summary, takeaways_json, markdown, updated_at],
        )?;
        self.get_notes(meeting_id)?
            .ok_or_else(|| DbError::msg("internal", "Notes were not saved."))
    }

    pub fn list_actions(&self, meeting_id: &str) -> Result<Vec<ActionItem>, DbError> {
        self.require_meeting(meeting_id)?;
        let mut stmt = self.conn.prepare(
            "SELECT id, meeting_id, text, owner, due, position
             FROM action_items
             WHERE meeting_id = ?1
             ORDER BY position ASC",
        )?;
        let rows = stmt.query_map([meeting_id], map_action)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(DbError::from)
    }

    pub fn replace_actions(
        &self,
        meeting_id: &str,
        items: &[ActionDraft],
    ) -> Result<Vec<ActionItem>, DbError> {
        self.require_meeting(meeting_id)?;
        let tx = self.conn.unchecked_transaction()?;
        tx.execute("DELETE FROM action_items WHERE meeting_id = ?1", [meeting_id])?;
        let mut saved = Vec::with_capacity(items.len());
        for (position, item) in items.iter().enumerate() {
            let action = ActionItem {
                id: new_id("a"),
                meeting_id: meeting_id.to_string(),
                text: item.text.clone(),
                owner: item.owner.clone(),
                due: item.due.clone(),
                position: position as i64,
            };
            tx.execute(
                "INSERT INTO action_items (id, meeting_id, text, owner, due, position)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    action.id,
                    action.meeting_id,
                    action.text,
                    action.owner,
                    action.due,
                    action.position
                ],
            )?;
            saved.push(action);
        }
        tx.commit()?;
        Ok(saved)
    }

    pub fn get_settings(&self) -> Result<Option<Settings>, DbError> {
        let raw: Option<String> = self
            .conn
            .query_row(
                "SELECT value FROM app_settings WHERE key = 'values'",
                [],
                |row| row.get(0),
            )
            .optional()?;
        match raw {
            Some(raw) => Ok(Some(serde_json::from_str(&raw)?)),
            None => Ok(None),
        }
    }

    pub fn get_blob(&self, key: &str) -> Result<Option<String>, DbError> {
        let raw: Option<String> = self
            .conn
            .query_row(
                "SELECT value FROM app_settings WHERE key = ?1",
                [key],
                |row| row.get(0),
            )
            .optional()?;
        Ok(raw)
    }

    pub fn set_blob(&self, key: &str, value: &str) -> Result<(), DbError> {
        self.conn.execute(
            "INSERT INTO app_settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
        Ok(())
    }

    pub fn set_settings(&self, settings: &Settings) -> Result<(), DbError> {
        let raw = serde_json::to_string(settings)?;
        self.conn.execute(
            "INSERT INTO app_settings (key, value) VALUES ('values', ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            [raw],
        )?;
        Ok(())
    }

    pub fn set_secret_ref(&self, module_id: &str, target: &str) -> Result<(), DbError> {
        self.conn.execute(
            "INSERT INTO secret_refs (module_id, credential_target, updated_at)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(module_id) DO UPDATE SET
               credential_target = excluded.credential_target,
               updated_at = excluded.updated_at",
            params![module_id, target, now_ms()],
        )?;
        Ok(())
    }

    pub fn delete_secret_ref(&self, module_id: &str) -> Result<(), DbError> {
        self.conn
            .execute("DELETE FROM secret_refs WHERE module_id = ?1", [module_id])?;
        Ok(())
    }

    pub fn list_installs(&self) -> Result<Vec<InstallRow>, DbError> {
        let mut stmt = self.conn.prepare(
            "SELECT module_id, status, path, bytes_done, bytes_total, speed_bps, message, updated_at
             FROM installed_modules
             ORDER BY updated_at DESC",
        )?;
        let rows = stmt.query_map([], map_install)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(DbError::from)
    }

    pub fn get_install(&self, module_id: &str) -> Result<Option<InstallRow>, DbError> {
        self.conn
            .query_row(
                "SELECT module_id, status, path, bytes_done, bytes_total, speed_bps, message, updated_at
                 FROM installed_modules WHERE module_id = ?1",
                [module_id],
                map_install,
            )
            .optional()
            .map_err(DbError::from)
    }

    pub fn upsert_install(
        &self,
        module_id: &str,
        status: &str,
        path: Option<&str>,
        bytes_done: i64,
        bytes_total: Option<i64>,
        speed_bps: i64,
        message: Option<&str>,
    ) -> Result<InstallRow, DbError> {
        self.conn.execute(
            "INSERT INTO installed_modules
             (module_id, status, path, bytes_done, bytes_total, speed_bps, message, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(module_id) DO UPDATE SET
               status = excluded.status,
               path = excluded.path,
               bytes_done = excluded.bytes_done,
               bytes_total = COALESCE(excluded.bytes_total, installed_modules.bytes_total),
               speed_bps = excluded.speed_bps,
               message = excluded.message,
               updated_at = excluded.updated_at",
            params![
                module_id,
                status,
                path,
                bytes_done,
                bytes_total,
                speed_bps,
                message,
                now_ms()
            ],
        )?;
        self.get_install(module_id)?
            .ok_or_else(|| DbError::msg("internal", "Install row was not saved."))
    }

    /// Byte and speed update that leaves a paused row paused.
    pub fn touch_download_progress(
        &self,
        module_id: &str,
        bytes_done: i64,
        bytes_total: Option<i64>,
        speed_bps: i64,
        message: &str,
    ) -> Result<(), DbError> {
        self.conn.execute(
            "UPDATE installed_modules
             SET bytes_done = ?2,
                 bytes_total = COALESCE(?3, bytes_total),
                 speed_bps = ?4,
                 message = ?5,
                 updated_at = ?6
             WHERE module_id = ?1 AND status = 'downloading'",
            params![module_id, bytes_done, bytes_total, speed_bps, message, now_ms()],
        )?;
        Ok(())
    }

    pub fn insert_dictation(
        &self,
        meeting_id: Option<&str>,
        module_id: &str,
        text: &str,
    ) -> Result<Dictation, DbError> {
        if let Some(meeting_id) = meeting_id {
            self.require_meeting(meeting_id)?;
        }
        let dictation = Dictation {
            id: new_id("dict"),
            meeting_id: meeting_id.map(|id| id.to_string()),
            module_id: module_id.to_string(),
            text: text.to_string(),
            created_at: now_ms(),
        };
        self.conn.execute(
            "INSERT INTO dictations (id, meeting_id, module_id, text, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                dictation.id,
                dictation.meeting_id,
                dictation.module_id,
                dictation.text,
                dictation.created_at
            ],
        )?;
        Ok(dictation)
    }

    pub fn list_dictations(&self, limit: i64) -> Result<Vec<Dictation>, DbError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, meeting_id, module_id, text, created_at
             FROM dictations
             ORDER BY created_at DESC
             LIMIT ?1",
        )?;
        let rows = stmt.query_map([limit], map_dictation)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(DbError::from)
    }

    fn require_meeting(&self, id: &str) -> Result<(), DbError> {
        let count: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM meetings WHERE id = ?1",
            [id],
            |row| row.get(0),
        )?;
        if count == 0 {
            Err(DbError::msg("not_found", format!("No meeting {id}.")))
        } else {
            Ok(())
        }
    }
}

fn migrate(conn: &Connection) -> Result<(), DbError> {
    let version: i64 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    if version < 1 {
        conn.execute_batch(SCHEMA_V1)?;
        conn.execute_batch("PRAGMA user_version = 1;")?;
    }
    let version: i64 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    if version < 2 {
        conn.execute(
            "ALTER TABLE installed_modules ADD COLUMN speed_bps INTEGER NOT NULL DEFAULT 0",
            [],
        )?;
        conn.execute_batch("PRAGMA user_version = 2;")?;
    }
    Ok(())
}

fn map_meeting(row: &Row<'_>) -> rusqlite::Result<Meeting> {
    Ok(Meeting {
        id: row.get(0)?,
        title: row.get(1)?,
        started_at: row.get(2)?,
        ended_at: row.get(3)?,
        status: row.get(4)?,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
    })
}

fn map_utterance(row: &Row<'_>) -> rusqlite::Result<Utterance> {
    Ok(Utterance {
        id: row.get(0)?,
        meeting_id: row.get(1)?,
        speaker: row.get(2)?,
        text: row.get(3)?,
        started_at: row.get(4)?,
        ended_at: row.get(5)?,
        seq: row.get(6)?,
        created_at: row.get(7)?,
    })
}

fn map_action(row: &Row<'_>) -> rusqlite::Result<ActionItem> {
    Ok(ActionItem {
        id: row.get(0)?,
        meeting_id: row.get(1)?,
        text: row.get(2)?,
        owner: row.get(3)?,
        due: row.get(4)?,
        position: row.get(5)?,
    })
}

fn map_install(row: &Row<'_>) -> rusqlite::Result<InstallRow> {
    Ok(InstallRow {
        module_id: row.get(0)?,
        status: row.get(1)?,
        path: row.get(2)?,
        bytes_done: row.get(3)?,
        bytes_total: row.get(4)?,
        speed_bps: row.get(5)?,
        message: row.get(6)?,
        updated_at: row.get(7)?,
    })
}

fn map_dictation(row: &Row<'_>) -> rusqlite::Result<Dictation> {
    Ok(Dictation {
        id: row.get(0)?,
        meeting_id: row.get(1)?,
        module_id: row.get(2)?,
        text: row.get(3)?,
        created_at: row.get(4)?,
    })
}

fn fts_phrase(query: &str) -> String {
    let mut out = String::from("\"");
    for ch in query.chars() {
        if ch == '"' {
            out.push('"');
        }
        out.push(ch);
    }
    out.push('"');
    out
}

fn fts_error(err: &rusqlite::Error) -> bool {
    err.to_string().to_lowercase().contains("fts")
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;
    use serde_json::json;

    struct TempDir(PathBuf);

    impl TempDir {
        fn new(label: &str) -> Self {
            let path = std::env::temp_dir().join(format!(
                "crunchcall-{label}-{}-{}",
                std::process::id(),
                new_id("t")
            ));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn migrate_meeting_utterance_and_fts() {
        let dir = TempDir::new("fts");
        let db = Db::open(dir.path()).unwrap();
        let meeting = db.create_meeting("Standup", "live", Some(10)).unwrap();
        db.append_utterance(
            &meeting.id,
            Some("Ada"),
            "The pineapple roadmap is ready",
            None,
            None,
        )
        .unwrap();
        db.append_utterance(&meeting.id, Some("Bea"), "Other topic", None, None)
            .unwrap();
        let hits = db.search("pineapple").unwrap();
        assert_eq!(hits.len(), 1);
        assert!(hits[0].text.contains("pineapple"));
        assert_eq!(hits[0].meeting_id, meeting.id);
        assert_eq!(hits[0].speaker.as_deref(), Some("Ada"));
        let listed = db.list_utterances(&meeting.id).unwrap();
        assert_eq!(listed.len(), 2);
        assert_eq!(listed[0].seq, 1);
        let got = db.get_meeting(&meeting.id).unwrap();
        assert_eq!(got.title, "Standup");
        let meetings = db.list_meetings().unwrap();
        assert_eq!(meetings.len(), 1);
    }

    #[test]
    fn settings_roundtrip() {
        let dir = TempDir::new("settings");
        let db = Db::open(dir.path()).unwrap();
        assert!(db.get_settings().unwrap().is_none());
        let mut overrides = Map::new();
        overrides.insert("writer.openai".into(), json!("gpt-4.1-mini"));
        let settings = Settings {
            speech: "speech.openai".into(),
            writer: "writer.openai".into(),
            coach: "coach.rules".into(),
            coach_pack: "coach.pack.manager".into(),
            language: "en".into(),
            model_overrides: overrides,
        };
        db.set_settings(&settings).unwrap();
        let got = db.get_settings().unwrap().unwrap();
        assert_eq!(got, settings);
    }

    #[test]
    fn v1_download_gains_speed_and_pause_keeps_bytes() {
        let dir = TempDir::new("speed");
        let path = dir.path().join("crunchcall.db");
        {
            let conn = Connection::open(&path).unwrap();
            conn.execute_batch(super::SCHEMA_V1).unwrap();
            conn.execute_batch("PRAGMA user_version = 1;").unwrap();
            conn.execute(
                "INSERT INTO installed_modules
                 (module_id, status, path, bytes_done, bytes_total, message, updated_at)
                 VALUES ('speech.whisper.tiny', 'downloading', 'C:/models/tiny.bin', 4096, 80000, 'Download started.', 1)",
                [],
            )
            .unwrap();
        }
        let db = Db::open(dir.path()).unwrap();
        let row = db.get_install("speech.whisper.tiny").unwrap().unwrap();
        assert_eq!(row.speed_bps, 0);
        assert_eq!(row.bytes_done, 4096);
        assert_eq!(row.bytes_total, Some(80000));
        db.touch_download_progress("speech.whisper.tiny", 8192, Some(80000), 250_000, "Downloading.")
            .unwrap();
        let row = db.get_install("speech.whisper.tiny").unwrap().unwrap();
        assert_eq!(row.status, "downloading");
        assert_eq!(row.bytes_done, 8192);
        assert_eq!(row.speed_bps, 250_000);
        db.mark_interrupted_downloads().unwrap();
        let row = db.get_install("speech.whisper.tiny").unwrap().unwrap();
        assert_eq!(row.status, "paused");
        assert_eq!(row.bytes_done, 8192);
        assert_eq!(row.speed_bps, 0);
        assert_eq!(row.message.as_deref(), Some("Paused when the app closed."));
        db.touch_download_progress("speech.whisper.tiny", 9000, Some(80000), 10, "Downloading.")
            .unwrap();
        let row = db.get_install("speech.whisper.tiny").unwrap().unwrap();
        assert_eq!(row.status, "paused");
        assert_eq!(row.bytes_done, 8192);
        assert_eq!(row.speed_bps, 0);
    }
}
