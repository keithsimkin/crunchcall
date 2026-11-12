import { useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import type { CalendarEvent } from '../features/calendar/ics'
import { formatSynced, formatWhen } from '../features/calendar/format'
import { connectUrl, importCalendarText, setAskToStart, setCalendarError, setEnabled } from '../features/calendar/store'
import { useCalendarClock } from './useCalendar'

export function CalendarScreen({ onStart }: { onStart: (event: CalendarEvent) => void }) {
  const { calendar, upcoming, now } = useCalendarClock()
  const savedUrl = calendar.source?.kind === 'url' ? calendar.source.url : ''
  const [url, setUrl] = useState(savedUrl)
  const [seenUrl, setSeenUrl] = useState(savedUrl)
  const [syncing, setSyncing] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const desktop = typeof window !== 'undefined' && !!window.crunchcall
  const next = upcoming[0]

  if (savedUrl !== seenUrl) {
    setSeenUrl(savedUrl)
    setUrl(savedUrl)
  }

  async function syncLink() {
    setSyncing(true)
    try {
      await connectUrl(url)
    } finally {
      setSyncing(false)
    }
  }

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (file.size > 5_000_000) {
      setCalendarError('That file is too large to import.')
      return
    }
    importCalendarText(file.name, await file.text())
  }

  return (
    <section className="calendar-page" aria-labelledby="calendar-title">
      <div className="page-head">
        <div>
          <h1 id="calendar-title" className="page-title">
            Calendar
          </h1>
          <p className="lede">Know what’s next. CrunchCall never joins the meeting.</p>
        </div>
      </div>

      <div className="set-card">
        <h2>Up next</h2>
        {calendar.error ? <p className="empty cal-error">{calendar.error}</p> : null}
        {!calendar.error && !calendar.enabled ? <p className="empty">Sync is off.</p> : null}
        {!calendar.error && calendar.enabled && upcoming.length === 0 ? (
          <p className="empty">
            {calendar.source ? 'Nothing coming up in the next two weeks.' : 'Add a calendar link to see meetings here.'}
          </p>
        ) : null}
        {upcoming.length > 0 ? (
          <ul className="history upcoming">
            {upcoming.map((event) => (
              <li key={event.instanceKey}>
                <time>{formatWhen(event.start, event.end, event.allDay, now)}</time>
                <div className="hist">
                  <strong>{event.title}</strong>
                  <span>{event.detail ?? 'On your calendar'}</span>
                </div>
                <button type="button" className="btn small ghost" onClick={() => onStart(event)}>
                  Turn on
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="set-card">
        <h2>Sync</h2>
        <Row title="Sync calendar" help="Keep the next two weeks of meetings on this PC.">
          <Switch on={calendar.enabled} label="Sync calendar" onClick={() => setEnabled(!calendar.enabled)} />
        </Row>
        <Row title="Ask to turn on" help="When a meeting starts, ask with a notification and a prompt in the app.">
          <Switch on={calendar.askToStart} label="Ask to turn CrunchCall on" onClick={() => setAskToStart(!calendar.askToStart)} />
        </Row>
      </div>

      <div className="set-card">
        <h2>Source</h2>
        <div className="cal-block">
          <p className="set-label">Calendar link</p>
          <p className="help">
            {desktop
              ? 'Secret address from Google, Outlook, or Apple. A webcal link is fine.'
              : 'Secret address from Google, Outlook, or Apple. If the browser blocks it, import an .ics file.'}
          </p>
          <label className="field">
            <span className="sr">Calendar link</span>
            <input
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void syncLink()
              }}
              placeholder="https://…/basic.ics"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <div className="cal-actions">
            <button type="button" className="btn small primary" onClick={() => void syncLink()} disabled={syncing}>
              {syncing ? 'Syncing…' : 'Sync'}
            </button>
            <button type="button" className="btn small ghost" onClick={() => fileRef.current?.click()}>
              Import .ics
            </button>
          </div>
          <input ref={fileRef} className="sr" type="file" accept=".ics,text/calendar" onChange={(event) => void onFile(event)} />
        </div>
        {calendar.source?.kind === 'file' ? (
          <p className="help">Using {calendar.source.name}. Import again to refresh. A link stays current.</p>
        ) : null}
        {calendar.error ? <p className="help cal-error">{calendar.error}</p> : null}
        {!calendar.error && calendar.syncedAt ? (
          <p className="help">
            Synced {formatSynced(calendar.syncedAt)}
            {next ? ` · Next is ${next.title}, ${formatWhen(next.start, next.end, next.allDay, now)}` : ''}
          </p>
        ) : null}
        {!desktop && typeof Notification !== 'undefined' && Notification.permission === 'denied' ? (
          <p className="help">Notifications are blocked in the browser. The prompt still shows in the app.</p>
        ) : null}
      </div>
    </section>
  )
}

function Row({ title, help, children }: { title: string; help: string; children: ReactNode }) {
  return (
    <div className="set-row">
      <div>
        <p className="set-label">{title}</p>
        <p className="help">{help}</p>
      </div>
      {children}
    </div>
  )
}

function Switch({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} className={on ? 'switch on' : 'switch'} onClick={onClick}>
      <span />
    </button>
  )
}
