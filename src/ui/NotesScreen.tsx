import { useEffect, useState, type FormEvent } from 'react'
import { completeAsk } from '../features/ask/complete'
import { initials, type MeetingRow, type NoteAsk, type ProjectFolder, type RichNotes } from './fixtures'

type NotesScreenProps = {
  meeting: MeetingRow
  notes: RichNotes | null
  writerId: string
  hasWriterKey: boolean
  unlocked: boolean
  onUnlock: () => void
  folders: ProjectFolder[]
  folderId: string
  onFile: (folderId: string) => void
  onBack: () => void
  onStart: () => void
  /** Changes when Ask opens this meeting. `jumpLine` is the transcript row to show. */
  jumpNonce?: number
  jumpLine?: string
}

export function NotesScreen({
  meeting,
  notes,
  writerId,
  hasWriterKey,
  unlocked,
  onUnlock,
  folders,
  folderId,
  onFile,
  onBack,
  onStart,
  jumpNonce = 0,
  jumpLine,
}: NotesScreenProps) {
  const [tab, setTab] = useState<'notes' | 'transcript'>(jumpLine ? 'transcript' : 'notes')
  const [checked, setChecked] = useState<Set<string>>(() => new Set())
  const [messages, setMessages] = useState<NoteAsk[]>(() => notes?.ask ?? [])
  const [draft, setDraft] = useState('')
  const [copied, setCopied] = useState(false)
  const [highlight, setHighlight] = useState<string | null>(jumpLine ?? null)

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 1600)
    return () => window.clearTimeout(timer)
  }, [copied])

  useEffect(() => {
    if (!jumpNonce) return
    if (jumpLine) {
      setTab('transcript')
      setHighlight(jumpLine)
      return
    }
    setTab('notes')
  }, [jumpNonce, jumpLine])

  useEffect(() => {
    if (!highlight || tab !== 'transcript') return
    document.getElementById(`utt-${highlight}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [highlight, tab])

  async function copyMarkdown() {
    if (!notes) return
    try {
      await navigator.clipboard.writeText(notes.markdown)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  function toggleAction(id: string) {
    setChecked((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function openCite(utteranceId: string) {
    setTab('transcript')
    setHighlight(utteranceId)
  }

  async function sendAsk(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const text = draft.trim()
    if (!text || !notes) return
    const askId = `ask-${messages.length}`
    setMessages((current) => [...current, { id: askId, role: 'user', text }])
    setDraft('')
    const result = await completeAsk({
      question: text,
      writerId,
      hasWriterKey,
      focus: { page: 'notes', meetingId: meeting.id },
      rows: [meeting],
      folders,
      upcoming: [],
    })
    const reply: NoteAsk = {
      id: `reply-${askId}`,
      role: 'assistant',
      text: result.ok ? result.text : result.message,
    }
    setMessages((current) => [...current, reply])
  }

  return (
    <section aria-labelledby="notes-title">
      <div className="page-head">
        <div>
          <h1 id="notes-title" className="page-title">
            {meeting.title}
          </h1>
          <p className="lede">
            {meeting.when}
            <span aria-hidden="true"> · </span>
            {meeting.duration}
            <span aria-hidden="true"> · </span>
            {meeting.source}
          </p>
          <div className="notes-meta">
            {meeting.people.map((person) => (
              <span key={person} className="mini-person">
                <span className="mini-avatar" aria-hidden="true">
                  {initials(person)}
                </span>
                {person}
              </span>
            ))}
            {meeting.topics.map((topic) => (
              <span key={topic} className="mini-tag">
                {topic}
              </span>
            ))}
          </div>
        </div>
        <div className="head-actions">
          <label className="field file-folder">
            <span className="sr">Folder</span>
            <select value={folderId} onChange={(event) => onFile(event.target.value)} aria-label="File this note">
              <option value="">Unfiled</option>
              {folders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.name}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="btn ghost" onClick={onBack}>
            Meetings
          </button>
          {notes && unlocked ? (
            <button type="button" className="btn primary" onClick={() => void copyMarkdown()}>
              {copied ? 'Copied' : 'Copy Markdown'}
            </button>
          ) : null}
          {notes && !unlocked ? (
            <button type="button" className="btn ghost" onClick={onUnlock}>
              Unlock to copy
            </button>
          ) : null}
        </div>
      </div>

      {meeting.status === 'draft' ? (
        <div className="state-card">
          <h2>Nothing captured yet</h2>
          <p>Start it when the call does. annotated listens on this PC — it never joins as a guest.</p>
          <button type="button" className="btn primary" onClick={onStart}>
            Start meeting
          </button>
        </div>
      ) : null}

      {meeting.status === 'processing' ? (
        <div className="state-card">
          <h2>Writing notes on this PC</h2>
          <p>Pulling out the summary, takeaways, and owners. Audio stays on this machine.</p>
          <div className="bar" aria-hidden="true">
            <span />
          </div>
        </div>
      ) : null}

      {notes ? (
        <>
          <div className="tabs" role="tablist" aria-label="Meeting">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'notes'}
              className={tab === 'notes' ? 'tab on' : 'tab'}
              onClick={() => setTab('notes')}
            >
              Notes
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'transcript'}
              className={tab === 'transcript' ? 'tab on' : 'tab'}
              onClick={() => setTab('transcript')}
            >
              Transcript
            </button>
          </div>

          {tab === 'notes' ? (
            <div className="notes-layout">
              <div className="panel notes-body">
                <div className="block">
                  <h2>Summary</h2>
                  <p className="summary">{notes.summary}</p>
                </div>
                <div className="block">
                  <h2>Takeaways</h2>
                  <ul className="takeaways">
                    {notes.takeaways.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
                <div className="block">
                  <h2>Next steps</h2>
                  <ul className="actions">
                    {notes.actions.map((action) => {
                      const done = checked.has(action.id)
                      const gap = !action.owner || !action.due
                      return (
                        <li key={action.id} className={done ? 'action done' : 'action'}>
                          <button
                            type="button"
                            className={done ? 'check on' : 'check'}
                            aria-pressed={done}
                            aria-label={done ? `Mark not done: ${action.text}` : `Mark done: ${action.text}`}
                            onClick={() => toggleAction(action.id)}
                          >
                            <span aria-hidden="true">{done ? '✓' : ''}</span>
                          </button>
                          <div>
                            <p className="action-text">{action.text}</p>
                            <p className={gap ? 'action-meta gap' : 'action-meta'}>
                              {action.owner ?? 'Unassigned'}
                              <span aria-hidden="true"> · </span>
                              {action.due ?? 'No date'}
                            </p>
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                </div>
                <details className="md-preview">
                  <summary>Markdown preview</summary>
                  <pre>{notes.markdown}</pre>
                </details>
              </div>

              <aside className="panel ask" aria-label="Ask this meeting">
                <div className="panel-h">
                  <h2>Ask</h2>
                </div>
                <div className="bubbles">
                  {messages.map((message) => (
                    <div key={message.id} className={`bubble ${message.role}`}>
                      <p>{message.text}</p>
                      {message.cites?.map((cite) => (
                        <button
                          type="button"
                          key={cite.utteranceId}
                          className="cite"
                          onClick={() => openCite(cite.utteranceId)}
                        >
                          {cite.at}
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
                <form className="composer" onSubmit={sendAsk}>
                  <label className="sr" htmlFor="ask-input">
                    Ask about this meeting
                  </label>
                  <input
                    id="ask-input"
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    placeholder="Ask about this meeting"
                    autoComplete="off"
                  />
                  <button type="submit" className="btn primary small">
                    Send
                  </button>
                </form>
              </aside>
            </div>
          ) : (
            <section className="panel" aria-label="Transcript">
              <ol className="transcript">
                {notes.utterances.map((line) => (
                  <li
                    key={line.id}
                    id={`utt-${line.id}`}
                    className={
                      line.id === highlight
                        ? line.you
                          ? 'utter you on'
                          : 'utter on'
                        : line.you
                          ? 'utter you'
                          : 'utter'
                    }
                  >
                    <time>{line.at}</time>
                    <p>
                      <strong>{line.speaker}</strong>
                      <span>{line.text}</span>
                    </p>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </>
      ) : null}
    </section>
  )
}
