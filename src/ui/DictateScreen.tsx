import { useEffect, useMemo, useState } from 'react'
import { engineById, engineDefaults, speechPrivacy } from '../features/engines/catalog'
import { loadDictationRows, onDictationsChange, wordCount } from '../features/dictate/history'
import { callEngine } from '../features/engines/call'
import type { DictationRow } from './fixtures'
import { MoreIcon, SearchIcon, ShareIcon } from './icons'
import { chordLabels, defaultShortcutBindings, formatChord, type DictateMode, type ShortcutChord } from './shortcuts'
import { TargetReel } from './TargetReel'

type DictateScreenProps = {
  speechId: string
  chord?: ShortcutChord
  mode?: DictateMode
}

const dayOrder = ['Today', 'Yesterday', 'Earlier'] as const
const previewLimit = 160

function formatWords(count: number): string {
  return count.toLocaleString('en-US')
}

function dictationStats(rows: DictationRow[], words: number): { hours: string; streak: number } {
  const savedMinutes = Math.max(0, words / 40 - words / 150)
  const hours = savedMinutes < 6 ? savedMinutes / 60 : savedMinutes / 60
  const days = new Set(
    rows.map((row) => {
      const ms = row.createdAt ?? Date.now()
      const date = new Date(ms)
      return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
    }),
  )
  let streak = 0
  const cursor = new Date()
  cursor.setHours(0, 0, 0, 0)
  while (days.has(`${cursor.getFullYear()}-${cursor.getMonth()}-${cursor.getDate()}`)) {
    streak += 1
    cursor.setDate(cursor.getDate() - 1)
  }
  return { hours: (hours >= 10 ? hours.toFixed(0) : hours.toFixed(1)), streak }
}

function HistoryEntry({ row }: { row: DictationRow }) {
  const long = row.text.length > previewLimit
  const [open, setOpen] = useState(false)
  const shown = !long || open ? row.text : `${row.text.slice(0, previewLimit).trimEnd()}…`

  return (
    <li>
      <time dateTime={row.at}>{row.at}</time>
      <div className="dictate-entry">
        <p>{shown}</p>
        {long ? (
          <button type="button" className="show-more" onClick={() => setOpen((value) => !value)}>
            {open ? 'Show less' : 'Show more'}
          </button>
        ) : null}
      </div>
    </li>
  )
}

export function DictateScreen({
  speechId,
  chord = defaultShortcutBindings['dictate.global'],
  mode = 'toggle',
}: DictateScreenProps) {
  const speech = engineById(speechId) ?? engineById(engineDefaults.speech)
  const hotkeys = chordLabels(chord)
  const how = mode === 'hold' ? 'Hold' : 'Press'
  const [lines, setLines] = useState<DictationRow[]>([])
  const [query, setQuery] = useState('')
  const [message, setMessage] = useState('')
  const [pasted, setPasted] = useState('')

  useEffect(() => {
    let cancelled = false
    const reload = () => {
      void loadDictationRows().then((rows) => {
        if (!cancelled) setLines(rows)
      })
    }
    reload()
    const stop = onDictationsChange(reload)
    return () => {
      cancelled = true
      stop()
    }
  }, [])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return lines
    return lines.filter((line) => line.text.toLowerCase().includes(needle))
  }, [lines, query])

  const groups = useMemo(() => {
    return dayOrder
      .map((day) => ({ day, items: filtered.filter((line) => line.day === day) }))
      .filter((group) => group.items.length > 0)
  }, [filtered])

  if (!speech) return null

  const words = lines.reduce((sum, row) => sum + wordCount(row.text), 0)
  const stats = dictationStats(lines, words)

  async function shareLatest() {
    const latest = lines[0]?.text
    if (!latest) return
    try {
      await navigator.clipboard.writeText(latest)
      setMessage('Copied latest dictation.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not copy.')
    }
  }

  return (
    <section className="dictate-page" aria-labelledby="dictate-title">
      <div className="hint-bar">
        <div className="hint-lead">
          <p id="dictate-title">
            {how}{' '}
            {hotkeys.map((key) => (
              <kbd key={key}>{key}</kbd>
            ))}{' '}
            to dictate anywhere
          </p>
          <TargetReel />
        </div>
        <button type="button" className="icon-btn" aria-label="Copy latest dictation" onClick={() => void shareLatest()}>
          <ShareIcon />
        </button>
      </div>

      <div className="stat-strip">
        <article>
          <span>Dictated words</span>
          <strong>
            {formatWords(words)}
            <em>words</em>
          </strong>
        </article>
        <article>
          <span>Time saved</span>
          <strong>
            {stats.hours}
            <em>hrs</em>
          </strong>
        </article>
        <article>
          <span>Day streak</span>
          <strong>
            {stats.streak}
            <em>days</em>
          </strong>
        </article>
        <article>
          <span>Sessions</span>
          <strong>
            {lines.length}
            <em>{lines.length === 1 ? 'note' : 'notes'}</em>
          </strong>
        </article>
      </div>

      <div className="dictate-meta">
        <p className="privacy-line">
          {speech.name} · {speechPrivacy(speech)}. Text lands in the focused field — browsers, Cursor, T3, ChatGPT, and the rest.
        </p>
        {message ? <p className="muted">{message}</p> : null}
      </div>

      {speech.where === 'external' ? (
        <form
          className="composer"
          onSubmit={(event) => {
            event.preventDefault()
            const text = pasted.trim()
            if (!text) return
            void callEngine('dictate.commit', { text, moduleId: speech.id }).then((result) => {
              setMessage(result.ok ? 'Saved.' : result.message)
              if (result.ok) {
                setPasted('')
                void loadDictationRows().then(setLines)
              }
            })
          }}
        >
          <label className="sr" htmlFor="dictate-paste">
            Paste dictation
          </label>
          <input
            id="dictate-paste"
            value={pasted}
            onChange={(event) => setPasted(event.target.value)}
            placeholder={`Paste what you dictated in ${speech.name}`}
            autoComplete="off"
          />
          <button type="submit" className="btn primary small">
            Save
          </button>
        </form>
      ) : null}

      <div className="history-head">
        <h2>History</h2>
        <div className="history-tools">
          <button
            type="button"
            className="icon-btn"
            aria-label="Copy all dictations"
            onClick={() => void navigator.clipboard.writeText(lines.map((row) => row.text).join('\n\n')).then(() => setMessage('Copied history.'))}
          >
            <MoreIcon />
          </button>
          <label className="search">
            <SearchIcon />
            <span className="sr">Search dictations</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search…"
              autoComplete="off"
            />
          </label>
        </div>
      </div>

      {groups.length === 0 ? (
        <p className="empty">
          {query ? 'No dictations match that.' : `${how} ${formatChord(chord)} anywhere to start your history.`}
        </p>
      ) : (
        groups.map((group) => (
          <section key={group.day} className="day-block">
            <h3>{group.day}</h3>
            <ul className="history dictate-history">
              {group.items.map((row) => (
                <HistoryEntry key={row.id} row={row} />
              ))}
            </ul>
          </section>
        ))
      )}
    </section>
  )
}
