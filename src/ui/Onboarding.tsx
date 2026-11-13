import { useEffect, useId, useRef, useState, type ChangeEvent, type RefObject } from 'react'
import type { CalendarEvent } from '../features/calendar/ics'
import type { CalendarState } from '../features/calendar/store'
import { connectUrl, importCalendarText, setAskToStart, setCalendarError, getState } from '../features/calendar/store'
import { calendarIntro } from '../features/calendar/connectCopy'
import { AccountConnect } from './AccountConnect'
import { formatWhen } from '../features/calendar/format'
import { useCalendarSignIn } from './useCalendar'
import { LogoMark } from './icons'
import {
  givenName,
  mcpClientById,
  mcpClients,
  mcpConfigText,
  mcpSetupPrompt,
  type McpClientId,
  type Profile,
} from './profile'

const steps = [
  { id: 'name', label: 'Name' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'connect', label: 'Connect' },
  { id: 'ready', label: 'Ready' },
] as const

type StepId = (typeof steps)[number]['id']

export function Onboarding({
  profile,
  replay,
  calendar,
  upcoming,
  now,
  launchAtLogin,
  onLaunchAtLogin,
  onSave,
  onFinish,
  onClose,
}: {
  profile: Profile
  replay: boolean
  calendar: CalendarState
  upcoming: CalendarEvent[]
  now: number
  launchAtLogin: boolean
  onLaunchAtLogin: (on: boolean) => void
  onSave: (next: Profile) => void
  onFinish: (next: Profile, destination?: 'home' | 'connect') => void
  onClose: () => void
}) {
  const titleId = useId()
  const cardRef = useRef<HTMLDivElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const urlRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const promptRef = useRef<HTMLTextAreaElement>(null)
  const [index, setIndex] = useState(0)
  const [farthest, setFarthest] = useState(replay ? steps.length - 1 : 0)
  const [draft, setDraft] = useState<Profile>(profile)
  const [url, setUrl] = useState(calendar.source?.kind === 'url' ? calendar.source.url : '')
  const [syncing, setSyncing] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const step = steps[index]
  const name = draft.name.trim()
  const client = mcpClientById(draft.mcpClient)
  const prompt = mcpSetupPrompt(name, draft.mcpClient)
  const config = mcpConfigText(draft.mcpClient)
  const ahead = calendar.events.filter((event) => event.end > now).length
  const desktop = typeof window !== 'undefined' && !!window.crunchcall?.connectCalendar

  useEffect(() => {
    const node = cardRef.current
    const field =
      step.id === 'name' ? nameRef.current : step.id === 'calendar' ? urlRef.current : step.id === 'connect' ? promptRef.current : node
    field?.focus()
  }, [step.id])

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(null), 1600)
    return () => window.clearTimeout(timer)
  }, [copied])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const node = cardRef.current
      if (event.key === 'Escape') {
        event.preventDefault()
        const next = clean(draft)
        onSave(next)
        setDraft(next)
        if (replay) onClose()
        else if (index > 0) setIndex(index - 1)
        return
      }
      if (event.key !== 'Tab' || !node) return
      const items = [...node.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [href]')]
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [draft, index, onClose, onSave, replay])

  function move(nextIndex: number, patch?: Partial<Profile>) {
    const next = clean({ ...draft, ...patch })
    setDraft(next)
    onSave(next)
    setIndex(nextIndex)
    setFarthest((value) => Math.max(value, nextIndex))
  }

  async function copyText(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(key)
      const next = clean({ ...draft, mcpCopied: true })
      setDraft(next)
      onSave(next)
    } catch {
      setCopied('failed')
      promptRef.current?.focus()
      promptRef.current?.select()
    }
  }

  async function syncLink() {
    setSyncing(true)
    try {
      await connectUrl(url)
    } finally {
      setSyncing(false)
    }
  }

  async function continueCalendar() {
    const trimmed = url.trim()
    const saved = calendar.source?.kind === 'url' ? calendar.source.url : ''
    if (trimmed && trimmed !== saved) {
      setSyncing(true)
      try {
        await connectUrl(trimmed)
      } finally {
        setSyncing(false)
      }
      if (getState().error) return
    }
    move(2)
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

  function chooseClient(id: McpClientId) {
    const next = clean({ ...draft, mcpClient: id })
    setDraft(next)
    onSave(next)
  }

  function close() {
    const next = clean(draft)
    onSave(next)
    onClose()
  }

  const calendarLine = calendarLineFor(calendar, ahead)
  const connectLine = draft.mcpCopied ? `Copied for ${client.name}` : 'Not copied yet'

  return (
    <div
      className="ob-root"
      onMouseDown={(event) => {
        if (event.target !== event.currentTarget || !replay) return
        close()
      }}
    >
      <div
        ref={cardRef}
        className="ob-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <aside className="ob-rail">
          <div className="ob-brand">
            <LogoMark />
            <span>annotated</span>
          </div>
          <nav className="ob-steps" aria-label="Setup steps">
            {steps.map((item, itemIndex) => {
              const on = itemIndex === index
              const locked = itemIndex > farthest
              const done = !on && itemIndex <= farthest
              return (
                <button
                  key={item.id}
                  type="button"
                  className={on ? 'ob-step on' : 'ob-step'}
                  aria-current={on ? 'step' : undefined}
                  disabled={locked}
                  onClick={() => move(itemIndex)}
                >
                  <span className={done ? 'ob-num done' : 'ob-num'}>{done ? '✓' : itemIndex + 1}</span>
                  {item.label}
                </button>
              )
            })}
          </nav>
          <p className="ob-rail-note">Notes stay on this PC. No bot joins the call.</p>
          {replay ? null : (
            <button type="button" className="ob-skip" onClick={() => onFinish(clean(draft))}>
              Skip setup
            </button>
          )}
        </aside>
        <div className="ob-main">
          {replay ? (
            <button type="button" className="pop-x ob-x" onClick={close} aria-label="Close setup">
              ×
            </button>
          ) : null}
          <p className="ob-kicker">
            {index + 1} of {steps.length}
          </p>
          <StepBody
            titleId={titleId}
            step={step.id}
            name={draft.name}
            trimmed={name}
            nameRef={nameRef}
            url={url}
            urlRef={urlRef}
            fileRef={fileRef}
            promptRef={promptRef}
            prompt={prompt}
            configLabel={config.label}
            calendar={calendar}
            upcoming={upcoming}
            now={now}
            calendarLine={calendarLine}
            connectLine={connectLine}
            clientId={draft.mcpClient}
            copied={copied}
            syncing={syncing}
            desktop={desktop}
            launchAtLogin={launchAtLogin}
            onName={(value) => setDraft((current) => ({ ...current, name: value.slice(0, 48) }))}
            onUrl={setUrl}
            onSync={() => void syncLink()}
            onFile={(event) => void onFile(event)}
            onAsk={() => setAskToStart(!calendar.askToStart)}
            onClient={chooseClient}
            onCopyPrompt={() => void copyText(prompt, 'prompt')}
            onCopyConfig={() => void copyText(config.text, 'config')}
            onLaunch={() => onLaunchAtLogin(!launchAtLogin)}
            onJump={move}
          />
          <div className="ob-foot">
            <div>
              {index > 0 ? (
                <button type="button" className="btn ghost" onClick={() => move(index - 1)}>
                  Back
                </button>
              ) : null}
            </div>
            <div className="head-actions">
              {step.id === 'name' && !name ? (
                <button type="button" className="btn ghost" onClick={() => move(1, { name: '' })}>
                  Skip for now
                </button>
              ) : null}
              {step.id === 'calendar' ? (
                <button type="button" className="btn ghost" onClick={() => move(2)}>
                  Skip for now
                </button>
              ) : null}
              {step.id === 'ready' ? (
                <button type="button" className="btn ghost" onClick={() => onFinish(clean(draft), 'connect')}>
                  Open Connect
                </button>
              ) : null}
              {step.id === 'name' ? (
                <button type="button" className="btn primary" disabled={!name} onClick={() => move(1)}>
                  Continue
                </button>
              ) : null}
              {step.id === 'calendar' ? (
                <button type="button" className="btn primary" disabled={syncing} onClick={() => void continueCalendar()}>
                  {syncing ? 'Syncing…' : 'Continue'}
                </button>
              ) : null}
              {step.id === 'connect' ? (
                <button type="button" className="btn primary" onClick={() => move(3)}>
                  Continue
                </button>
              ) : null}
              {step.id === 'ready' ? (
                <button type="button" className="btn primary" onClick={() => onFinish(clean(draft), 'home')}>
                  Open Home
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function StepBody({
  titleId,
  step,
  name,
  trimmed,
  nameRef,
  url,
  urlRef,
  fileRef,
  promptRef,
  prompt,
  configLabel,
  calendar,
  upcoming,
  now,
  calendarLine,
  connectLine,
  clientId,
  copied,
  syncing,
  desktop,
  launchAtLogin,
  onName,
  onUrl,
  onSync,
  onFile,
  onAsk,
  onClient,
  onCopyPrompt,
  onCopyConfig,
  onLaunch,
  onJump,
}: {
  titleId: string
  step: StepId
  name: string
  trimmed: string
  nameRef: RefObject<HTMLInputElement | null>
  url: string
  urlRef: RefObject<HTMLInputElement | null>
  fileRef: RefObject<HTMLInputElement | null>
  promptRef: RefObject<HTMLTextAreaElement | null>
  prompt: string
  configLabel: string
  calendar: CalendarState
  upcoming: CalendarEvent[]
  now: number
  calendarLine: string
  connectLine: string
  clientId: McpClientId
  copied: string | null
  syncing: boolean
  desktop: boolean
  launchAtLogin: boolean
  onName: (value: string) => void
  onUrl: (value: string) => void
  onSync: () => void
  onFile: (event: ChangeEvent<HTMLInputElement>) => void
  onAsk: () => void
  onClient: (id: McpClientId) => void
  onCopyPrompt: () => void
  onCopyConfig: () => void
  onLaunch: () => void
  onJump: (index: number) => void
}) {
  const hello = trimmed ? `You're set, ${givenName(trimmed)}.` : "You're set."
  const next = upcoming[0]
  const client = mcpClientById(clientId)
  const { signIn } = useCalendarSignIn()

  if (step === 'name') {
    return (
      <div className="ob-body">
        <h2 id={titleId}>What should we call you?</h2>
        <p className="ob-lede">
          Your name stays on this PC. It shows in the sidebar, and Ask — the chat bar at the bottom — can address you
          when it answers from your notes. The same name is written into the prompt you paste into Claude, Cursor, or
          ChatGPT.
        </p>
        <label className="field ob-field">
          <span>Your name</span>
          <input
            ref={nameRef}
            value={name}
            onChange={(event) => onName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && trimmed) {
                event.preventDefault()
                onJump(1)
              }
            }}
            placeholder="Maya Chen"
            autoComplete="name"
            maxLength={48}
            spellCheck={false}
          />
        </label>
      </div>
    )
  }

  if (step === 'calendar') {
    return (
      <div className="ob-body">
        <h2 id={titleId}>Sync the next two weeks</h2>
        <p className="ob-lede">{calendarIntro(desktop, signIn)}</p>
        <AccountConnect plain />
        <label className="field ob-field">
          <span>{desktop ? 'Apple, Outlook, or another calendar' : 'Calendar link'}</span>
          <input
            ref={urlRef}
            value={url}
            onChange={(event) => onUrl(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                onSync()
              }
            }}
            placeholder="https://…/basic.ics"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <div className="head-actions ob-actions">
          <button type="button" className="btn small primary" onClick={onSync} disabled={syncing}>
            {syncing ? 'Syncing…' : 'Sync'}
          </button>
          <button type="button" className="btn small ghost" onClick={() => fileRef.current?.click()}>
            Import .ics
          </button>
          <input ref={fileRef} className="sr" type="file" accept=".ics,text/calendar" onChange={onFile} />
        </div>
        <div className="ob-switch-row">
          <div>
            <p className="set-label">Ask to turn on</p>
            <p className="help">When a meeting starts, ask in the app before listening.</p>
          </div>
          <Switch on={calendar.askToStart} label="Ask to turn annotated on" onClick={onAsk} />
        </div>
        <p className={calendar.error ? 'ob-status cal-error' : 'ob-status'} role="status">
          {calendar.error ?? calendarLine}
          {!calendar.error && next ? ` Next is ${next.title}, ${formatWhen(next.start, next.end, next.allDay, now)}.` : ''}
        </p>
      </div>
    )
  }

  if (step === 'connect') {
    return (
      <div className="ob-body">
        <h2 id={titleId}>Copy a prompt for your assistant</h2>
        <p className="ob-lede">
          Paste this into {client.name}. It adds the local annotated server and asks for your open next steps. The
          server is read-only and stays on this PC. This is optional — Ask, the chat bar inside the app, already
          answers from your notes without it.
        </p>
        <div className="ob-clients" role="tablist" aria-label="Assistant">
          {mcpClients.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={clientId === item.id}
              className={clientId === item.id ? 'ob-client on' : 'ob-client'}
              onClick={() => onClient(item.id)}
            >
              {item.mark ? (
                <img className={item.id === 'cursor' ? 'is-cursor' : undefined} src={item.mark} alt="" />
              ) : (
                <span className="ob-client-mark">{item.name.slice(0, 2)}</span>
              )}
              {item.name}
            </button>
          ))}
        </div>
        <p className="ob-where">{client.where}</p>
        <textarea ref={promptRef} className="ob-prompt" readOnly value={prompt} aria-label="Setup prompt" spellCheck={false} />
        <div className="head-actions ob-actions">
          <button type="button" className="btn small primary" onClick={onCopyPrompt}>
            {copied === 'prompt' ? 'Copied' : 'Copy prompt'}
          </button>
          <button type="button" className="btn small ghost" onClick={onCopyConfig}>
            {copied === 'config' ? 'Copied' : configLabel}
          </button>
        </div>
        <p className="ob-status" role="status">
          {copied === 'failed' ? 'Clipboard blocked. The prompt is selected so you can copy it.' : connectLine}
        </p>
      </div>
    )
  }

  return (
    <div className="ob-body">
      <h2 id={titleId}>{hello}</h2>
      <p className="ob-lede">
        Annotate every call. Ask sits at the bottom of every screen and answers from the meetings, notes, actions, and
        calendar already on this PC — who owns a next step, what you decided, what is coming up. You can run this setup
        again from Settings → System.
      </p>
      <div className="ob-ask-card" role="note">
        <p className="set-label">Ask</p>
        <p className="help">
          Type in the small bar, or tag a person, meeting, or project when you want a tighter answer. It stays with your
          notes; a cloud writer is optional under Settings → Notes.
        </p>
      </div>
      <div className="ob-checks">
        <Check label="Name" value={trimmed || 'Add one in Settings'} onClick={() => onJump(0)} />
        <Check label="Calendar" value={calendarLine} onClick={() => onJump(1)} />
        <Check label="Assistant" value={connectLine} onClick={() => onJump(2)} />
      </div>
      <div className="ob-switch-row">
        <div>
          <p className="set-label">Launch at login</p>
          <p className="help">Open annotated when Windows starts, so the calendar prompt is waiting.</p>
        </div>
        <Switch on={launchAtLogin} label="Launch at login" onClick={onLaunch} />
      </div>
    </div>
  )
}

function Check({ label, value, onClick }: { label: string; value: string; onClick: () => void }) {
  return (
    <button type="button" className="ob-check" onClick={onClick}>
      <span>{label}</span>
      <strong>{value}</strong>
    </button>
  )
}

function Switch({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} className={on ? 'switch on' : 'switch'} onClick={onClick}>
      <span />
    </button>
  )
}

function clean(profile: Profile): Profile {
  return { ...profile, name: profile.name.trim().slice(0, 48) }
}

function calendarLineFor(calendar: CalendarState, ahead: number): string {
  if (!calendar.enabled || !calendar.source) return 'Not synced yet'
  const source =
    calendar.source.kind === 'file'
      ? calendar.source.name
      : calendar.source.kind === 'url'
        ? 'Private link'
        : `${calendar.source.provider === 'google' ? 'Google' : 'Outlook'} · ${calendar.source.account}`
  if (ahead === 0) return `${source}. Nothing coming up in the next two weeks.`
  const noun = ahead === 1 ? 'meeting' : 'meetings'
  return `${source}. ${ahead} ${noun} coming up.`
}
