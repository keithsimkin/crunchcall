import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import { completeAsk, type AskMessage, type AskPull } from '../features/ask/complete'
import type { AskFocus } from '../features/ask/context'
import type { CalendarEvent } from '../features/calendar/ics'
import { engineAvailable } from '../features/engines/call'
import { engineById, engineDefaults } from '../features/engines/catalog'
import type { MeetingRow, ProjectFolder } from './fixtures'
import { CheckIcon, ChevronIcon, EyeIcon, PencilIcon, PlusIcon, SparkIcon } from './icons'
import { profileInitials } from './profile'
import type { SettingsSection } from './settingsState'

type FloatingAskProps = {
  focus: AskFocus
  rows: MeetingRow[]
  folders: ProjectFolder[]
  upcoming: CalendarEvent[]
  writerId: string
  hasWriterKey: boolean
  userName: string
  hidden?: boolean
  onOpenSettings: (section: SettingsSection) => void
  onOpenMeeting: (meetingId: string, utteranceId?: string) => void
}

type ChatTurn = AskMessage & {
  contextLabel?: string
  pulls?: AskPull[]
}

type AnswerBlock =
  | { kind: 'p'; text: string }
  | { kind: 'h'; text: string }
  | { kind: 'ul'; items: string[] }
  | { kind: 'ol'; items: string[] }

function SendArrowIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true" fill="none">
      <path
        d="M12 19V5M12 5l-6 6M12 5l6 6"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function CopyIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" fill="none">
      <rect x="8" y="8" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.7" />
      <path d="M6.5 16H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v.5" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  )
}

function DocIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true" fill="none">
      <path
        d="M7.2 3.8h6.4L18.5 8.6V19a1.4 1.4 0 0 1-1.4 1.4H7.2A1.4 1.4 0 0 1 5.8 19V5.2A1.4 1.4 0 0 1 7.2 3.8Z"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path d="M13.2 3.9V8.4h4.4" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  )
}

function personInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase()
  return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase()
}

function chipPeople(meeting: MeetingRow): string[] {
  const people = meeting.people.map((person) => person.trim()).filter(Boolean)
  if (people.length) return people.slice(0, 2)
  return [meeting.title]
}

function chipLabel(meeting: MeetingRow): string {
  const people = meeting.people.map((person) => person.trim()).filter(Boolean)
  if (people.length >= 2) return `${people[0]} x ${people[1]}`
  if (people.length === 1) return people[0]
  return meeting.title
}

function richLine(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return <strong key={index}>{part.slice(2, -2)}</strong>
    }
    return <span key={index}>{part}</span>
  })
}

function parseAnswer(text: string): AnswerBlock[] {
  const blocks: AnswerBlock[] = []
  let list: Extract<AnswerBlock, { kind: 'ul' | 'ol' }> | null = null

  function flush() {
    if (!list) return
    blocks.push(list)
    list = null
  }

  for (const raw of text.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trim()
    if (!line) {
      flush()
      continue
    }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line)
    if (heading) {
      flush()
      blocks.push({ kind: 'h', text: heading[2].replace(/\*\*/g, '') })
      continue
    }
    const bullet = /^(?:[-•*]|\u2022)\s+(.+)$/.exec(line)
    if (bullet) {
      if (!list || list.kind !== 'ul') {
        flush()
        list = { kind: 'ul', items: [] }
      }
      list.items.push(bullet[1])
      continue
    }
    const numbered = /^\d+[.)]\s+(.+)$/.exec(line)
    if (numbered) {
      if (!list || list.kind !== 'ol') {
        flush()
        list = { kind: 'ol', items: [] }
      }
      list.items.push(numbered[1])
      continue
    }
    flush()
    blocks.push({ kind: 'p', text: line })
  }
  flush()
  return blocks.length ? blocks : [{ kind: 'p', text }]
}

function AnswerBody({ text }: { text: string }) {
  const blocks = parseAnswer(text)
  return (
    <div className="float-ask-prose">
      {blocks.map((block, index) => {
        if (block.kind === 'h') return <h3 key={index}>{block.text}</h3>
        if (block.kind === 'ul') {
          return (
            <ul key={index}>
              {block.items.map((item) => (
                <li key={item}>{richLine(item)}</li>
              ))}
            </ul>
          )
        }
        if (block.kind === 'ol') {
          return (
            <ol key={index}>
              {block.items.map((item) => (
                <li key={item}>{richLine(item)}</li>
              ))}
            </ol>
          )
        }
        return <p key={index}>{richLine(block.text)}</p>
      })}
    </div>
  )
}

export function FloatingAsk({
  focus,
  rows,
  folders,
  upcoming,
  writerId,
  hasWriterKey,
  userName,
  hidden = false,
  onOpenSettings,
  onOpenMeeting,
}: FloatingAskProps) {
  const panelId = useId()
  const inputId = useId()
  const pickerId = useId()
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const boxRef = useRef<HTMLFormElement>(null)
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [messages, setMessages] = useState<ChatTurn[]>([])
  const [taggedIds, setTaggedIds] = useState<string[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerQuery, setPickerQuery] = useState('')
  const [copied, setCopied] = useState(false)
  const writer = engineById(writerId) ?? engineById(engineDefaults.writer)
  const you = profileInitials(userName)
  const taggedMeetings = useMemo(
    () => taggedIds.map((id) => rows.find((row) => row.id === id)).filter((row): row is MeetingRow => Boolean(row)),
    [rows, taggedIds],
  )
  const pickerRows = useMemo(() => {
    const needle = pickerQuery.trim().toLowerCase()
    return rows
      .filter((row) => !taggedIds.includes(row.id))
      .filter((row) => {
        if (!needle) return true
        return (
          row.title.toLowerCase().includes(needle) ||
          row.people.some((person) => person.toLowerCase().includes(needle)) ||
          row.topics.some((topic) => topic.toLowerCase().includes(needle))
        )
      })
      .slice(0, 8)
  }, [pickerQuery, rows, taggedIds])
  const canSend = Boolean(draft.trim()) && !busy
  const pageHint =
    focus.page === 'notes'
      ? 'This meeting'
      : focus.page === 'live'
        ? 'This call'
        : focus.page === 'list'
          ? 'All meetings'
          : focus.page === 'calendar'
            ? 'Calendar'
            : focus.page === 'projects'
              ? 'Projects'
              : focus.page === 'dictate'
                ? 'Dictations'
                : focus.page === 'connect'
                  ? 'Connect'
                  : 'Shortcuts'
  const contextNow = taggedMeetings.length
    ? taggedMeetings.map((meeting) => meeting.title).join(' · ')
    : pageHint

  useEffect(() => {
    if (focus.page !== 'notes') return
    setTaggedIds((current) => (current.includes(focus.meetingId) ? current : [focus.meetingId, ...current]))
  }, [focus])

  useEffect(() => {
    if (!open) {
      setPickerOpen(false)
      setPickerQuery('')
    }
  }, [open])

  useEffect(() => {
    if (!open || hidden) return
    function onKey(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        if (pickerOpen) {
          setPickerOpen(false)
          return
        }
        setOpen(false)
        inputRef.current?.blur()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, pickerOpen, hidden])

  useEffect(() => {
    if (!pickerOpen) return
    function onPointer(event: MouseEvent) {
      const node = boxRef.current
      if (!node) return
      if (event.target instanceof Node && node.contains(event.target)) return
      setPickerOpen(false)
    }
    window.addEventListener('mousedown', onPointer)
    return () => window.removeEventListener('mousedown', onPointer)
  }, [pickerOpen])

  useEffect(() => {
    const node = scrollerRef.current
    if (!node || !open) return
    node.scrollTop = node.scrollHeight
  }, [messages, busy, open])

  useEffect(() => {
    const node = inputRef.current
    if (!node) return
    node.style.height = '0px'
    const max = open ? 120 : 18
    node.style.height = `${Math.min(Math.max(node.scrollHeight, open ? 36 : 16), max)}px`
  }, [draft, open])

  function expand() {
    if (!open) setOpen(true)
  }

  function collapse() {
    setOpen(false)
    setPickerOpen(false)
    inputRef.current?.blur()
  }

  function addTag(id: string) {
    setTaggedIds((current) => (current.includes(id) ? current : [...current, id]))
    setPickerOpen(false)
    setPickerQuery('')
    window.setTimeout(() => inputRef.current?.focus(), 0)
  }

  function removeTag(id: string) {
    setTaggedIds((current) => current.filter((item) => item !== id))
  }

  function clearThread() {
    setMessages([])
    setDraft('')
    window.setTimeout(() => inputRef.current?.focus(), 0)
  }

  async function copyThread() {
    const text = messages
      .map((message) => `${message.role === 'user' ? 'You' : 'CrunchCall'}: ${message.text}`)
      .join('\n\n')
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1400)
    } catch {
      setCopied(false)
    }
  }

  async function send(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault()
    const text = draft.trim()
    if (!text || busy) return
    setOpen(true)
    setPickerOpen(false)
    const sources = taggedMeetings.map((meeting) => ({ id: meeting.id, title: meeting.title }))
    const user: ChatTurn = {
      id: `u-${Date.now()}`,
      role: 'user',
      text,
      contextLabel: contextNow,
    }
    setMessages((current) => [...current, user])
    setDraft('')
    setBusy(true)

    const result = await completeAsk({
      question: text,
      writerId,
      hasWriterKey,
      focus,
      rows,
      folders,
      upcoming,
      taggedMeetingIds: taggedIds,
    })

    const reply: ChatTurn = {
      id: `a-${Date.now()}`,
      role: 'assistant',
      text: result.ok ? result.text : result.message,
      sources,
    }
    setMessages((current) => [...current, reply])
    setBusy(false)
    window.setTimeout(() => inputRef.current?.focus(), 0)
  }

  function onComposerKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void send()
    }
  }

  const composer = (
    <form
      ref={boxRef}
      className={`float-ask-box${open ? ' expanded' : ''}`}
      onSubmit={send}
      onClick={expand}
    >
      {open && taggedMeetings.length ? (
        <div className="float-ask-chips">
          {taggedMeetings.map((meeting) => (
            <span key={meeting.id} className="float-ask-chip" title={meeting.title}>
              <span className="float-ask-faces" aria-hidden="true">
                {chipPeople(meeting).map((person, index) => (
                  <span key={person} className={index === 0 ? 'float-ask-face' : 'float-ask-face alt'}>
                    {personInitials(person)}
                  </span>
                ))}
              </span>
              <span className="float-ask-chip-label">{chipLabel(meeting)}</span>
              <button
                type="button"
                className="float-ask-chip-x"
                aria-label={`Remove ${meeting.title}`}
                onClick={(event) => {
                  event.stopPropagation()
                  removeTag(meeting.id)
                }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}

      {!open ? (
        <span className="float-ask-idle-mark" aria-hidden="true">
          <SparkIcon />
        </span>
      ) : null}

      <label className="sr" htmlFor={inputId}>
        Ask about your notes
      </label>
      <textarea
        id={inputId}
        ref={inputRef}
        rows={1}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onFocus={expand}
        onKeyDown={onComposerKey}
        placeholder="Ask anything"
        autoComplete="off"
        disabled={busy}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
      />

      <div className="float-ask-tools">
        {open ? (
          <div className="float-ask-tools-left">
            <button
              type="button"
              className={`float-ask-plus${pickerOpen ? ' active' : ''}`}
              aria-label="Tag a meeting"
              aria-expanded={pickerOpen}
              aria-controls={pickerId}
              onClick={(event) => {
                event.stopPropagation()
                setPickerOpen((current) => !current)
              }}
            >
              <PlusIcon />
            </button>
            <button
              type="button"
              className="float-ask-writer"
              onClick={(event) => {
                event.stopPropagation()
                onOpenSettings('notes')
              }}
            >
              <SparkIcon />
              <span>{writer?.name ?? 'Writer'}</span>
              <em>{writer?.needsKey && !hasWriterKey ? 'Key' : writer?.where === 'cloud' ? 'Cloud' : 'On PC'}</em>
            </button>
          </div>
        ) : null}
        <button
          type="submit"
          className="float-ask-send"
          disabled={!canSend}
          aria-label="Send"
          onClick={(event) => event.stopPropagation()}
        >
          <SendArrowIcon />
        </button>
      </div>

      {open && pickerOpen ? (
        <div className="float-ask-picker" id={pickerId} role="listbox" aria-label="Tag a meeting">
          <input
            className="float-ask-picker-search"
            value={pickerQuery}
            onChange={(event) => setPickerQuery(event.target.value)}
            onClick={(event) => event.stopPropagation()}
            placeholder="Search meetings…"
            autoFocus
          />
          <div className="float-ask-picker-list">
            {pickerRows.length ? (
              pickerRows.map((meeting) => (
                <button
                  key={meeting.id}
                  type="button"
                  className="float-ask-picker-row"
                  role="option"
                  onClick={(event) => {
                    event.stopPropagation()
                    addTag(meeting.id)
                  }}
                >
                  <span className="float-ask-face" aria-hidden="true">
                    {personInitials(chipPeople(meeting)[0] ?? meeting.title)}
                  </span>
                  <span className="float-ask-picker-copy">
                    <strong>{meeting.title}</strong>
                    <small>
                      {meeting.when}
                      {meeting.people.length ? ` · ${meeting.people.slice(0, 2).join(', ')}` : ''}
                    </small>
                  </span>
                </button>
              ))
            ) : (
              <p className="float-ask-picker-empty">No meetings match that.</p>
            )}
          </div>
        </div>
      ) : null}
    </form>
  )

  if (hidden) return null

  return (
    <div className={`float-ask${open ? ' open' : ''}`}>
      {open ? (
        <button type="button" className="float-ask-scrim" aria-label="Close ask chat" onClick={collapse} />
      ) : null}

      <div className="float-ask-stage">
        <section
          className={`float-ask-sheet${open ? ' open' : ''}`}
          id={open ? panelId : undefined}
          role={open ? 'dialog' : undefined}
          aria-modal={open ? true : undefined}
          aria-label={open ? 'Ask CrunchCall' : undefined}
        >
          {composer}
          {open ? (
            <header className="float-ask-head">
              <div className="float-ask-brand">
                <button type="button" className="float-ask-title" onClick={clearThread}>
                  New chat
                  <ChevronIcon />
                </button>
                <span className="float-ask-private">Private</span>
              </div>
              <div className="float-ask-head-actions">
                <button type="button" className="float-ask-icon" aria-label="New chat" onClick={clearThread}>
                  <PencilIcon />
                </button>
                <button
                  type="button"
                  className="float-ask-icon"
                  aria-label={copied ? 'Copied' : 'Copy chat'}
                  onClick={() => void copyThread()}
                  disabled={!messages.length}
                >
                  {copied ? <CheckIcon /> : <CopyIcon />}
                </button>
                <button type="button" className="float-ask-icon" onClick={collapse} aria-label="Close ask">
                  ×
                </button>
              </div>
            </header>
          ) : null}

          {open ? (
            <div className="float-ask-thread" ref={scrollerRef}>
              {messages.length === 0 && !busy ? (
                <div className="float-ask-empty">
                  <p>Tag a meeting, then ask about owners, decisions, or next steps.</p>
                  <div className="float-ask-prompts">
                    {['Who owns the open next steps?', 'What did we decide?', 'What is coming up?'].map((prompt) => (
                      <button
                        key={prompt}
                        type="button"
                        className="float-ask-prompt"
                        onClick={() => {
                          setDraft(prompt)
                          window.setTimeout(() => inputRef.current?.focus(), 0)
                        }}
                      >
                        {prompt}
                      </button>
                    ))}
                  </div>
                  <p className="float-ask-hint">
                    {engineAvailable()
                      ? writer
                        ? `${writer.name}${writer.textLeavesDevice ? ' · cloud' : ' · on this PC'}`
                        : 'Pick a writer under Settings → Notes.'
                      : 'Desktop engine offline — local search for now.'}
                  </p>
                </div>
              ) : (
                messages.map((message) =>
                  message.role === 'user' ? (
                    <div key={message.id} className="float-ask-turn user">
                      {message.contextLabel ? (
                        <p className="float-ask-context">
                          <DocIcon />
                          <span>{message.contextLabel}</span>
                        </p>
                      ) : null}
                      <div className="float-ask-user-row">
                        <div className="float-ask-user-bubble">
                          <p>{message.text}</p>
                        </div>
                        <span className="float-ask-you" aria-hidden="true">
                          {you}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <article key={message.id} className="float-ask-turn assistant">
                      <AnswerBody text={message.text} />
                      {message.sources?.length ? (
                        <div className="float-ask-results">
                          <p>
                            {message.sources.length} {message.sources.length === 1 ? 'meeting' : 'meetings'}
                          </p>
                          <ul>
                            {message.sources.map((source) => (
                              <li key={source.id}>
                                <DocIcon />
                                <span>{source.title}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                    </article>
                  ),
                )
              )}
              {busy ? (
                <div className="float-ask-trace" aria-live="polite">
                  {taggedMeetings[0] ? (
                    <div className="float-ask-trace-row">
                      <EyeIcon />
                      <span>Viewed</span>
                      <span className="float-ask-trace-chip">{taggedMeetings[0].title}</span>
                    </div>
                  ) : null}
                  <div className="float-ask-trace-row">
                    <span className="float-ask-spin" aria-hidden="true" />
                    <span>Generating answer…</span>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {open ? (
            <p className="float-ask-fine">Answers come from your notes. Check the meeting before you rely on a line.</p>
          ) : null}
        </section>
      </div>
    </div>
  )
}
