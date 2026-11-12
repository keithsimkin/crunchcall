/**
 * annotated MCP server.
 *
 * Read-only access to the notes database on this PC.
 * The packaged app uses `crunchcalld mcp --stdio`, which reads the same file.
 *
 * Run with Bun: `bun run mcp`
 * MCP transport: newline-delimited JSON-RPC over stdio.
 */

import { createInterface } from 'node:readline'
import { Database } from 'bun:sqlite'
import { join } from 'node:path'

type SearchScope = 'all' | 'people' | 'topics' | 'actions' | 'projects'

type JsonRpcId = string | number | null
type ToolArgs = Record<string, unknown>

const PROTOCOL_VERSION = '2025-06-18'
const SERVER_INFO = { name: 'annotated-notes', version: '0.1.0' }

const SCOPES: SearchScope[] = ['all', 'people', 'topics', 'actions', 'projects']

const TOOLS = [
  {
    name: 'list_meetings',
    description: 'List recent meetings captured on this PC, with people, topics, and status.',
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['draft', 'live', 'processing', 'ready'],
          description: 'Only return meetings in this state.',
        },
        project: {
          type: 'string',
          description: 'A project folder name or id, such as Northwind or lumen.',
        },
        query: { type: 'string', description: 'Optional text filter over the title, people, and topics.' },
        limit: { type: 'number', description: 'Maximum meetings to return. Defaults to 20.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'search_notes',
    description:
      'Search past notes by person, topic, title, summary, next steps, or transcript line. Read-only.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Words to find, such as Maya, pricing, or annual billing.' },
        scope: {
          type: 'string',
          enum: SCOPES,
          description: 'Narrow the search to one field. Defaults to all.',
        },
        limit: { type: 'number', description: 'Maximum notes to return. Defaults to 10.' },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'read_notes',
    description: 'Read the curated notes for one meeting: summary, takeaways, next steps, and transcript.',
    inputSchema: {
      type: 'object',
      properties: {
        meetingId: { type: 'string', description: 'A meeting id or a title fragment, such as pricing.' },
      },
      required: ['meetingId'],
      additionalProperties: false,
    },
  },
  {
    name: 'read_transcript',
    description: 'Read the timestamped transcript for one meeting.',
    inputSchema: {
      type: 'object',
      properties: {
        meetingId: { type: 'string', description: 'A meeting id or a title fragment.' },
      },
      required: ['meetingId'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_projects',
    description: 'List the project folders on the desk and the meetings filed inside them.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
]

function send(message: unknown) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

function reply(id: JsonRpcId, result: unknown) {
  send({ jsonrpc: '2.0', id, result })
}

function fail(id: JsonRpcId, code: number, message: string) {
  send({ jsonrpc: '2.0', id, error: { code, message } })
}

function textResult(text: string, isError = false) {
  return { content: [{ type: 'text', text }], ...(isError ? { isError: true } : {}) }
}

function stringArg(args: ToolArgs, key: string): string {
  const value = args[key]
  return typeof value === 'string' ? value.trim() : ''
}

function numberArg(args: ToolArgs, key: string, fallback: number): number {
  const value = args[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

type MeetingRow = { id: string; title: string; status: string }

function dbFile(): string {
  const override = process.env.CRUNCHCALL_DATA_DIR?.trim()
  const dir = override || join(process.env.LOCALAPPDATA || '.', 'CrunchCall')
  return join(dir, 'crunchcall.db')
}

function openDb(): Database | null {
  try {
    return new Database(dbFile(), { readonly: true })
  } catch {
    return null
  }
}

function policy(db: Database): { enabled: boolean; transcripts: boolean; actions: boolean } {
  const row = db.query("SELECT value FROM app_settings WHERE key = 'mcp'").get() as { value?: string } | null
  if (!row?.value) return { enabled: true, transcripts: true, actions: true }
  try {
    const parsed = JSON.parse(row.value) as { enabled?: boolean; transcripts?: boolean; actions?: boolean }
    return {
      enabled: parsed.enabled !== false,
      transcripts: parsed.transcripts !== false,
      actions: parsed.actions !== false,
    }
  } catch {
    return { enabled: true, transcripts: true, actions: true }
  }
}

function meetings(db: Database): MeetingRow[] {
  return db.query('SELECT id, title, status FROM meetings ORDER BY updated_at DESC').all() as MeetingRow[]
}

function findMeeting(db: Database, value: string): MeetingRow | null {
  const needle = value.trim().toLowerCase()
  if (!needle) return null
  const rows = meetings(db)
  return (
    rows.find((meeting) => meeting.id.toLowerCase() === needle) ??
    rows.find((meeting) => meeting.title.toLowerCase() === needle) ??
    rows.find((meeting) => meeting.title.toLowerCase().includes(needle)) ??
    rows.find((meeting) => meeting.id.toLowerCase().includes(needle)) ??
    null
  )
}

function blob(db: Database, meeting: MeetingRow, scope: SearchScope): string {
  const flags = policy(db)
  const parts = [meeting.title, meeting.status]
  const notes = db.query('SELECT summary, takeaways_json FROM notes WHERE meeting_id = ?').get(meeting.id) as
    | { summary?: string; takeaways_json?: string }
    | null
  if (notes && (scope === 'all' || scope === 'topics')) {
    parts.push(notes.summary || '')
    try {
      const takeaways = JSON.parse(notes.takeaways_json || '[]') as unknown[]
      for (const item of takeaways) if (typeof item === 'string') parts.push(item)
    } catch {
      /* ignore malformed notes */
    }
  }
  if (flags.actions && (scope === 'all' || scope === 'actions' || scope === 'people')) {
    const actions = db.query('SELECT text, owner FROM action_items WHERE meeting_id = ?').all(meeting.id) as {
      text: string
      owner: string | null
    }[]
    for (const action of actions) {
      if (scope !== 'people') parts.push(action.text)
      if (action.owner) parts.push(action.owner)
    }
  }
  if (flags.transcripts && (scope === 'all' || scope === 'people')) {
    const lines = db.query('SELECT speaker, text FROM utterances WHERE meeting_id = ? ORDER BY seq').all(meeting.id) as {
      speaker: string | null
      text: string
    }[]
    for (const line of lines) {
      if (line.speaker) parts.push(line.speaker)
      if (scope !== 'people') parts.push(line.text)
    }
  }
  return parts.join('\n')
}

function listMeetings(db: Database, args: ToolArgs): string {
  const flags = policy(db)
  if (!flags.enabled) return 'Connections are paused in annotated.'
  const status = stringArg(args, 'status')
  const query = stringArg(args, 'query').toLowerCase()
  const limit = Math.max(1, Math.min(100, numberArg(args, 'limit', 20)))
  let rows = meetings(db)
  if (status) rows = rows.filter((meeting) => meeting.status === status)
  if (query) rows = rows.filter((meeting) => blob(db, meeting, 'all').toLowerCase().includes(query))
  const visible = rows.slice(0, limit)
  if (visible.length === 0) return '# Meetings (0)\n\nNo meetings saved on this PC yet.'
  return `# Meetings (${visible.length}${rows.length > visible.length ? ` of ${rows.length}` : ''})\n\n${visible
    .map((meeting) => `- ${meeting.title} (${meeting.id}) — ${meeting.status}`)
    .join('\n')}`
}

function searchNotes(db: Database, args: ToolArgs): string {
  const flags = policy(db)
  if (!flags.enabled) return 'Connections are paused in annotated.'
  const query = stringArg(args, 'query')
  if (!query) return 'Pass a query, such as a person, a topic, or a phrase.'
  const rawScope = stringArg(args, 'scope') as SearchScope
  const scope = SCOPES.includes(rawScope) ? rawScope : 'all'
  const limit = Math.max(1, Math.min(50, numberArg(args, 'limit', 10)))
  const needle = query.toLowerCase()
  const hits = meetings(db)
    .filter((meeting) => blob(db, meeting, scope).toLowerCase().includes(needle))
    .slice(0, limit)
  if (hits.length === 0) return `No notes match “${query}”.`
  return `# ${hits.length} match “${query}”\n\n${hits.map((meeting) => `## ${meeting.title} (${meeting.id})`).join('\n\n')}`
}

function readNotes(db: Database, args: ToolArgs): string {
  const flags = policy(db)
  if (!flags.enabled) return 'Connections are paused in annotated.'
  const meeting = findMeeting(db, stringArg(args, 'meetingId'))
  if (!meeting) return 'No meeting matched that id or title.'
  const notes = db.query('SELECT summary, takeaways_json, markdown FROM notes WHERE meeting_id = ?').get(meeting.id) as
    | { summary: string; takeaways_json: string; markdown: string }
    | null
  let takeaways: string[] = []
  try {
    const parsed = JSON.parse(notes?.takeaways_json || '[]') as unknown[]
    takeaways = parsed.filter((item): item is string => typeof item === 'string')
  } catch {
    takeaways = []
  }
  const actions = flags.actions
    ? (db.query('SELECT text, owner, due FROM action_items WHERE meeting_id = ? ORDER BY position').all(meeting.id) as {
        text: string
        owner: string | null
        due: string | null
      }[])
    : []
  return `# ${meeting.title}

${meeting.status}

${notes?.summary || 'No summary yet.'}

## Takeaways

${takeaways.map((item) => `- ${item}`).join('\n') || '- None yet.'}

## Next steps

${actions.map((action) => `- [ ] ${action.text} — ${action.owner ?? 'Unassigned'} — ${action.due ?? 'No date'}`).join('\n') || '- None yet.'}

${notes?.markdown || ''}`
}

function readTranscript(db: Database, args: ToolArgs): string {
  const flags = policy(db)
  if (!flags.enabled) return 'Connections are paused in annotated.'
  if (!flags.transcripts) return 'Transcript excerpts are off in annotated.'
  const meeting = findMeeting(db, stringArg(args, 'meetingId'))
  if (!meeting) return 'No meeting matched that id or title.'
  const lines = db.query('SELECT speaker, text FROM utterances WHERE meeting_id = ? ORDER BY seq').all(meeting.id) as {
    speaker: string | null
    text: string
  }[]
  if (lines.length === 0) return `# ${meeting.title}\n\nNo transcript yet.`
  return `# ${meeting.title} — transcript\n\n${lines.map((line) => `- ${line.speaker || 'Speaker'}: ${line.text}`).join('\n')}`
}

function listProjects(db: Database): string {
  const flags = policy(db)
  if (!flags.enabled) return 'Connections are paused in annotated.'
  const row = db.query("SELECT value FROM app_settings WHERE key = 'folders'").get() as { value?: string } | null
  let folders: { id?: string; name?: string; blurb?: string; meetingIds?: string[] }[] = []
  try {
    const parsed = JSON.parse(row?.value || '[]') as unknown
    if (Array.isArray(parsed)) folders = parsed as typeof folders
  } catch {
    folders = []
  }
  if (folders.length === 0) return 'No folders yet. Create one in Projects.'
  const rows = meetings(db)
  return `# Projects\n\n${folders
    .map((folder) => {
      const names = (folder.meetingIds ?? [])
        .map((id) => rows.find((meeting) => meeting.id === id))
        .filter((meeting): meeting is MeetingRow => !!meeting)
        .map((meeting) => `- ${meeting.title}`)
        .join('\n')
      return `## ${folder.name || 'Folder'}\n${folder.blurb || ''}\n${names || '- No meetings filed here yet.'}`
    })
    .join('\n\n')}`
}

function callTool(name: string, args: ToolArgs): string {
  const db = openDb()
  if (!db) return 'No notes database on this PC yet.'
  try {
    switch (name) {
      case 'list_meetings':
        return listMeetings(db, args)
      case 'search_notes':
        return searchNotes(db, args)
      case 'list_projects':
        return listProjects(db)
      case 'read_notes':
        return readNotes(db, args)
      case 'read_transcript':
        return readTranscript(db, args)
      default:
        return `Unknown tool: ${name}`
    }
  } finally {
    db.close()
  }
}

function handle(message: Record<string, unknown>) {
  const hasId = Object.prototype.hasOwnProperty.call(message, 'id')
  const id = (message.id ?? null) as JsonRpcId
  const method = typeof message.method === 'string' ? message.method : ''
  const params = (message.params ?? {}) as Record<string, unknown>

  if (!hasId) {
    // Notifications such as notifications/initialized need no reply.
    return
  }

  switch (method) {
    case 'initialize': {
      const requested = typeof params.protocolVersion === 'string' ? params.protocolVersion : PROTOCOL_VERSION
      reply(id, {
        protocolVersion: requested,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
        instructions:
          'Read-only access to annotated meeting notes on this PC. Search by person, topic, action, or project. No audio, no API keys, and no edits.',
      })
      return
    }
    case 'ping':
      reply(id, {})
      return
    case 'tools/list':
      reply(id, { tools: TOOLS })
      return
    case 'tools/call': {
      const name = typeof params.name === 'string' ? params.name : ''
      const args = (params.arguments ?? {}) as ToolArgs
      try {
        const text = callTool(name, args)
        reply(id, textResult(text, name === 'search_notes' && text.startsWith('Pass a query')))
      } catch (error) {
        const messageText = error instanceof Error ? error.message : 'Tool call failed.'
        reply(id, textResult(messageText, true))
      }
      return
    }
    case 'resources/list':
      reply(id, { resources: [] })
      return
    case 'prompts/list':
      reply(id, { prompts: [] })
      return
    default:
      fail(id, -32601, `Method not found: ${method}`)
  }
}

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity })

lines.on('line', (line) => {
  const trimmed = line.trim()
  if (!trimmed) return
  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        if (item && typeof item === 'object') handle(item as Record<string, unknown>)
      }
      return
    }
    if (parsed && typeof parsed === 'object') handle(parsed as Record<string, unknown>)
  } catch {
    fail(null, -32700, 'Parse error')
  }
})

process.stderr.write('annotated MCP server ready on stdio\n')
