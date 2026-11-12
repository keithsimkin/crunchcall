/**
 * CrunchCall demo MCP server.
 *
 * Read-only access to the local demo notes. This is the shape the native
 * `crunchcalld mcp --stdio` server will take; it intentionally uses the same
 * fixture data as the app so the tools return what the UI shows.
 *
 * Run with Bun: `bun run mcp`
 * MCP transport: newline-delimited JSON-RPC over stdio.
 */

import { createInterface } from 'node:readline'
import {
  listedMeetings,
  richNotes,
  starterProjects,
  statusLabel,
  type MeetingRow,
} from '../src/ui/fixtures'
import { searchMeetings, type SearchScope } from '../src/ui/search'

type JsonRpcId = string | number | null
type ToolArgs = Record<string, unknown>

const PROTOCOL_VERSION = '2025-06-18'
const SERVER_INFO = { name: 'crunchcall-notes', version: '0.1.0' }

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

function findMeeting(value: string): MeetingRow | null {
  const needle = value.trim().toLowerCase()
  if (!needle) return null
  return (
    listedMeetings.find((meeting) => meeting.id === needle) ??
    listedMeetings.find((meeting) => meeting.title.toLowerCase() === needle) ??
    listedMeetings.find((meeting) => meeting.title.toLowerCase().includes(needle)) ??
    listedMeetings.find((meeting) => meeting.id.includes(needle)) ??
    null
  )
}

function meetingSummary(meeting: MeetingRow): string {
  const people = meeting.people.length ? meeting.people.join(', ') : 'No one named'
  const topics = meeting.topics.length ? meeting.topics.join(', ') : 'No topics'
  return `- ${meeting.title} (${meeting.id}) — ${statusLabel(meeting.status)} · ${meeting.when} · ${meeting.duration}
  With ${people} · ${topics} · ${meeting.source}
  ${meeting.preview}`
}

function notesMarkdown(meeting: MeetingRow): string {
  const notes = richNotes[meeting.id]
  const people = meeting.people.length ? meeting.people.join(', ') : 'No one named'
  const topics = meeting.topics.length ? meeting.topics.join(', ') : 'No topics'
  const head = `# ${meeting.title}

${statusLabel(meeting.status)} · ${meeting.when} · ${meeting.duration} · ${meeting.source}
With: ${people}
Topics: ${topics}

${notes ? notes.summary : meeting.preview}`

  if (!notes) return head

  const takeaways = notes.takeaways.map((item) => `- ${item}`).join('\n')
  const actions = notes.actions
    .map((action) => `- [ ] ${action.text} — ${action.owner ?? 'Unassigned'} — ${action.due ?? 'No date'}`)
    .join('\n')
  const transcript = notes.utterances
    .map((line) => `- [${line.at}] ${line.speaker}: ${line.text}`)
    .join('\n')

  return `${head}

## Takeaways

${takeaways}

## Next steps

${actions}

## Transcript

${transcript}`
}

function transcriptMarkdown(meeting: MeetingRow): string {
  const notes = richNotes[meeting.id]
  if (!notes) {
    return `# ${meeting.title}

No transcript is available for this meeting yet.

${meeting.preview}`
  }
  return `# ${meeting.title} — transcript

${notes.utterances.map((line) => `- [${line.at}] ${line.speaker}: ${line.text}`).join('\n')}`
}

function listMeetings(args: ToolArgs): string {
  const status = stringArg(args, 'status')
  const project = stringArg(args, 'project').toLowerCase()
  const query = stringArg(args, 'query').toLowerCase()
  const limit = Math.max(1, Math.min(100, numberArg(args, 'limit', 20)))

  let rows = listedMeetings
  if (status) rows = rows.filter((meeting) => meeting.status === status)
  if (project) {
    const folder = starterProjects.find(
      (item) => item.id.toLowerCase() === project || item.name.toLowerCase().includes(project),
    )
    if (folder) rows = rows.filter((meeting) => folder.meetingIds.includes(meeting.id))
    else rows = []
  }
  if (query) {
    rows = rows.filter((meeting) =>
      `${meeting.title} ${meeting.people.join(' ')} ${meeting.topics.join(' ')} ${meeting.preview}`
        .toLowerCase()
        .includes(query),
    )
  }

  const visible = rows.slice(0, limit)
  return `# Meetings (${visible.length}${rows.length > visible.length ? ` of ${rows.length}` : ''})

${visible.map(meetingSummary).join('\n\n')}`
}

function searchNotes(args: ToolArgs): string {
  const query = stringArg(args, 'query')
  if (!query) return 'Pass a query, such as a person, a topic, or a phrase.'
  const rawScope = stringArg(args, 'scope') as SearchScope
  const scope = SCOPES.includes(rawScope) ? rawScope : 'all'
  const limit = Math.max(1, Math.min(50, numberArg(args, 'limit', 10)))
  const results = searchMeetings(listedMeetings, starterProjects, query, scope).slice(0, limit)
  if (results.length === 0) return `No notes match “${query}”.`

  return `# ${results.length} note${results.length === 1 ? '' : 's'} match “${query}”

${results
  .map(({ meeting, project, hits }) => {
    const folder = project ? ` · ${project.name}` : ''
    const matches = hits.map((hit) => `  - ${hit.label}: ${hit.text}`).join('\n')
    return `## ${meeting.title} (${meeting.id})
${statusLabel(meeting.status)} · ${meeting.when} · ${meeting.duration}${folder}
${matches}`
  })
  .join('\n\n')}`
}

function listProjects(): string {
  return `# Projects

${starterProjects
  .map((folder) => {
    const meetings = folder.meetingIds
      .map((id) => listedMeetings.find((meeting) => meeting.id === id))
      .filter((meeting): meeting is MeetingRow => !!meeting)
    const names = meetings.map((meeting) => `  - ${meeting.title}`).join('\n')
    return `## ${folder.name} (${folder.id})
${folder.blurb}
${meetings.length} note${meetings.length === 1 ? '' : 's'}${names ? `\n${names}` : ''}`
  })
  .join('\n\n')}`
}

function callTool(name: string, args: ToolArgs): string {
  switch (name) {
    case 'list_meetings':
      return listMeetings(args)
    case 'search_notes':
      return searchNotes(args)
    case 'list_projects':
      return listProjects()
    case 'read_notes': {
      const meeting = findMeeting(stringArg(args, 'meetingId'))
      return meeting ? notesMarkdown(meeting) : 'No meeting matched that id or title.'
    }
    case 'read_transcript': {
      const meeting = findMeeting(stringArg(args, 'meetingId'))
      return meeting ? transcriptMarkdown(meeting) : 'No meeting matched that id or title.'
    }
    default:
      return `Unknown tool: ${name}`
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
          'Read-only access to CrunchCall meeting notes on this PC. Search by person, topic, action, or project. No audio, no API keys, and no edits.',
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

process.stderr.write('CrunchCall MCP server ready on stdio\n')
