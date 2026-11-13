import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import { completeAsk, type AskMessage, type AskPull } from '../features/ask/complete'
import type { AskFocus } from '../features/ask/context'
import {
  activeMention,
  dropActiveMention,
  emptyAskTags,
  listMentions,
  MENTION_GUIDE,
  mentionMeta,
  skillById,
  withMention,
  withoutMention,
  type ActiveMention,
  type AskTags,
  type MentionItem,
  type MentionKind,
  type MentionTrigger,
} from '../features/ask/mentions'
import type { CalendarEvent } from '../features/calendar/ics'
import { engineAvailable } from '../features/engines/call'
import { engineById, engineDefaults } from '../features/engines/catalog'
import { demoAsk, type MeetingRow, type ProjectFolder } from './fixtures'
import { EyeIcon, PlusIcon, SparkIcon } from './icons'
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
  demo?: { question: string; answer: string; label: string; pulls: AskPull[] } | null
  recording?: boolean
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

function MentionMenu({
  id,
  mention,
  items,
  activeIndex,
  onPick,
}: {
  id: string
  mention: ActiveMention
  items: MentionItem[]
  activeIndex: number
  onPick: (item: MentionItem) => void
}) {
  const listRef = useRef<HTMLDivElement>(null)
  const meta = mentionMeta(mention.kind)
  const label = meta.menu.toLowerCase()

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, items])

  return (
    <div
      className="float-ask-picker"
      id={id}
      role="listbox"
      aria-label={meta.menu}
      onMouseDown={(event) => event.preventDefault()}
    >
      <div className="float-ask-mention-head">
        <span>{meta.menu}</span>
        <span>{mention.trigger}</span>
      </div>
      <div className="float-ask-picker-list" ref={listRef}>
        {items.length ? (
          items.map((item, index) => (
            <button
              key={`${item.kind}-${item.id}`}
              id={`${id}-opt-${index}`}
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              className={index === activeIndex ? 'float-ask-picker-row on' : 'float-ask-picker-row'}
              onClick={(event) => {
                event.stopPropagation()
                onPick(item)
              }}
            >
              <span className="float-ask-mention-key" aria-hidden="true">
                {item.trigger}
              </span>
              <span className="float-ask-picker-copy">
                <strong>{item.label}</strong>
                <small>{item.detail}</small>
              </span>
            </button>
          ))
        ) : (
          <p className="float-ask-picker-empty">
            {mention.query ? `No ${label} match “${mention.query}”.` : 'Nothing else to tag.'}
          </p>
        )}
      </div>
      {items.length ? <p className="float-ask-mention-hint">↑↓ to move · Enter to tag · Esc to dismiss</p> : null}
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
  demo = null,
  recording = false,
  onOpenSettings,
  onOpenMeeting,
}: FloatingAskProps) {
  const panelId = useId()
  const inputId = useId()
  const pickerId = useId()
  const mentionListId = useId()
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const boxRef = useRef<HTMLFormElement>(null)
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [messages, setMessages] = useState<ChatTurn[]>([])
  const [tags, setTags] = useState<AskTags>(emptyAskTags)
  const [caret, setCaret] = useState(0)
  const [mentionHeld, setMentionHeld] = useState(false)
  const [mentionCursor, setMentionCursor] = useState({ key: '', index: 0 })
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerQuery, setPickerQuery] = useState('')
  const [copied, setCopied] = useState(false)
  const [pinnedFocusId, setPinnedFocusId] = useState<string | null>(null)
  const [demoKey, setDemoKey] = useState('')
  const pendingCaret = useRef<number | null>(null)
  if (demo && demo.question !== demoKey) {
    setDemoKey(demo.question)
    setOpen(true)
    setMessages([
      { id: 'demo-question', role: 'user', text: demo.question, contextLabel: demo.label },
      { id: 'demo-answer', role: 'assistant', text: demo.answer, pulls: demo.pulls },
    ])
  } else if (!demo && demoKey) {
    setDemoKey('')
    setOpen(false)
    setMessages([])
  }

  const draftRef = useRef('')
  const askRef = useRef({ writerId, hasWriterKey, focus, rows, folders, upcoming })
  useEffect(() => {
    draftRef.current = draft
    askRef.current = { writerId, hasWriterKey, focus, rows, folders, upcoming }
  })

  useEffect(() => {
    if (!recording) return
    window.__annotatedTypeAsk = async (text: string) => {
      setOpen(true)
      setMessages([])
      setDraft('')
      let next = ''
      for (const char of text) {
        next += char
        setDraft(next)
        setCaret(next.length)
        await new Promise((resolve) => window.setTimeout(resolve, 46))
      }
    }
    window.__annotatedSubmitAsk = async () => {
      const question = draftRef.current.trim()
      if (!question) return
      setOpen(true)
      setBusy(true)
      setDraft('')
      setCaret(0)
      const user: ChatTurn = {
        id: 'tour-question',
        role: 'user',
        text: question,
        contextLabel: 'Pricing review with Northwind',
      }
      setMessages([user])
      const input = askRef.current
      const result = await Promise.race([
        completeAsk({
          question,
          writerId: input.writerId,
          hasWriterKey: input.hasWriterKey,
          focus: input.focus,
          rows: input.rows,
          folders: input.folders,
          upcoming: input.upcoming,
        }),
        new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 1500)),
      ])
      const usable =
        result != null &&
        result.ok &&
        !/not linked|not built|not ready|api key|empty reply/i.test(result.text)
      const text = usable ? result.text : demoAsk.answer
      const pulls = usable && result.pulls.length ? result.pulls : demoAsk.pulls
      const words = text.split(/(\s+)/)
      let built = ''
      for (const word of words) {
        built += word
        setMessages([user, { id: 'tour-answer', role: 'assistant', text: built }])
        await new Promise((resolve) => window.setTimeout(resolve, 28))
      }
      setMessages([user, { id: 'tour-answer', role: 'assistant', text, pulls }])
      setBusy(false)
    }
    return () => {
      delete window.__annotatedTypeAsk
      delete window.__annotatedSubmitAsk
    }
  }, [recording])

  const focusMeetingId = focus.page === 'notes' ? focus.meetingId : null
  if (focusMeetingId && focusMeetingId !== pinnedFocusId) {
    setPinnedFocusId(focusMeetingId)
    setTags((current) =>
      current.meetingIds.includes(focusMeetingId)
        ? current
        : { ...current, meetingIds: [focusMeetingId, ...current.meetingIds] },
    )
  }
  const writer = engineById(writerId) ?? engineById(engineDefaults.writer)
  const you = profileInitials(userName)
  const mention = pickerOpen || mentionHeld ? null : activeMention(draft, caret)
  const mentionKey = mention ? `${mention.kind}:${mention.query}` : ''
  const mentionItems = mention ? listMentions({ kind: mention.kind, query: mention.query, rows, folders, tags }) : []
  const safeMentionIndex = mentionItems.length
    ? (mentionCursor.key === mentionKey ? mentionCursor.index : 0) % mentionItems.length
    : 0
  const taggedMeetings = useMemo(
    () => tags.meetingIds.map((id) => rows.find((row) => row.id === id)).filter((row): row is MeetingRow => Boolean(row)),
    [rows, tags.meetingIds],
  )
  const chips = useMemo(() => {
    const list: { kind: MentionKind; id: string; label: string; meeting?: MeetingRow }[] = []
    for (const id of tags.skillIds) {
      const skill = skillById(id)
      if (skill) list.push({ kind: 'skill', id, label: skill.name })
    }
    for (const name of tags.people) list.push({ kind: 'person', id: name, label: name })
    for (const id of tags.projectIds) {
      const folder = folders.find((item) => item.id === id)
      if (folder) list.push({ kind: 'project', id, label: folder.name })
    }
    for (const meeting of taggedMeetings) list.push({ kind: 'meeting', id: meeting.id, label: meeting.title, meeting })
    return list
  }, [folders, taggedMeetings, tags.people, tags.projectIds, tags.skillIds])
  const pickerRows = useMemo(() => {
    const needle = pickerQuery.trim().toLowerCase()
    return rows
      .filter((row) => !tags.meetingIds.includes(row.id))
      .filter((row) => {
        if (!needle) return true
        return (
          row.title.toLowerCase().includes(needle) ||
          row.people.some((person) => person.toLowerCase().includes(needle)) ||
          row.topics.some((topic) => topic.toLowerCase().includes(needle))
        )
      })
      .slice(0, 8)
  }, [pickerQuery, rows, tags.meetingIds])
  const draftBody = (mention ? dropActiveMention(draft, mention).text : draft).trim()
  const canSend = (Boolean(draftBody) || tags.skillIds.length > 0) && !busy
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
  const contextNow = chips.length
    ? chips.map((chip) => `${mentionMeta(chip.kind).trigger}${chip.label}`).join(' · ')
    : pageHint

  useEffect(() => {
    if (!open || hidden) return
    function onKey(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        if (mention) {
          setMentionHeld(true)
          return
        }
        if (pickerOpen) {
          setPickerOpen(false)
          setPickerQuery('')
          return
        }
        setOpen(false)
        inputRef.current?.blur()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, pickerOpen, hidden, mention])

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
    node.style.height = `${Math.min(Math.max(node.scrollHeight, open ? 44 : 16), max)}px`
    const pos = pendingCaret.current
    if (pos == null) return
    pendingCaret.current = null
    node.focus()
    node.setSelectionRange(pos, pos)
  }, [draft, open])

  function expand() {
    if (!open) setOpen(true)
  }

  function collapse() {
    setOpen(false)
    setPickerOpen(false)
    setPickerQuery('')
    inputRef.current?.blur()
  }

  function addTag(id: string) {
    setTags((current) => withMention(current, { kind: 'meeting', id, label: id, detail: '', trigger: '$' }))
    setPickerOpen(false)
    setPickerQuery('')
    window.setTimeout(() => inputRef.current?.focus(), 0)
  }

  function removeChip(kind: MentionKind, id: string) {
    setTags((current) => withoutMention(current, kind, id))
  }

  function readCaret(node: HTMLTextAreaElement) {
    setCaret(node.selectionStart ?? 0)
  }

  function pickMention(item: MentionItem) {
    const here = inputRef.current?.selectionStart ?? caret
    const active = activeMention(draft, here)
    if (active) {
      const next = dropActiveMention(draft, active)
      pendingCaret.current = next.caret
      setDraft(next.text)
      setCaret(next.caret)
    }
    setTags((current) => withMention(current, item))
    setMentionHeld(false)
    setPickerOpen(false)
    window.setTimeout(() => inputRef.current?.focus(), 0)
  }

  function clearThread() {
    setMessages([])
    setDraft('')
    setCaret(0)
    setMentionHeld(false)
    window.setTimeout(() => inputRef.current?.focus(), 0)
  }

  function insertTrigger(trigger: MentionTrigger) {
    const here = inputRef.current?.selectionStart ?? caret
    const active = activeMention(draft, here)
    const base = active ? dropActiveMention(draft, active) : { text: draft, caret: here }
    const before = base.text.slice(0, base.caret)
    const after = base.text.slice(base.caret)
    const lead = before.length > 0 && !/\s$/.test(before) ? ' ' : ''
    const next = `${before}${lead}${trigger}${after}`
    const pos = before.length + lead.length + 1
    pendingCaret.current = pos
    setDraft(next)
    setCaret(pos)
    setMentionHeld(false)
    setPickerOpen(false)
    setOpen(true)
  }

  function openTarget(meetingId: string, utteranceId?: string) {
    collapse()
    onOpenMeeting(meetingId, utteranceId)
  }

  async function copyThread() {
    const text = messages
      .map((message) => `${message.role === 'user' ? 'You' : 'annotated'}: ${message.text}`)
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
    const skillLead = tags.skillIds
      .map((id) => skillById(id)?.name)
      .filter((name): name is string => Boolean(name))
      .join(', ')
    const text = draftBody || skillLead
    if (!text || busy) return
    setOpen(true)
    setPickerOpen(false)
    setMentionHeld(false)
    const user: ChatTurn = {
      id: `u-${Date.now()}`,
      role: 'user',
      text,
      contextLabel: contextNow,
    }
    setMessages((current) => [...current, user])
    setDraft('')
    setCaret(0)
    setBusy(true)

    const result = await completeAsk({
      question: text,
      writerId,
      hasWriterKey,
      focus,
      rows,
      folders,
      upcoming,
      tags,
    })

    const reply: ChatTurn = {
      id: `a-${Date.now()}`,
      role: 'assistant',
      text: result.ok ? result.text : result.message,
      pulls: result.pulls,
    }
    setMessages((current) => [...current, reply])
    setBusy(false)
    window.setTimeout(() => inputRef.current?.focus(), 0)
  }

  function onComposerKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (mention && mentionItems.length) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        const delta = event.key === 'ArrowDown' ? 1 : -1
        setMentionCursor({
          key: mentionKey,
          index: (safeMentionIndex + delta + mentionItems.length) % mentionItems.length,
        })
        return
      }
      if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Tab') {
        event.preventDefault()
        const item = mentionItems[safeMentionIndex]
        if (item) pickMention(item)
        return
      }
    }
    if (event.key === 'Escape' && mention) {
      event.preventDefault()
      event.stopPropagation()
      setMentionHeld(true)
      return
    }
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
      {open && chips.length ? (
        <div className="float-ask-chips">
          {chips.map((chip) => {
            const meeting = chip.meeting
            return (
              <span key={`${chip.kind}-${chip.id}`} className="float-ask-chip" title={chip.label}>
                {chip.kind === 'meeting' && meeting ? (
                  <button
                    type="button"
                    className="float-ask-chip-main"
                    aria-label={`Open ${meeting.title}`}
                    onClick={(event) => {
                      event.stopPropagation()
                      openTarget(meeting.id)
                    }}
                  >
                    <span className="float-ask-faces" aria-hidden="true">
                      {chipPeople(meeting).map((person, index) => (
                        <span key={`${person}-${index}`} className={index === 0 ? 'float-ask-face' : 'float-ask-face alt'}>
                          {personInitials(person)}
                        </span>
                      ))}
                    </span>
                    <span className="float-ask-chip-label">{chipLabel(meeting)}</span>
                  </button>
                ) : (
                  <span className="float-ask-chip-main static">
                    <span className="float-ask-chip-mark" aria-hidden="true">
                      {mentionMeta(chip.kind).trigger}
                    </span>
                    <span className="float-ask-chip-label">{chip.label}</span>
                  </span>
                )}
                <button
                  type="button"
                  className="float-ask-chip-x"
                  aria-label={`Remove ${chip.label}`}
                  onClick={(event) => {
                    event.stopPropagation()
                    removeChip(chip.kind, chip.id)
                  }}
                >
                  ×
                </button>
              </span>
            )
          })}
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
        onChange={(event) => {
          const value = event.target.value
          const nextCaret = event.target.selectionStart ?? value.length
          setDraft(value)
          setCaret(nextCaret)
          setMentionHeld(false)
          if (activeMention(value, nextCaret)) {
            setOpen(true)
            setPickerOpen(false)
          }
        }}
        onFocus={(event) => {
          expand()
          readCaret(event.currentTarget)
          setMentionHeld((held) => (held ? false : held))
        }}
        onBlur={() => {
          if (activeMention(draft, inputRef.current?.selectionStart ?? caret)) setMentionHeld(true)
        }}
        onKeyDown={onComposerKey}
        onKeyUp={(event) => readCaret(event.currentTarget)}
        onClick={(event) => readCaret(event.currentTarget)}
        onSelect={(event) => readCaret(event.currentTarget)}
        placeholder={open ? 'Ask, or tag with @ # / $' : 'Ask anything'}
        autoComplete="off"
        disabled={busy}
        aria-expanded={open}
        aria-autocomplete={mention ? 'list' : 'none'}
        aria-controls={mention ? mentionListId : open ? panelId : undefined}
        aria-activedescendant={mention && mentionItems[safeMentionIndex] ? `${mentionListId}-opt-${safeMentionIndex}` : undefined}
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
                setMentionHeld(true)
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

      {open && mention ? (
        <MentionMenu
          id={mentionListId}
          mention={mention}
          items={mentionItems}
          activeIndex={safeMentionIndex}
          onPick={pickMention}
        />
      ) : open && pickerOpen ? (
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
          aria-label={open ? 'Ask annotated' : undefined}
        >
          {composer}
          {open ? (
            <header className="float-ask-head">
              <div className="float-ask-brand">
                <h2 className="float-ask-title">Ask</h2>
                <span
                  className="float-ask-private"
                  title={
                    engineAvailable() && writer?.textLeavesDevice
                      ? `${writer.name} sends the question and the tagged notes off this PC.`
                      : 'Drawn from your notes on this PC.'
                  }
                >
                  {engineAvailable() && writer?.textLeavesDevice ? 'Cloud' : 'On this PC'}
                </span>
              </div>
              <div className="float-ask-head-actions">
                {messages.length ? (
                  <button type="button" className="float-ask-head-btn" onClick={clearThread}>
                    New chat
                  </button>
                ) : null}
                {messages.length ? (
                  <button type="button" className="float-ask-head-btn" onClick={() => void copyThread()}>
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                ) : null}
                <button type="button" className="float-ask-icon" onClick={collapse} aria-label="Close" title="Close">
                  ×
                </button>
              </div>
            </header>
          ) : null}

          {open ? (
            <div className="float-ask-thread" ref={scrollerRef}>
              {messages.length === 0 && !busy ? (
                <div className="float-ask-empty">
                  <p className="float-ask-empty-lead">Ask about your notes. These keys tell the answer what to use.</p>
                  <ul className="float-ask-keys">
                    {MENTION_GUIDE.map((item) => (
                      <li key={item.trigger}>
                        <button type="button" className="float-ask-key" onClick={() => insertTrigger(item.trigger)}>
                          <span className="float-ask-mention-key" aria-hidden="true">
                            {item.trigger}
                          </span>
                          <span className="float-ask-key-copy">
                            <strong>{item.title}</strong>
                            <small>{item.text}</small>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                  <p className="float-ask-key-label">Or start with a question</p>
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
                      {message.pulls?.length ? (
                        <div className="float-ask-pulls">
                          <p>
                            {message.pulls.length} {message.pulls.length === 1 ? 'line' : 'lines'}
                          </p>
                          {message.pulls.map((pull) => (
                            <button
                              key={pull.id}
                              type="button"
                              className="float-ask-pull"
                              onClick={() => openTarget(pull.meetingId, pull.utteranceId)}
                            >
                              <time>{pull.at ?? 'Notes'}</time>
                              <span>
                                <strong>
                                  {pull.speaker ? `${pull.speaker} · ` : ''}
                                  {pull.meetingTitle}
                                </strong>
                                <small>{pull.text}</small>
                              </span>
                            </button>
                          ))}
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
                      <button
                        type="button"
                        className="float-ask-trace-chip"
                        onClick={() => openTarget(taggedMeetings[0].id)}
                      >
                        {taggedMeetings[0].title}
                      </button>
                    </div>
                  ) : chips[0] ? (
                    <div className="float-ask-trace-row">
                      <EyeIcon />
                      <span>Using</span>
                      <span className="float-ask-trace-chip">
                        {mentionMeta(chips[0].kind).trigger}
                        {chips[0].label}
                      </span>
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
