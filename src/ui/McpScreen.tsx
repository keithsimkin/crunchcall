import { useEffect, useState } from 'react'
import { readMcpPolicy, saveMcpPolicy } from '../features/desk/store'
import { PlugIcon, SparkIcon } from './icons'
import { publicAsset } from './publicAsset'

type ClientId = 'claude' | 'gemini' | 'cursor' | 'chatgpt' | 'any'

type Client = {
  id: ClientId
  name: string
  mark: string
  status: 'Connected' | 'Ready'
  detail: string
  setup: string
  language: 'json' | 'shell' | 'text'
  config: string
}

const serverConfig = `{
  "mcpServers": {
    "crunchcall": {
      "command": "crunchcalld",
      "args": ["mcp", "--stdio"]
    }
  }
}`

const clients: Client[] = [
  {
    id: 'claude',
    name: 'Claude Desktop',
    mark: publicAsset('logos/claude.svg'),
    status: 'Ready',
    detail: 'Points at the notes database on this PC.',
    setup: 'Claude → Settings → Developer → Edit Config',
    language: 'json',
    config: serverConfig,
  },
  {
    id: 'gemini',
    name: 'Gemini',
    mark: publicAsset('logos/gemini.svg'),
    status: 'Ready',
    detail: 'Add the same local server in Gemini CLI.',
    setup: 'settings.json in your user folder (.gemini) → mcpServers',
    language: 'json',
    config: serverConfig,
  },
  {
    id: 'cursor',
    name: 'Cursor',
    mark: publicAsset('logos/cursor.svg'),
    status: 'Ready',
    detail: 'Add the server to Cursor’s MCP settings.',
    setup: 'Cursor → Settings → MCP → Add server',
    language: 'json',
    config: serverConfig,
  },
  {
    id: 'chatgpt',
    name: 'ChatGPT Desktop',
    mark: publicAsset('logos/openai.svg'),
    status: 'Ready',
    detail: 'Connect the local server as a developer tool.',
    setup: 'Settings → Connectors → Add MCP server',
    language: 'text',
    config: 'Name: annotated\nCommand: crunchcalld\nArguments: mcp --stdio',
  },
  {
    id: 'any',
    name: 'Any MCP client',
    mark: '',
    status: 'Ready',
    detail: 'Anything that speaks MCP over stdio can read the notes.',
    setup: 'Point the client at the local stdio command',
    language: 'json',
    config: serverConfig,
  },
]

const tools = [
  {
    name: 'list_meetings',
    args: 'status? · project? · limit?',
    help: 'Recent calls with status, people, topics, and source.',
  },
  {
    name: 'search_notes',
    args: 'query · scope?',
    help: 'Search titles, people, topics, summaries, next steps, and transcript lines.',
  },
  {
    name: 'read_notes',
    args: 'meetingId',
    help: 'The summary, takeaways, owners, dates, and Markdown for one meeting.',
  },
  {
    name: 'read_transcript',
    args: 'meetingId',
    help: 'Timestamped utterances, with speaker and whether it was you.',
  },
  {
    name: 'list_projects',
    args: '—',
    help: 'Folders on the desk and the meetings filed inside them.',
  },
]

const prompts = [
  'Which notes mention Maya this month?',
  'What did we promise Northwind?',
  'Summarize every open next step across Lumen.',
  'Who did I talk to about pricing?',
]

const activity = [
  {
    client: 'Claude Desktop',
    action: 'Searched notes for “Maya”',
    result: '3 notes · 7 matches',
    at: '2 min ago',
  },
  {
    client: 'Cursor',
    action: 'Read “Pricing review with Northwind”',
    result: 'Summary + 5 transcript excerpts',
    at: '18 min ago',
  },
  {
    client: 'Claude Desktop',
    action: 'Listed projects',
    result: '6 folders · 11 meetings',
    at: 'Yesterday',
  },
]

function CopyButton({
  text,
  label,
  copied,
  onCopy,
}: {
  text: string
  label: string
  copied: boolean
  onCopy: (text: string) => void
}) {
  return (
    <button type="button" className="btn ghost small" onClick={() => onCopy(text)}>
      {copied ? 'Copied' : label}
    </button>
  )
}

function Toggle({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={on ? 'switch on' : 'switch'}
      onClick={onClick}
    >
      <span />
    </button>
  )
}

export function McpScreen() {
  const [enabled, setEnabled] = useState(true)
  const [activeId, setActiveId] = useState<ClientId>('claude')
  const [transcripts, setTranscripts] = useState(true)
  const [actions, setActions] = useState(true)
  const [ready, setReady] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const active = clients.find((client) => client.id === activeId) ?? clients[0]

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(null), 1600)
    return () => window.clearTimeout(timer)
  }, [copied])

  useEffect(() => {
    let cancelled = false
    void readMcpPolicy().then((policy) => {
      if (cancelled) return
      setEnabled(policy.enabled)
      setTranscripts(policy.transcripts)
      setActions(policy.actions)
      setReady(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!ready) return
    void saveMcpPolicy({ enabled, transcripts, actions })
  }, [enabled, transcripts, actions, ready])

  async function copy(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(key)
    } catch {
      setCopied(null)
    }
  }

  return (
    <section className={enabled ? 'connect-page' : 'connect-page is-off'} aria-labelledby="connect-title">
      <div className="page-head">
        <div>
          <h1 id="connect-title" className="page-title">
            Connect
          </h1>
          <p className="lede">
            Let Claude, Cursor, ChatGPT, and other MCP clients read the notes you already have. Local only, and
            read-only.
          </p>
        </div>
        <span className="mcp-badge">
          <PlugIcon />
          MCP
        </span>
      </div>

      <div className="mcp-status">
        <div className="mcp-status-main">
          <span className={enabled ? 'mcp-dot on' : 'mcp-dot'} aria-hidden="true" />
          <div>
            <p className="mcp-kicker">Local MCP server</p>
            <strong>{enabled ? 'On this PC and listening' : 'Connections are paused'}</strong>
            <p className="muted">
              Reads the notes database on this PC. No cloud hop and no audio. Turn it off and every client loses access.
            </p>
          </div>
        </div>
        <div className="mcp-status-side">
          <span className="mcp-stat">
            <strong>{tools.length}</strong>
            <span>tools</span>
          </span>
          <span className="mcp-stat">
            <strong>0</strong>
            <span>cloud calls</span>
          </span>
          <div className="mcp-switch">
            <span>Allow connections</span>
            <Toggle on={enabled} label="Allow MCP connections" onClick={() => setEnabled((value) => !value)} />
          </div>
        </div>
      </div>

      <div className="mcp-grid">
        <section className="mcp-panel" aria-labelledby="mcp-clients-title">
          <div className="panel-h">
            <h2 id="mcp-clients-title">Connect a client</h2>
            <span className="muted">Same local server</span>
          </div>
          <div className="client-tabs" role="tablist" aria-label="MCP clients">
            {clients.map((client) => (
              <button
                key={client.id}
                type="button"
                role="tab"
                aria-selected={activeId === client.id}
                className={activeId === client.id ? 'client-tab on' : 'client-tab'}
                onClick={() => setActiveId(client.id)}
              >
                {client.mark ? (
                  <img className={client.id === 'cursor' ? 'is-cursor' : undefined} src={client.mark} alt="" />
                ) : (
                  <span className="client-mark">{client.name.charAt(0)}</span>
                )}
                {client.name}
              </button>
            ))}
          </div>

          <div className="client-detail">
            <div className="client-detail-head">
              <div>
                <p className="client-name">
                  {active.name}
                  <span className={active.status === 'Connected' ? 'pill pill-ready' : 'pill'}>{active.status}</span>
                </p>
                <p className="help">{active.detail}</p>
              </div>
              <CopyButton
                text={active.config}
                label="Copy config"
                copied={copied === `config-${active.id}`}
                onCopy={(text) => void copy(text, `config-${active.id}`)}
              />
            </div>
            <p className="client-setup">{active.setup}</p>
            <pre className={`code-block language-${active.language}`}>
              <code>{active.config}</code>
            </pre>
          </div>

          <p className="mcp-note">
            Clients run <code>crunchcalld mcp --stdio</code>. That command reads the same notes database as this app.
          </p>
        </section>

        <aside className="mcp-panel" aria-labelledby="mcp-prompts-title">
          <div className="panel-h">
            <h2 id="mcp-prompts-title">Try asking</h2>
            <SparkIcon />
          </div>
          <p className="mcp-panel-lede">Once a client is connected, the notes become another tool in its hands.</p>
          <ul className="prompt-list">
            {prompts.map((prompt, index) => (
              <li key={prompt}>
                <p>{prompt}</p>
                <CopyButton
                  text={prompt}
                  label="Copy"
                  copied={copied === `prompt-${index}`}
                  onCopy={(text) => void copy(text, `prompt-${index}`)}
                />
              </li>
            ))}
          </ul>
        </aside>
      </div>

      <section className="mcp-panel" aria-labelledby="mcp-tools-title">
        <div className="panel-h">
          <h2 id="mcp-tools-title">What the server exposes</h2>
          <span className="muted">Read-only by default</span>
        </div>
        <ul className="tool-list">
          {tools.map((tool) => (
            <li key={tool.name}>
              <code>{tool.name}</code>
              <span className="tool-args">{tool.args}</span>
              <p>{tool.help}</p>
            </li>
          ))}
        </ul>
      </section>

      <div className="mcp-grid mcp-grid-bottom">
        <section className="mcp-panel" aria-labelledby="mcp-privacy-title">
          <div className="panel-h">
            <h2 id="mcp-privacy-title">Privacy controls</h2>
            <span className="muted">On this PC</span>
          </div>
          <div className="mcp-setting">
            <div>
              <p className="set-label">Transcript excerpts</p>
              <p className="help">Let clients read timestamped lines, not just the curated notes.</p>
            </div>
            <Toggle on={transcripts} label="Share transcript excerpts" onClick={() => setTranscripts((value) => !value)} />
          </div>
          <div className="mcp-setting">
            <div>
              <p className="set-label">Action items and owners</p>
              <p className="help">Include next steps, owners, and dates in search and read results.</p>
            </div>
            <Toggle on={actions} label="Share action items" onClick={() => setActions((value) => !value)} />
          </div>
          <ul className="mcp-private-list">
            <li>No raw audio is exposed.</li>
            <li>No API keys or credentials are exposed.</li>
            <li>Connected apps can read, but cannot edit or delete notes.</li>
          </ul>
        </section>

        <section className="mcp-panel" aria-labelledby="mcp-activity-title">
          <div className="panel-h">
            <h2 id="mcp-activity-title">Recent activity</h2>
            <span className="muted">This PC</span>
          </div>
          <ul className="activity-list">
            {activity.map((item) => (
              <li key={`${item.client}-${item.at}`}>
                <span className="activity-dot" aria-hidden="true" />
                <div>
                  <p>
                    <strong>{item.client}</strong> {item.action}
                  </p>
                  <p className="muted">
                    {item.result}
                    <span aria-hidden="true"> · </span>
                    {item.at}
                  </p>
                </div>
              </li>
            ))}
          </ul>
          <p className="mcp-note">
            Activity is local, too. annotated keeps the request log so you can see which app read what.
          </p>
        </section>
      </div>
    </section>
  )
}
