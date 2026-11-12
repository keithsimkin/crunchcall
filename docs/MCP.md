# annotated MCP

annotated exposes a **local, read-only MCP server** so other AI tools can search and read the notes already captured on this PC. No meeting bot, no cloud hop, no audio, and no API keys cross the boundary.

The app ships a demo server in [`mcp/server.ts`](../mcp/server.ts) that serves the same sample notes as the UI. It is the behavior spec for the native `crunchcalld mcp --stdio` command described in [`docs/PLAN.md`](PLAN.md).

## Run the demo

```bash
bun run mcp
```

The server speaks newline-delimited JSON-RPC over stdio and stays running until stdin closes. It writes logs to stderr only, so stdout stays clean for the MCP client.

## Connect a client

### Claude Desktop

Open **Settings → Developer → Edit Config** and add:

```json
{
  "mcpServers": {
    "annotated": {
      "command": "bun",
      "args": ["C:\\path\\to\\annotated\\mcp\\server.ts"]
    }
  }
}
```

Restart Claude Desktop. The annotated tools appear in the tools menu.

Claude Code can use the same JSON, or:

```bash
claude mcp add annotated -- bun C:\path\to\annotated\mcp\server.ts
```

### Gemini CLI

Add the same `mcpServers` object to `settings.json` in your user folder (`.gemini` on Windows and macOS), then restart Gemini CLI.

### Cursor

Add the same server to Cursor's MCP settings (`Settings → MCP → Add server`), or put this in the project's `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "annotated": {
      "command": "bun",
      "args": ["C:\\path\\to\\annotated\\mcp\\server.ts"]
    }
  }
}
```

### Any MCP client

Use the stdio transport with:

```text
command: bun
args:    C:\path\to\annotated\mcp\server.ts
```

In the packaged app this becomes `crunchcalld mcp --stdio`, with no path to manage.

## Tools

| Tool | Arguments | What it returns |
| --- | --- | --- |
| `list_meetings` | `status?`, `project?`, `query?`, `limit?` | Recent calls with people, topics, and source |
| `search_notes` | `query`, `scope?`, `limit?` | Ranked notes with the matching person, topic, action, or transcript line |
| `read_notes` | `meetingId` | Summary, takeaways, owners, dates, and the transcript |
| `read_transcript` | `meetingId` | Timestamped utterances for one call |
| `list_projects` | — | Folders on the desk and the meetings inside them |

`scope` for `search_notes` is one of `all`, `people`, `topics`, `actions`, or `projects`.

### Try asking

- “Which notes mention Maya this month?”
- “What did we promise Northwind?”
- “Summarize every open next step across Lumen.”
- “Who did I talk to about pricing?”

## Privacy

- The server is **local only** and starts with the app.
- It is **read-only**: clients cannot edit, delete, or change the folder a meeting belongs to.
- It never exposes raw audio, credentials, API keys, or the BYOK secret store.
- The app keeps a local request log so the user can see which client read what.
- Turning the server off in **Connect** ends access for every client immediately.

In the packaged product, the server will be a Rust stdio companion (see `docs/PLAN.md`) backed by SQLite + FTS5. The demo server uses the same tool names and response shapes so clients can be wired up before the native side lands.
