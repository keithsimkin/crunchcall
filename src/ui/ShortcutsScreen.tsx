import { useEffect, useRef, useState } from 'react'
import type { SettingsHandlers, SettingsSection } from './settingsState'
import {
  chordFromEvent,
  chordLabels,
  dictateModeOptions,
  findShortcutConflict,
  formatChord,
  shortcutCatalog,
  shortcutLabel,
  type ShortcutId,
} from './shortcuts'

function Chord({ keys, armed }: { keys: string[]; armed?: boolean }) {
  return (
    <span className={armed ? 'key-chord recording' : 'key-chord'} aria-label={keys.join(' + ')}>
      {keys.map((key) => (
        <kbd key={key}>{key}</kbd>
      ))}
    </span>
  )
}

export function ShortcutsScreen({
  settings,
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
  settings: SettingsHandlers
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
  const { shortcuts, setShortcut, resetShortcuts, dictateMode, setDictateMode } = settings
  const [recording, setRecording] = useState<ShortcutId | null>(null)
  const [message, setMessage] = useState('')
  const recordingRef = useRef<ShortcutId | null>(null)

  useEffect(() => {
    recordingRef.current = recording
  }, [recording])

  const runs: Partial<Record<ShortcutId, () => void>> = {
    'nav.home': onHome,
    'meeting.new': onNew,
    'nav.live': onLive,
    'nav.dictate': onDictate,
    'nav.search': onSearch,
    'nav.calendar': onCalendar,
    'nav.projects': onProjects,
    'nav.shortcuts': () => undefined,
    'nav.connect': onConnect,
    'settings.listening': () => onSettings('listening'),
    'settings.speech': () => onSettings('speech'),
    'settings.notes': () => onSettings('notes'),
    'settings.machine': () => onSettings('machine'),
  }

  useEffect(() => {
    if (!recording) return

    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        setRecording(null)
        setMessage('')
        return
      }
      const chord = chordFromEvent(event)
      if (!chord) return
      event.preventDefault()
      event.stopPropagation()
      const id = recordingRef.current
      if (!id) return
      const conflict = findShortcutConflict(shortcuts, id, chord)
      if (conflict) {
        setMessage(`${formatChord(chord)} is already used by ${shortcutLabel(conflict)}.`)
        return
      }
      setShortcut(id, chord)
      setRecording(null)
      setMessage(`Saved ${shortcutLabel(id)} as ${formatChord(chord)}.`)
    }

    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [recording, setShortcut, shortcuts])

  function renderGroup(title: string, group: 'go' | 'settings' | 'dictate') {
    const items = shortcutCatalog.filter((item) => item.group === group)
    return (
      <div className="set-card">
        <h2>{title}</h2>
        <ul className="jump-list shortcut-edit-list">
          {items.map((item) => {
            const chord = shortcuts[item.id]
            const armed = recording === item.id
            const run = runs[item.id]
            return (
              <li key={item.id}>
                <div className="shortcut-row">
                  <button
                    type="button"
                    className="shortcut-run"
                    onClick={() => run?.()}
                    disabled={!run || item.id === 'nav.shortcuts' || item.id === 'dictate.global'}
                  >
                    <span className="jump-copy">
                      <strong>{item.label}</strong>
                      <span>{item.help}</span>
                    </span>
                  </button>
                  <div className="shortcut-keys">
                    <Chord keys={armed ? ['Press keys…'] : chordLabels(chord)} armed={armed} />
                    <button
                      type="button"
                      className={armed ? 'btn small primary' : 'btn small ghost'}
                      onClick={() => {
                        setMessage(armed ? '' : 'Press the new shortcut. Esc cancels.')
                        setRecording(armed ? null : item.id)
                      }}
                    >
                      {armed ? 'Cancel' : 'Change'}
                    </button>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      </div>
    )
  }

  return (
    <section className="shortcuts-page" aria-labelledby="shortcuts-title">
      <div className="page-head">
        <div>
          <h1 id="shortcuts-title" className="page-title">
            Shortcuts
          </h1>
          <p className="lede">
            Change the keys, and how system-wide dictation works. Clicks still run the action when a row supports it.
          </p>
        </div>
        <button
          type="button"
          className="btn ghost small"
          onClick={() => {
            resetShortcuts()
            setRecording(null)
            setMessage('Restored default shortcuts.')
          }}
        >
          Restore defaults
        </button>
      </div>

      {message ? (
        <p className="shortcut-toast" role="status">
          {message}
        </p>
      ) : null}

      <div className="shortcuts-grid">
        {renderGroup('Go', 'go')}
        {renderGroup('Settings', 'settings')}
        <div className="set-card">
          <h2>Dictate</h2>
          <div className="set-row">
            <div>
              <p className="set-label">How it works</p>
              <p className="help">
                {dictateMode === 'hold'
                  ? 'Hold the keys to talk; release to insert. System-wide starts on press and stops when you release (bar focused) or press again.'
                  : 'Press once to start, press again to insert. Works while annotated is in the tray.'}
              </p>
            </div>
            <div className="seg" role="radiogroup" aria-label="Dictate mode">
              {dictateModeOptions.map(([id, name]) => (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={dictateMode === id}
                  className={dictateMode === id ? 'on' : ''}
                  onClick={() => setDictateMode(id)}
                >
                  {name}
                </button>
              ))}
            </div>
          </div>
          <ul className="jump-list shortcut-edit-list">
            {shortcutCatalog
              .filter((item) => item.group === 'dictate')
              .map((item) => {
                const chord = shortcuts[item.id]
                const armed = recording === item.id
                return (
                  <li key={item.id}>
                    <div className="shortcut-row">
                      <div className="jump-copy">
                        <strong>{item.label}</strong>
                        <span>{item.help}</span>
                      </div>
                      <div className="shortcut-keys">
                        <Chord keys={armed ? ['Press keys…'] : chordLabels(chord)} armed={armed} />
                        <button
                          type="button"
                          className={armed ? 'btn small primary' : 'btn small ghost'}
                          onClick={() => {
                            setMessage(armed ? '' : 'Press the new shortcut. Esc cancels.')
                            setRecording(armed ? null : item.id)
                          }}
                        >
                          {armed ? 'Cancel' : 'Change'}
                        </button>
                      </div>
                    </div>
                  </li>
                )
              })}
          </ul>
          <div className="set-row">
            <div>
              <p className="set-label">Close settings</p>
              <p className="help">While the settings dialog is open</p>
            </div>
            <Chord keys={['Esc']} />
          </div>
        </div>
      </div>
    </section>
  )
}
