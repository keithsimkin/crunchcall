import { useMemo, useState } from 'react'
import type { CalendarEvent } from '../features/calendar/ics'
import { duePhrase, formatWhen } from '../features/calendar/format'
import { AppReel } from './AppReel'
import { statusLabel, type MeetingRow } from './fixtures'
import { CalendarIcon, PlusIcon, SearchIcon } from './icons'

type MeetingsScreenProps = {
  rows: MeetingRow[]
  onOpen: (id: string) => void
  onRemove: (id: string) => void
  onNew: () => void
  calendarOn: boolean
  calendarError: string | null
  calendarEmpty: string
  upcoming: CalendarEvent[]
  due: CalendarEvent | null
  now: number
  onStartCalendar: (event: CalendarEvent) => void
  onDismissCalendar: (instanceKey: string) => void
  onOpenCalendar: () => void
}

export function StartAsk({
  event,
  now,
  onStart,
  onDismiss,
}: {
  event: CalendarEvent
  now: number
  onStart: () => void
  onDismiss: () => void
}) {
  return (
    <div className="start-ask" role="status">
      <div>
        <p className="start-kicker">{duePhrase(event.start, now)}</p>
        <strong>{event.title}</strong>
        <p>{event.detail ? `${event.detail}. ` : ''}Turn annotated on for this meeting?</p>
      </div>
      <div className="head-actions">
        <button type="button" className="btn ghost" onClick={onDismiss}>
          Not now
        </button>
        <button type="button" className="btn primary" onClick={onStart}>
          Turn on
        </button>
      </div>
    </div>
  )
}

const HOME_UPCOMING = 3

function whenParts(start: number, end: number, allDay: boolean, now: number): { day: string; time: string } {
  const full = formatWhen(start, end, allDay, now)
  if (full === 'Now') return { day: 'Now', time: '' }
  if (allDay) return { day: full, time: 'All day' }
  const split = full.split(' · ')
  if (split.length === 2) return { day: split[0], time: split[1] }
  return { day: 'Today', time: full }
}

function Upcoming({
  events,
  due,
  now,
  error,
  empty,
  onStart,
  onDismiss,
  onOpenCalendar,
}: {
  events: CalendarEvent[]
  due: CalendarEvent | null
  now: number
  error: string | null
  empty: string
  onStart: (event: CalendarEvent) => void
  onDismiss: (instanceKey: string) => void
  onOpenCalendar: () => void
}) {
  const next = events[0]
  const shown = events.slice(0, HOME_UPCOMING)
  const more = events.length - shown.length
  return (
    <section className="up-next" aria-labelledby="upcoming-title">
      {due ? <StartAsk event={due} now={now} onStart={() => onStart(due)} onDismiss={() => onDismiss(due.instanceKey)} /> : null}
      <div className="up-next-card">
        <div className="up-next-head">
          <div className="up-next-lead">
            <span className="up-next-icon" aria-hidden="true">
              <CalendarIcon />
            </span>
            <div className="up-next-heading">
              <h2 id="upcoming-title">Up next</h2>
              <p className="up-next-sub">
                {events.length === 0
                  ? 'From your calendar'
                  : `${events.length} ${events.length === 1 ? 'meeting' : 'meetings'} coming up`}
              </p>
            </div>
          </div>
          <button type="button" className="up-next-link" onClick={onOpenCalendar}>
            <CalendarIcon />
            View calendar
            {more > 0 ? <span className="up-next-more">+{more}</span> : null}
          </button>
        </div>
        {error ? <p className="empty up-next-empty cal-error">{error}</p> : null}
        {!error && events.length === 0 ? <p className="empty up-next-empty">{empty}</p> : null}
        {shown.length > 0 ? (
          <ul className="up-next-grid">
            {shown.map((event) => {
              const when = whenParts(event.start, event.end, event.allDay, now)
              const isNext = next?.instanceKey === event.instanceKey
              return (
                <li key={event.instanceKey} className={isNext ? 'up-tile is-next' : 'up-tile'}>
                  <div className="up-tile-top">
                    <span className="up-tile-when">
                      <span className="up-tile-day">{when.day}</span>
                      {when.time ? <span className="up-tile-time">{when.time}</span> : null}
                    </span>
                    {isNext && due?.instanceKey !== event.instanceKey ? (
                      <button type="button" className="up-tile-turn" onClick={() => onStart(event)}>
                        Turn on
                      </button>
                    ) : null}
                  </div>
                  <p className="up-tile-title" title={event.title}>
                    {event.title}
                  </p>
                  {event.detail ? (
                    <p className="up-tile-detail" title={event.detail}>
                      {event.detail}
                    </p>
                  ) : null}
                </li>
              )
            })}
          </ul>
        ) : null}
      </div>
    </section>
  )
}

function minutesOf(duration: string): number {
  if (duration.endsWith('min')) return Number.parseInt(duration, 10) || 0
  const [mins] = duration.split(':')
  return Number(mins) || 0
}

const dayOrder = ['Today', 'Yesterday', 'Earlier'] as const

export function MeetingsScreen({
  rows,
  onOpen,
  onNew,
  calendarOn,
  calendarError,
  calendarEmpty,
  upcoming,
  due,
  now,
  onStartCalendar,
  onDismissCalendar,
  onOpenCalendar,
}: MeetingsScreenProps) {
  const [query, setQuery] = useState('')
  const ready = rows.filter((row) => row.status === 'ready').length
  const live = rows.filter((row) => row.status === 'live').length
  const captured = rows.reduce((sum, row) => sum + minutesOf(row.duration), 0)
  const capturedLabel = captured >= 60 ? `${Math.round(captured / 60)} hrs` : `${captured} min`

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((row) =>
      [
        row.title,
        row.preview,
        row.source,
        row.people.join(' '),
        row.topics.join(' '),
      ]
        .join(' ')
        .toLowerCase()
        .includes(q),
    )
  }, [query, rows])

  const groups = dayOrder
    .map((day) => ({ day, items: visible.filter((row) => row.day === day) }))
    .filter((group) => group.items.length > 0)

  return (
    <section aria-labelledby="home-title">
      <div className="hint-bar">
        <div className="hint-lead">
          <p id="home-title">
            Notes stay <kbd>on this PC</kbd>
          </p>
          <AppReel />
          <span className="hint-aside">No bot joins the call.</span>
        </div>
        <button type="button" className="btn primary" onClick={onNew}>
          <PlusIcon />
          New meeting
        </button>
      </div>

      {calendarOn ? (
        <Upcoming
          events={upcoming}
          due={due}
          now={now}
          error={calendarError}
          empty={calendarEmpty}
          onStart={onStartCalendar}
          onDismiss={onDismissCalendar}
          onOpenCalendar={onOpenCalendar}
        />
      ) : null}

      <div className="stat-strip">
        <article>
          <span>Meetings</span>
          <strong>
            {rows.length}
            <em>on this PC</em>
          </strong>
        </article>
        <article>
          <span>Ready notes</span>
          <strong>
            {ready}
            <em>{ready === 1 ? 'note' : 'notes'}</em>
          </strong>
        </article>
        <article>
          <span>Captured</span>
          <strong>{capturedLabel}</strong>
        </article>
        <article>
          <span>Live now</span>
          <strong>
            {live}
            <em>{live === 1 ? 'call' : 'calls'}</em>
          </strong>
        </article>
      </div>

      <div className="history-head">
        <h2>History</h2>
        <label className="search">
          <SearchIcon />
          <span className="sr">Search meetings</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search…"
            autoComplete="off"
          />
        </label>
      </div>

      {groups.length === 0 ? (
        <p className="empty">{query ? 'No meetings match that.' : 'No meetings yet. Start one and the notes stay on this PC.'}</p>
      ) : (
        groups.map((group) => (
          <section key={group.day} className="day-block">
            <h3>{group.day}</h3>
            <ul className="history">
              {group.items.map((meeting) => (
                <li key={meeting.id}>
                  <time>{meeting.when.replace(/^Today · /, '')}</time>
                  <button type="button" className="hist" onClick={() => onOpen(meeting.id)}>
                    <strong>{meeting.title}</strong>
                    <span>{meeting.preview}</span>
                    <span className="hist-meta">
                      {meeting.people.join(', ') || 'No one named'}
                      {meeting.topics.length ? ` · ${meeting.topics.slice(0, 2).join(' · ')}` : ''}
                    </span>
                  </button>
                  <span className={`pill pill-${meeting.status}`}>{statusLabel(meeting.status)}</span>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </section>
  )
}
