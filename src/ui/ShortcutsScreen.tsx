import type { SettingsSection } from './settingsState'

type Jump = {
  label: string
  help: string
  keys: string[]
  run: () => void
}

function Chord({ keys }: { keys: string[] }) {
  return (
    <span className="key-chord" aria-label={keys.join(' + ')}>
      {keys.map((key) => (
        <kbd key={key}>{key}</kbd>
      ))}
    </span>
  )
}

function JumpCard({ title, items }: { title: string; items: Jump[] }) {
  return (
    <div className="set-card">
      <h2>{title}</h2>
      <ul className="jump-list">
        {items.map((item) => (
          <li key={item.label}>
            <button type="button" onClick={item.run}>
              <span className="jump-copy">
                <strong>{item.label}</strong>
                <span>{item.help}</span>
              </span>
              <Chord keys={item.keys} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function ShortcutsScreen({
  onHome,
  onNew,
  onLive,
  onDictate,
  onSearch,
  onCalendar,
  onProjects,
  onConnect,
  onSettings,
}: {
  onHome: () => void
  onNew: () => void
  onLive: () => void
  onDictate: () => void
  onSearch: () => void
  onCalendar: () => void
  onProjects: () => void
  onConnect: () => void
  onSettings: (section: SettingsSection) => void
}) {
  const go: Jump[] = [
    { label: 'Home', help: 'Meeting history on this PC', keys: ['Ctrl', '1'], run: onHome },
    { label: 'New meeting', help: 'Start a fresh live session', keys: ['Ctrl', 'N'], run: onNew },
    { label: 'Live', help: 'Open the live capture screen', keys: ['Ctrl', '2'], run: onLive },
    { label: 'Dictate', help: 'History and stats. Press Ctrl+Win anywhere to dictate', keys: ['Ctrl', '3'], run: onDictate },
    { label: 'Search notes', help: 'Search inside Projects by person, topic, or next step', keys: ['Ctrl', '4'], run: onSearch },
    { label: 'Calendar', help: 'What’s next, and the link that feeds it', keys: ['Ctrl', '5'], run: onCalendar },
    { label: 'Projects', help: 'The folder desk, including search', keys: ['Ctrl', '6'], run: onProjects },
    { label: 'Connect', help: 'Local MCP so other tools can read curated notes', keys: ['Ctrl', '8'], run: onConnect },
  ]

  const settings: Jump[] = [
    { label: 'Listening', help: 'Mic, speech engine, and live cues', keys: ['Ctrl', ','], run: () => onSettings('listening') },
    { label: 'Speech', help: 'Dictation and call speech models, downloads, and keys', keys: ['Ctrl', 'Shift', 'M'], run: () => onSettings('speech') },
    { label: 'Notes', help: 'Writers, coaching, downloads, and cloud keys', keys: ['Ctrl', 'Shift', 'K'], run: () => onSettings('notes') },
    { label: 'This PC', help: 'Theme, setup, restore, and local paths', keys: ['Ctrl', 'Shift', 'P'], run: () => onSettings('machine') },
  ]

  return (
    <section className="shortcuts-page" aria-labelledby="shortcuts-title">
      <div className="page-head">
        <div>
          <h1 id="shortcuts-title" className="page-title">
            Shortcuts
          </h1>
          <p className="lede">Jumps and keys inside the open window. Ctrl+Win dictates into the app that is focused.</p>
        </div>
      </div>

      <div className="shortcuts-grid">
        <JumpCard title="Go" items={go} />
        <div className="shortcuts-side">
          <JumpCard title="Settings" items={settings} />
          <div className="set-card">
            <h2>Also</h2>
            <div className="set-row">
              <div>
                <p className="set-label">This page</p>
                <p className="help">Open the shortcuts list</p>
              </div>
              <Chord keys={['Ctrl', '7']} />
            </div>
            <div className="set-row">
              <div>
                <p className="set-label">Close settings</p>
                <p className="help">While the settings dialog is open</p>
              </div>
              <Chord keys={['Esc']} />
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
