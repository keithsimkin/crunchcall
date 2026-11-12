import { useEffect, useMemo, useState } from 'react'
import { engineById, engineDefaults, speechPrivacy } from '../features/engines/catalog'
import { onDictationsChange, readDictations, wordCount } from '../features/dictate/history'
import { dictateDemoStats, listedDictations, type DictationRow } from './fixtures'
import { MoreIcon, SearchIcon, ShareIcon } from './icons'
import { TargetReel } from './TargetReel'

type DictateScreenProps = {
  speechId: string
}

const dayOrder = ['Today', 'Yesterday', 'Earlier'] as const
const previewLimit = 160
const hotkeys = ['Ctrl', 'Win']

function formatWords(count: number): string {
  return count.toLocaleString('en-US')
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

export function DictateScreen({ speechId }: DictateScreenProps) {
  const speech = engineById(speechId) ?? engineById(engineDefaults.speech)
  const [lines, setLines] = useState<DictationRow[]>(() => readDictations())
  const [query, setQuery] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => onDictationsChange(() => setLines(readDictations())), [])

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

  const fixtureWords = listedDictations.reduce((sum, row) => sum + wordCount(row.text), 0)
  const liveWords = lines.reduce((sum, row) => sum + wordCount(row.text), 0)
  const words = dictateDemoStats.words + Math.max(0, liveWords - fixtureWords)

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
            Press{' '}
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
            {dictateDemoStats.timeSavedHours}
            <em>hrs</em>
          </strong>
        </article>
        <article>
          <span>Day streak</span>
          <strong>
            {dictateDemoStats.streakDays}
            <em>days</em>
          </strong>
        </article>
        <article>
          <span>Average speed</span>
          <strong>
            {dictateDemoStats.wpm}
            <em>wpm</em>
          </strong>
        </article>
      </div>

      <div className="dictate-meta">
        <p className="privacy-line">
          {speech.name} · {speechPrivacy(speech)}. Text lands in the focused field — browsers, Cursor, T3, ChatGPT, and the rest.
        </p>
        {message ? <p className="muted">{message}</p> : null}
      </div>

      <div className="history-head">
        <h2>History</h2>
        <div className="history-tools">
          <button type="button" className="icon-btn" aria-label="History options">
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
        <p className="empty">{query ? 'No dictations match that.' : 'Press Ctrl + Win anywhere to start your history.'}</p>
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
