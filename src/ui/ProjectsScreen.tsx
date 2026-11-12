import { useEffect, useMemo, useRef, useState, type FormEvent, type RefObject } from 'react'
import { initials, statusLabel, type MeetingRow, type ProjectFolder } from './fixtures'
import { FolderIcon, PlusIcon, SearchIcon } from './icons'
import { peopleInNotes, searchMeetings, topicsInNotes, type SearchHit } from './search'

function escapePattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function Highlight({ text, query }: { text: string; query: string }) {
  const tokens = query.trim().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return <>{text}</>
  const pattern = new RegExp(`(${tokens.map(escapePattern).join('|')})`, 'gi')
  const parts = text.split(pattern)
  const lowerTokens = tokens.map((token) => token.toLowerCase())
  return (
    <>
      {parts.map((part, index) =>
        lowerTokens.includes(part.toLowerCase()) ? (
          <mark key={`${part}-${index}`}>{part}</mark>
        ) : (
          <span key={`${part}-${index}`}>{part}</span>
        ),
      )}
    </>
  )
}

function Avatar({ name }: { name: string }) {
  return (
    <span className="mini-avatar" aria-hidden="true">
      {initials(name)}
    </span>
  )
}

function peopleFor(meetings: MeetingRow[]): string[] {
  return [...new Set(meetings.flatMap((meeting) => meeting.people))].slice(0, 4)
}

function SearchField({
  value,
  onChange,
  onClear,
  inputRef,
}: {
  value: string
  onChange: (value: string) => void
  onClear: () => void
  inputRef: RefObject<HTMLInputElement | null>
}) {
  return (
    <label className="search desk-search">
      <SearchIcon />
      <span className="sr">Search notes</span>
      <input
        ref={inputRef}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Search notes"
        autoComplete="off"
      />
      {value ? (
        <button type="button" className="desk-clear" onClick={onClear}>
          Clear
        </button>
      ) : null}
    </label>
  )
}

function NoteCard({
  meeting,
  folderName,
  hit,
  query,
  onOpen,
}: {
  meeting: MeetingRow
  folderName?: string
  hit?: SearchHit
  query: string
  onOpen: (id: string) => void
}) {
  return (
    <button type="button" className="note-card" onClick={() => onOpen(meeting.id)}>
      <span className="note-card-top">
        <span className="note-card-when">
          {folderName ? (
            <>
              {folderName}
              <span aria-hidden="true"> · </span>
            </>
          ) : null}
          {meeting.when}
          <span aria-hidden="true"> · </span>
          {meeting.duration}
        </span>
        <span className={`pill pill-${meeting.status}`}>{statusLabel(meeting.status)}</span>
      </span>
      <strong className="note-card-title">
        <Highlight text={meeting.title} query={query} />
      </strong>
      <span className="note-card-preview">
        <Highlight text={meeting.preview} query={query} />
      </span>
      {hit ? (
        <span className="note-card-hit">
          <span>{hit.label}</span>
          <Highlight text={hit.text} query={query} />
        </span>
      ) : null}
      <span className="note-card-tags">
        {meeting.topics.map((topic) => (
          <span key={topic} className="mini-tag">
            <Highlight text={topic} query={query} />
          </span>
        ))}
      </span>
      <span className="note-card-foot">
        <span className="face-stack" aria-hidden="true">
          {meeting.people.slice(0, 3).map((person) => (
            <Avatar key={person} name={person} />
          ))}
        </span>
        <span className="note-card-people">{meeting.people.join(', ') || 'No one named yet'}</span>
        <span className="note-card-source">{meeting.source}</span>
      </span>
    </button>
  )
}

function FolderButton({
  folder,
  meetings,
  hit,
  onOpen,
}: {
  folder: ProjectFolder
  meetings: MeetingRow[]
  hit: string | null
  onOpen: () => void
}) {
  const people = peopleFor(meetings)
  return (
    <button type="button" className={`desk-folder accent-${folder.accent}`} onClick={onOpen}>
      <span className="folder-art" aria-hidden="true">
        <span className="folder-sheets">
          {meetings.slice(0, 3).map((meeting, index) => (
            <span key={meeting.id} className={`folder-sheet sheet-${index + 1}`}>
              {meeting.title}
            </span>
          ))}
        </span>
        <span className="folder-front">
          <FolderIcon />
          <span className="folder-count">
            {meetings.length} {meetings.length === 1 ? 'note' : 'notes'}
          </span>
        </span>
      </span>
      <span className="folder-copy">
        <span className="folder-name-row">
          <strong>{folder.name}</strong>
          <span aria-hidden="true">→</span>
        </span>
        <span className="folder-blurb">{folder.blurb}</span>
        {hit ? <span className="folder-hit">{hit}</span> : null}
        <span className="folder-people">
          <span className="face-stack" aria-hidden="true">
            {people.map((person) => (
              <Avatar key={person} name={person} />
            ))}
          </span>
          <span>{people.join(', ') || 'No one yet'}</span>
        </span>
      </span>
    </button>
  )
}

export function ProjectsScreen({
  rows,
  folders,
  onOpen,
  onAddFolder,
  onNewMeeting,
  searchNonce = 0,
}: {
  rows: MeetingRow[]
  folders: ProjectFolder[]
  onOpen: (id: string) => void
  onAddFolder: (name: string) => string
  onNewMeeting: () => void
  searchNonce?: number
}) {
  const [openId, setOpenId] = useState<string | null>(null)
  const [appliedNonce, setAppliedNonce] = useState(searchNonce)
  const [draft, setDraft] = useState('')
  const [query, setQuery] = useState('')
  const [naming, setNaming] = useState(false)
  if (appliedNonce !== searchNonce) {
    setAppliedNonce(searchNonce)
    setOpenId(null)
  }
  const folderInputRef = useRef<HTMLInputElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const filed = new Set(folders.flatMap((folder) => folder.meetingIds))
  const unfiled = rows.filter((row) => !filed.has(row.id))
  const unfiledFolder: ProjectFolder = {
    id: 'unfiled',
    name: 'Unfiled',
    blurb: 'Loose notes that have not found a project yet.',
    accent: 'slate',
    meetingIds: unfiled.map((row) => row.id),
  }
  const active =
    openId === 'unfiled' ? unfiledFolder : openId ? folders.find((folder) => folder.id === openId) : undefined
  const trimmed = query.trim()
  const results = useMemo(() => searchMeetings(rows, folders, query), [rows, folders, query])
  const resultById = useMemo(() => new Map(results.map((result) => [result.meeting.id, result])), [results])
  const people = useMemo(() => peopleInNotes(rows), [rows])
  const topics = useMemo(() => topicsInNotes(rows), [rows])

  useEffect(() => {
    if (!searchNonce) return
    searchRef.current?.focus()
  }, [searchNonce])

  useEffect(() => {
    if (!naming) return
    folderInputRef.current?.focus()
  }, [naming])

  function beginNaming() {
    if (naming) {
      folderInputRef.current?.focus()
      return
    }
    setNaming(true)
  }

  function cancelNaming() {
    setDraft('')
    setNaming(false)
  }

  function addFolder(event: FormEvent) {
    event.preventDefault()
    const name = draft.trim()
    if (!name) return
    const id = onAddFolder(name)
    setDraft('')
    setNaming(false)
    setQuery('')
    setOpenId(id)
  }

  function pick(value: string) {
    setQuery(value)
    setOpenId(null)
    searchRef.current?.focus()
  }

  const meetingsFor = (folder: ProjectFolder) =>
    folder.meetingIds.map((id) => rows.find((row) => row.id === id)).filter((row): row is MeetingRow => !!row)

  const search = (
    <SearchField value={query} onChange={setQuery} onClear={() => setQuery('')} inputRef={searchRef} />
  )

  const createFolder = naming ? (
    <form className="folder-create" onSubmit={addFolder}>
      <label className="field">
        <span className="sr">Folder name</span>
        <input
          ref={folderInputRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Folder name"
          autoComplete="off"
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return
            event.preventDefault()
            cancelNaming()
          }}
        />
      </label>
      <button type="button" className="btn ghost" onClick={cancelNaming}>
        Cancel
      </button>
      <button type="submit" className="btn primary" disabled={!draft.trim()}>
        Create
      </button>
    </form>
  ) : (
    <button type="button" className="btn ghost" onClick={beginNaming}>
      <PlusIcon />
      Create new folder
    </button>
  )

  if (active) {
    const meetings = meetingsFor(active)
    const listed = trimmed ? meetings.filter((meeting) => resultById.has(meeting.id)) : meetings
    return (
      <section className="projects-page" aria-labelledby="folder-title">
        <button type="button" className="crumb" onClick={() => setOpenId(null)}>
          ← All folders
        </button>

        <div className={`folder-view-head accent-${active.accent}`}>
          <span className="folder-view-icon" aria-hidden="true">
            <FolderIcon />
          </span>
          <div className="folder-view-copy">
            <h1 id="folder-title" className="page-title">
              {active.name}
            </h1>
            <p className="lede">{active.blurb}</p>
            <div className="folder-view-people">
              {peopleFor(meetings).map((person) => (
                <button key={person} type="button" className="mini-person person-jump" onClick={() => pick(person)}>
                  <Avatar name={person} />
                  {person}
                </button>
              ))}
            </div>
          </div>
          <div className="folder-view-stats">
            <strong>{listed.length}</strong>
            <span>{listed.length === 1 ? 'note' : 'notes'}</span>
          </div>
        </div>

        {search}

        {meetings.length === 0 ? (
          <div className="state-card folder-empty-state">
            <h2>This folder is empty</h2>
            <p>Open a note and file it into this folder. The folder is already waiting on the desk.</p>
            <button type="button" className="btn primary" onClick={onNewMeeting}>
              Start a meeting
            </button>
          </div>
        ) : listed.length === 0 ? (
          <div className="state-card folder-empty-state">
            <h2>Nothing in this folder matches</h2>
            <p>Try another person, topic, or next step. Clear the search to see every note in {active.name}.</p>
          </div>
        ) : (
          <div className="folder-notes">
            {listed.map((meeting) => (
              <NoteCard
                key={meeting.id}
                meeting={meeting}
                hit={resultById.get(meeting.id)?.hits[0]}
                query={trimmed}
                onOpen={onOpen}
              />
            ))}
          </div>
        )}
      </section>
    )
  }

  return (
    <section className="projects-page" aria-labelledby="projects-title">
      <div className="page-head projects-head">
        <h1 id="projects-title" className="page-title">
          Projects
        </h1>
        <div className="projects-bar">
          {search}
          {createFolder}
        </div>
      </div>

      <div className="desk">
        <div className="desk-caption">
          <p>
            {trimmed ? (
              <strong>
                {results.length} {results.length === 1 ? 'note' : 'notes'} match
              </strong>
            ) : (
              <>
                <strong>
                  {folders.length} {folders.length === 1 ? 'folder' : 'folders'}
                </strong>
                <span aria-hidden="true"> · </span>
                {filed.size} filed
                <span aria-hidden="true"> · </span>
                {unfiled.length} loose
              </>
            )}
          </p>
          <p className="muted">{trimmed ? 'On this PC only.' : 'Click a folder to open it.'}</p>
        </div>

        {!trimmed ? (
          <div className="desk-picks">
            <div className="desk-pick-row">
              <span className="desk-pick-label">People</span>
              <div className="desk-pick-scroll">
                {people.map((person) => (
                  <button key={person} type="button" className="desk-person" onClick={() => pick(person)}>
                    <Avatar name={person} />
                    {person}
                  </button>
                ))}
              </div>
            </div>
            <div className="desk-pick-row">
              <span className="desk-pick-label">Topics</span>
              <div className="desk-pick-scroll">
                {topics.map((topic) => (
                  <button key={topic} type="button" className="desk-topic" onClick={() => pick(topic)}>
                    {topic}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : null}

        {trimmed ? (
          results.length === 0 ? (
            <div className="state-card folder-empty-state">
              <h2>Nothing matched</h2>
              <p>Try a first name, a client, or a topic.</p>
              <div className="chip-cloud">
                {people.slice(0, 6).map((person) => (
                  <button key={person} type="button" className="filter" onClick={() => pick(person)}>
                    {person}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="folder-notes">
              {results.map((result) => (
                <NoteCard
                  key={result.meeting.id}
                  meeting={result.meeting}
                  folderName={result.project?.name ?? 'Unfiled'}
                  hit={result.hits[0]}
                  query={trimmed}
                  onOpen={onOpen}
                />
              ))}
            </div>
          )
        ) : (
          <div className="desk-grid">
            {folders.map((folder) => {
              const meetings = meetingsFor(folder)
              return (
                <FolderButton
                  key={folder.id}
                  folder={folder}
                  meetings={meetings}
                  hit={null}
                  onOpen={() => setOpenId(folder.id)}
                />
              )
            })}
            {unfiled.length > 0 ? (
              <FolderButton
                folder={unfiledFolder}
                meetings={unfiled}
                hit={null}
                onOpen={() => setOpenId('unfiled')}
              />
            ) : null}
            <button type="button" className="desk-folder desk-new" onClick={beginNaming}>
                <span className="new-folder-art" aria-hidden="true">
                  <PlusIcon />
                </span>
                <span className="folder-copy">
                  <span className="folder-name-row">
                    <strong>New folder</strong>
                  </span>
                  <span className="folder-blurb">Create one, then file meetings as they land.</span>
                </span>
              </button>
          </div>
        )}
      </div>
    </section>
  )
}
