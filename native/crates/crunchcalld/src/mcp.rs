use std::io::{self, BufRead, Write};

use crunchcall_db::Db;
use crunchcall_engine::{data_dir, read_mcp_policy, McpPolicy};
use serde_json::{json, Value};

const PROTOCOL_VERSION: &str = "2025-06-18";

pub fn serve() -> i32 {
    let db = match Db::open(&data_dir()) {
        Ok(db) => db,
        Err(err) => {
            eprintln!("crunchcalld mcp: {err}");
            return 1;
        }
    };
    let stdin = io::stdin();
    let mut stdout = io::stdout();
    for line in stdin.lock().lines() {
        let line = match line {
            Ok(line) => line,
            Err(err) => {
                eprintln!("crunchcalld mcp: {err}");
                break;
            }
        };
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let parsed: Value = match serde_json::from_str(trimmed) {
            Ok(value) => value,
            Err(_) => {
                let _ = writeln!(stdout, "{}", fail(Value::Null, -32700, "Parse error"));
                let _ = stdout.flush();
                continue;
            }
        };
        if let Some(batch) = parsed.as_array() {
            for item in batch {
                let _ = write_response(&mut stdout, &db, item);
            }
            continue;
        }
        let _ = write_response(&mut stdout, &db, &parsed);
    }
    0
}

fn write_response(stdout: &mut impl Write, db: &Db, message: &Value) -> io::Result<()> {
    if let Some(response) = handle(db, message) {
        writeln!(stdout, "{response}")?;
        stdout.flush()?;
    }
    Ok(())
}

fn handle(db: &Db, message: &Value) -> Option<Value> {
    if !message.is_object() {
        return Some(fail(Value::Null, -32600, "Expected a JSON-RPC object."));
    }
    let has_id = message.get("id").is_some();
    if !has_id {
        return None;
    }
    let id = message.get("id").cloned().unwrap_or(Value::Null);
    let method = message.get("method").and_then(|value| value.as_str()).unwrap_or("");
    let params = message.get("params").cloned().unwrap_or_else(|| json!({}));
    let result = match method {
        "initialize" => {
            let requested = params
                .get("protocolVersion")
                .and_then(|value| value.as_str())
                .unwrap_or(PROTOCOL_VERSION);
            json!({
                "protocolVersion": requested,
                "capabilities": { "tools": {} },
                "serverInfo": { "name": "annotated-notes", "version": "0.1.0" },
                "instructions": "Read-only access to annotated meeting notes on this PC. No audio and no API keys."
            })
        }
        "ping" => json!({}),
        "tools/list" => json!({ "tools": tools() }),
        "tools/call" => {
            let name = params.get("name").and_then(|value| value.as_str()).unwrap_or("");
            let args = params.get("arguments").cloned().unwrap_or_else(|| json!({}));
            let text = call_tool(db, name, &args);
            let is_error = text.starts_with("Connections are paused") || text.starts_with("Unknown tool");
            json!({
                "content": [{ "type": "text", "text": text }],
                "isError": is_error
            })
        }
        "resources/list" => json!({ "resources": [] }),
        "prompts/list" => json!({ "prompts": [] }),
        _ => return Some(fail(id, -32601, &format!("Method not found: {method}"))),
    };
    Some(json!({ "jsonrpc": "2.0", "id": id, "result": result }))
}

fn fail(id: Value, code: i64, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

fn tools() -> Value {
    json!([
        {
            "name": "list_meetings",
            "description": "List meetings captured on this PC.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "status": { "type": "string" },
                    "project": { "type": "string" },
                    "query": { "type": "string" },
                    "limit": { "type": "number" }
                },
                "additionalProperties": false
            }
        },
        {
            "name": "search_notes",
            "description": "Search notes and transcripts saved on this PC.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "query": { "type": "string" },
                    "scope": { "type": "string", "enum": ["all", "people", "topics", "actions", "projects"] },
                    "limit": { "type": "number" }
                },
                "required": ["query"],
                "additionalProperties": false
            }
        },
        {
            "name": "read_notes",
            "description": "Read the curated notes for one meeting.",
            "inputSchema": {
                "type": "object",
                "properties": { "meetingId": { "type": "string" } },
                "required": ["meetingId"],
                "additionalProperties": false
            }
        },
        {
            "name": "read_transcript",
            "description": "Read the timestamped transcript for one meeting.",
            "inputSchema": {
                "type": "object",
                "properties": { "meetingId": { "type": "string" } },
                "required": ["meetingId"],
                "additionalProperties": false
            }
        },
        {
            "name": "list_projects",
            "description": "List project folders and the meetings filed in them.",
            "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false }
        }
    ])
}

fn call_tool(db: &Db, name: &str, args: &Value) -> String {
    let policy = read_mcp_policy(db);
    if !policy.enabled {
        return "Connections are paused in annotated. Turn Allow connections back on.".to_string();
    }
    match name {
        "list_meetings" => list_meetings(db, args, policy),
        "search_notes" => search_notes(db, args, policy),
        "read_notes" => read_notes(db, args, policy),
        "read_transcript" => read_transcript(db, args, policy),
        "list_projects" => list_projects(db),
        other => format!("Unknown tool: {other}"),
    }
}

struct MeetingRow {
    id: String,
    title: String,
    status: String,
}

fn meetings(db: &Db) -> Vec<MeetingRow> {
    db.list_meetings()
        .unwrap_or_default()
        .into_iter()
        .map(|meeting| MeetingRow {
            id: meeting.id,
            title: meeting.title,
            status: meeting.status,
        })
        .collect()
}

fn find_meeting(rows: &[MeetingRow], needle: &str) -> Option<usize> {
    let needle = needle.trim().to_lowercase();
    if needle.is_empty() {
        return None;
    }
    rows.iter().position(|row| row.id.to_lowercase() == needle)
        .or_else(|| rows.iter().position(|row| row.title.to_lowercase() == needle))
        .or_else(|| rows.iter().position(|row| row.title.to_lowercase().contains(&needle)))
        .or_else(|| rows.iter().position(|row| row.id.to_lowercase().contains(&needle)))
}

fn arg_str(args: &Value, key: &str) -> String {
    args.get(key).and_then(|value| value.as_str()).unwrap_or("").trim().to_string()
}

fn arg_limit(args: &Value, fallback: usize, max: usize) -> usize {
    let value = args.get("limit").and_then(|item| item.as_i64()).unwrap_or(fallback as i64);
    value.clamp(1, max as i64) as usize
}

fn list_meetings(db: &Db, args: &Value, policy: McpPolicy) -> String {
    let status = arg_str(args, "status");
    let project = arg_str(args, "project").to_lowercase();
    let query = arg_str(args, "query").to_lowercase();
    let limit = arg_limit(args, 20, 100);
    let folders = folders(db);
    let mut rows = meetings(db);
    if !status.is_empty() {
        rows.retain(|row| row.status == status);
    }
    if !project.is_empty() {
        let folder = folders.iter().find(|folder| {
            folder.id.to_lowercase() == project || folder.name.to_lowercase().contains(&project)
        });
        match folder {
            Some(folder) => rows.retain(|row| folder.meeting_ids.iter().any(|id| id == &row.id)),
            None => rows.clear(),
        }
    }
    if !query.is_empty() {
        rows.retain(|row| meeting_blob(db, row, policy).to_lowercase().contains(&query));
    }
    let shown = rows.len().min(limit);
    let mut out = format!("# Meetings ({shown}");
    if rows.len() > shown {
        out.push_str(&format!(" of {}", rows.len()));
    }
    out.push_str(")\n\n");
    for row in rows.into_iter().take(limit) {
        out.push_str(&format!("- {} ({}) — {}\n  {}\n\n", row.title, row.id, row.status, meeting_blob(db, &row, policy)));
    }
    out
}

fn search_notes(db: &Db, args: &Value, policy: McpPolicy) -> String {
    let query = arg_str(args, "query");
    if query.is_empty() {
        return "Pass a query, such as a person, a topic, or a phrase.".to_string();
    }
    let scope = arg_str(args, "scope");
    let limit = arg_limit(args, 10, 50);
    let needle = query.to_lowercase();
    let mut hits = Vec::new();
    for row in meetings(db) {
        let blob = scoped_blob(db, &row, policy, &scope);
        if blob.to_lowercase().contains(&needle) {
            hits.push(format!("## {} ({})\n{}", row.title, row.id, clip(&blob, 500)));
        }
        if hits.len() == limit {
            break;
        }
    }
    if hits.is_empty() {
        return format!("No notes match \"{query}\".");
    }
    format!("# {} match \"{query}\"\n\n{}", hits.len(), hits.join("\n\n"))
}

fn read_notes(db: &Db, args: &Value, policy: McpPolicy) -> String {
    let rows = meetings(db);
    let Some(index) = find_meeting(&rows, &arg_str(args, "meetingId")) else {
        return "No meeting matched that id or title.".to_string();
    };
    let row = &rows[index];
    let notes = db.get_notes(&row.id).ok().flatten();
    let summary = notes.as_ref().map(|item| item.summary.clone()).unwrap_or_default();
    let mut out = format!("# {}\n\n{}\n\n{}", row.title, row.status, if summary.is_empty() { "No summary yet.".to_string() } else { summary });
    if let Some(notes) = notes {
        if !notes.takeaways.is_empty() {
            out.push_str("\n\n## Takeaways\n");
            for item in notes.takeaways {
                out.push_str(&format!("- {item}\n"));
            }
        }
        if !notes.markdown.is_empty() {
            out.push_str("\n\n");
            out.push_str(&notes.markdown);
        }
    }
    if policy.actions {
        if let Ok(actions) = db.list_actions(&row.id) {
            if !actions.is_empty() {
                out.push_str("\n\n## Next steps\n");
                for action in actions {
                    let owner = action.owner.unwrap_or_else(|| "Unassigned".to_string());
                    let due = action.due.unwrap_or_else(|| "No date".to_string());
                    out.push_str(&format!("- [ ] {} — {owner} — {due}\n", action.text));
                }
            }
        }
    }
    out
}

fn read_transcript(db: &Db, args: &Value, policy: McpPolicy) -> String {
    if !policy.transcripts {
        return "Transcript excerpts are off in annotated.".to_string();
    }
    let rows = meetings(db);
    let Some(index) = find_meeting(&rows, &arg_str(args, "meetingId")) else {
        return "No meeting matched that id or title.".to_string();
    };
    let row = &rows[index];
    let lines = db.list_utterances(&row.id).unwrap_or_default();
    if lines.is_empty() {
        return format!("# {}\n\nNo transcript yet.", row.title);
    }
    let mut out = format!("# {} — transcript\n\n", row.title);
    for line in lines {
        let speaker = line.speaker.unwrap_or_else(|| "Speaker".to_string());
        out.push_str(&format!("- {speaker}: {}\n", line.text));
    }
    out
}

struct Folder {
    id: String,
    name: String,
    blurb: String,
    meeting_ids: Vec<String>,
}

fn folders(db: &Db) -> Vec<Folder> {
    let raw = db.get_blob("folders").ok().flatten().unwrap_or_else(|| "[]".to_string());
    let value: Value = serde_json::from_str(&raw).unwrap_or_else(|_| json!([]));
    let Some(items) = value.as_array() else {
        return Vec::new();
    };
    items
        .iter()
        .filter_map(|item| {
            let name = item.get("name").and_then(|value| value.as_str())?.trim();
            if name.is_empty() {
                return None;
            }
            let id = item.get("id").and_then(|value| value.as_str()).unwrap_or("folder").to_string();
            let blurb = item.get("blurb").and_then(|value| value.as_str()).unwrap_or("").to_string();
            let meeting_ids = item
                .get("meetingIds")
                .and_then(|value| value.as_array())
                .map(|ids| {
                    ids.iter()
                        .filter_map(|id| id.as_str().map(|value| value.to_string()))
                        .collect()
                })
                .unwrap_or_default();
            Some(Folder {
                id,
                name: name.to_string(),
                blurb,
                meeting_ids,
            })
        })
        .collect()
}

fn list_projects(db: &Db) -> String {
    let folders = folders(db);
    if folders.is_empty() {
        return "No folders yet. Create one in Projects.".to_string();
    }
    let rows = meetings(db);
    let mut out = String::from("# Projects\n\n");
    for folder in folders {
        out.push_str(&format!("## {} ({})\n{}\n", folder.name, folder.id, folder.blurb));
        let mut count = 0;
        for id in &folder.meeting_ids {
            if let Some(row) = rows.iter().find(|row| &row.id == id) {
                out.push_str(&format!("- {}\n", row.title));
                count += 1;
            }
        }
        if count == 0 {
            out.push_str("- No meetings filed here yet.\n");
        }
        out.push('\n');
    }
    out
}

fn meeting_blob(db: &Db, row: &MeetingRow, policy: McpPolicy) -> String {
    scoped_blob(db, row, policy, "all")
}

fn scoped_blob(db: &Db, row: &MeetingRow, policy: McpPolicy, scope: &str) -> String {
    let mut parts = Vec::new();
    if scope == "all" || scope == "topics" || scope.is_empty() {
        parts.push(row.title.clone());
        parts.push(row.status.clone());
    }
    if scope == "all" || scope == "projects" || scope.is_empty() {
        if let Some(folder) = folders(db)
            .into_iter()
            .find(|folder| folder.meeting_ids.iter().any(|id| id == &row.id))
        {
            parts.push(folder.name);
        }
    }
    if scope != "projects" {
        if let Ok(Some(notes)) = db.get_notes(&row.id) {
            if scope == "all" || scope == "topics" || scope.is_empty() {
                parts.push(notes.summary);
                parts.extend(notes.takeaways);
            }
        }
    }
    if policy.actions && (scope == "all" || scope == "actions" || scope == "people" || scope.is_empty()) {
        if let Ok(actions) = db.list_actions(&row.id) {
            for action in actions {
                if scope != "people" {
                    parts.push(action.text);
                }
                if let Some(owner) = action.owner {
                    parts.push(owner);
                }
            }
        }
    }
    if policy.transcripts && (scope == "all" || scope == "people" || scope.is_empty()) {
        if let Ok(lines) = db.list_utterances(&row.id) {
            for line in lines {
                if let Some(speaker) = line.speaker {
                    parts.push(speaker);
                }
                if scope != "people" {
                    parts.push(line.text);
                }
            }
        }
    }
    parts.join("\n")
}

fn clip(text: &str, max: usize) -> String {
    let trimmed = text.trim();
    if trimmed.chars().count() <= max {
        return trimmed.to_string();
    }
    let end = trimmed.chars().take(max.saturating_sub(1)).collect::<String>();
    format!("{end}…")
}
