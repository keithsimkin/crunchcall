import { publicAsset } from './publicAsset'

const PROFILE_KEY = 'crunchcall.profile'

export type McpClientId = 'claude' | 'gemini' | 'cursor' | 'chatgpt'

export type Profile = {
  name: string
  onboarded: boolean
  mcpClient: McpClientId
  mcpCopied: boolean
}

export type McpClient = {
  id: McpClientId
  name: string
  mark: string
  where: string
}

const serverConfig = `{
  "mcpServers": {
    "crunchcall": {
      "command": "crunchcalld",
      "args": ["mcp", "--stdio"]
    }
  }
}`

export const mcpClients: McpClient[] = [
  {
    id: 'claude',
    name: 'Claude',
    mark: publicAsset('logos/claude.svg'),
    where: 'Claude → Settings → Developer → Edit Config. Merge the JSON, save, and restart Claude.',
  },
  {
    id: 'gemini',
    name: 'Gemini',
    mark: publicAsset('logos/gemini.svg'),
    where: 'Gemini CLI → settings.json in your user folder (.gemini). Merge the JSON under mcpServers, then restart.',
  },
  {
    id: 'cursor',
    name: 'Cursor',
    mark: publicAsset('logos/cursor.svg'),
    where: 'Cursor → Settings → MCP → Add server. Paste the JSON.',
  },
  {
    id: 'chatgpt',
    name: 'ChatGPT',
    mark: publicAsset('logos/openai.svg'),
    where: 'Settings → Connectors → Add MCP server. Name it annotated, command crunchcalld, arguments mcp --stdio.',
  },
]

export function emptyProfile(): Profile {
  return { name: '', onboarded: false, mcpClient: 'claude', mcpCopied: false }
}

function isClient(value: unknown): value is McpClientId {
  return value === 'claude' || value === 'gemini' || value === 'cursor' || value === 'chatgpt'
}

export function readProfile(): Profile {
  const blank = emptyProfile()
  if (typeof localStorage === 'undefined') return blank
  try {
    const raw = localStorage.getItem(PROFILE_KEY)
    if (!raw) return blank
    const parsed = JSON.parse(raw) as Partial<Profile>
    return {
      name: typeof parsed.name === 'string' ? parsed.name.slice(0, 48) : '',
      onboarded: parsed.onboarded === true,
      mcpClient: isClient(parsed.mcpClient) ? parsed.mcpClient : 'claude',
      mcpCopied: parsed.mcpCopied === true,
    }
  } catch {
    return blank
  }
}

export function writeProfile(profile: Profile): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(
      PROFILE_KEY,
      JSON.stringify({
        name: profile.name.slice(0, 48),
        onboarded: profile.onboarded,
        mcpClient: profile.mcpClient,
        mcpCopied: profile.mcpCopied,
      }),
    )
  } catch {
    // The open session still has the name if the disk quota is full.
  }
}

export function profileInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return 'C'
  const first = Array.from(parts[0])[0] ?? ''
  if (parts.length === 1) return first.toUpperCase()
  const second = Array.from(parts[1])[0] ?? ''
  return `${first}${second}`.toUpperCase()
}

export function givenName(name: string): string {
  return name.trim().split(/\s+/).filter(Boolean)[0] ?? ''
}

export function mcpClientById(id: McpClientId): McpClient {
  return mcpClients.find((client) => client.id === id) ?? mcpClients[0]
}

export function mcpConfigText(client: McpClientId): { label: string; text: string } {
  if (client === 'chatgpt') {
    return {
      label: 'Copy config',
      text: 'Name: annotated\nCommand: crunchcalld\nArguments: mcp --stdio',
    }
  }
  return { label: 'Copy config', text: serverConfig }
}

export function mcpSetupPrompt(name: string, client: McpClientId): string {
  const who = name.trim() || 'the person at this PC'
  const chosen = mcpClientById(client)
  const command = `How to add it: ${chosen.where}\n\n${serverConfig}`

  return `You are helping ${who} connect annotated, a local meeting notepad on this Windows PC. Notes and audio stay on this machine. No meeting bot joins the call.

Add the annotated MCP server if it is not already connected.

${command}

The server is local and read-only. It exposes:
- list_meetings — recent calls, with status, people, and topics
- search_notes — search titles, people, topics, summaries, and next steps
- read_notes — summary, takeaways, owners, and dates for one meeting
- read_transcript — timestamped lines for one meeting
- list_projects — folders and the meetings filed in them

Use these tools for anything about the meetings. Do not invent notes, quotes, owners, or dates. There is no audio tool. If a tool is missing, say the annotated server is not connected and repeat the config above.

Then list the recent meetings and any open next steps.`
}
