import { useEffect, useRef, useState } from 'react'
import type { CalendarEvent } from './features/calendar/ics'
import { dismiss, onCalendarStart, resetCalendar, setActiveMeeting } from './features/calendar/store'
import { clearDeskStorage } from './lib/storage'
import { setIndexedNotes } from './features/desk/notesIndex'
import { disableDemoSeed, demoForced } from './features/desk/demoSeed'
import { deleteMeeting, loadDesk, saveFolders } from './features/desk/store'
import type { MeetingRow, ProjectAccent, ProjectFolder } from './ui/fixtures'
import { CalendarIcon, DownloadIcon, FolderIcon, GearIcon, HomeIcon, LiveIcon, LogoMark, MicIcon, PlugIcon, ShortcutIcon } from './ui/icons'
import { CalendarScreen } from './ui/CalendarScreen'
import { McpScreen } from './ui/McpScreen'
import { ProjectsScreen } from './ui/ProjectsScreen'
import { Onboarding } from './ui/Onboarding'
import { emptyProfile, profileInitials, readProfile, writeProfile, type Profile } from './ui/profile'
import { SettingsDialog } from './ui/SettingsScreen'
import { ShortcutsScreen } from './ui/ShortcutsScreen'
import { useSettingsState, type SettingsSection } from './ui/settingsState'
import { eventMatchesChord } from './ui/shortcuts'
import { useLicense } from './ui/useLicense'
import { useUpdates } from './ui/useUpdates'
import type { AskFocus } from './features/ask/context'
import { DictatePopup } from './ui/DictatePopup'
import { DictateScreen } from './ui/DictateScreen'
import { FloatingAsk } from './ui/FloatingAsk'
import { LandingPage } from './ui/LandingPage'
import { LiveScreen } from './ui/LiveScreen'
import { MeetingsScreen, StartAsk } from './ui/MeetingsScreen'
import { NotesScreen } from './ui/NotesScreen'
import { useCalendarClock } from './ui/useCalendar'
import './App.css'

type View =
  | { name: 'list' }
  | { name: 'live'; fresh: boolean; title?: string; instanceKey?: string; meetingId?: string }
  | { name: 'dictate' }
  | { name: 'notes'; id: string }
  | { name: 'calendar' }
  | { name: 'shortcuts' }
  | { name: 'projects' }
  | { name: 'connect' }

type Section = 'meetings' | 'live' | 'dictate' | 'calendar' | 'shortcuts' | 'projects' | 'connect'

function askFocusFor(view: View): AskFocus {
  switch (view.name) {
    case 'notes':
      return { page: 'notes', meetingId: view.id }
    case 'live':
      return { page: 'live', title: view.title }
    case 'list':
      return { page: 'list' }
    case 'dictate':
      return { page: 'dictate' }
    case 'calendar':
      return { page: 'calendar' }
    case 'projects':
      return { page: 'projects' }
    case 'shortcuts':
      return { page: 'shortcuts' }
    case 'connect':
      return { page: 'connect' }
  }
}

export default function App() {
  const [rows, setRows] = useState<MeetingRow[]>([])
  const [notesById, setNotesById] = useState<Record<string, import('./ui/fixtures').RichNotes>>({})
  const [folders, setFolders] = useState<ProjectFolder[]>([])
  const [deskReady, setDeskReady] = useState(false)
  const [view, setView] = useState<View>({ name: 'list' })
  const settings = useSettingsState()
  const license = useLicense()
  const update = useUpdates()
  const { calendar, upcoming, due, now } = useCalendarClock()
  const [settingsOpen, setSettingsOpen] = useState<SettingsSection | null>(null)
  const [gearSpin, setGearSpin] = useState(false)
  const [profile, setProfile] = useState(readProfile)
  const [setupOpen, setSetupOpen] = useState(() => !readProfile().onboarded)
  const [searchNonce, setSearchNonce] = useState(0)
  const [dictateOpen, setDictateOpen] = useState(false)
  const [noteJump, setNoteJump] = useState<{ meetingId: string; utteranceId?: string; nonce: number } | null>(null)
  const [marketing, setMarketing] = useState(() => {
    if (typeof window === 'undefined') return false
    if (window.crunchcall) return false
    return window.location.hash !== '#app'
  })
  const desktop = typeof window !== 'undefined' && Boolean(window.crunchcall)
  const person = profile.name.trim()

  useEffect(() => {
    if (!desktop) return
    window.crunchcall?.setChrome?.(settings.resolvedTheme).catch(() => {})
  }, [desktop, settings.resolvedTheme])

  useEffect(() => {
    // The desktop window opens on the app. A browser without #app gets the
    // marketing page, and Open the app moves into the product.
    if (!window.crunchcall) return
    if (window.location.hash !== '#app') history.replaceState({ surface: 'app' }, '', '#app')
  }, [])

  useEffect(() => {
    const api = window.crunchcall
    if (!api?.onAppCommand) return
    return api.onAppCommand((command) => {
      if (command === 'updates') return
      if (setupOpen) return
      setMarketing(false)
      setSettingsOpen(command === 'settings' ? 'listening' : null)
      if (window.location.hash !== '#app') history.pushState({ surface: 'app' }, '', '#app')
      if (command === 'dashboard') setView({ name: 'list' })
      else if (command === 'meeting') setView({ name: 'live', fresh: true })
      else if (command === 'calendar') setView({ name: 'calendar' })
      else if (command === 'projects') setView({ name: 'projects' })
    })
  }, [setupOpen])

  useEffect(() => {
    return onCalendarStart(() => {
      setMarketing(false)
      setSettingsOpen(null)
      if (window.location.hash !== '#app') history.pushState({ surface: 'app' }, '', '#app')
      setView((current) => (current.name === 'live' ? current : { name: 'list' }))
    })
  }, [])

  useEffect(() => {
    setActiveMeeting(view.name === 'live' ? (view.instanceKey ?? null) : null)
  }, [view])

  useEffect(() => {
    function onPop() {
      setSettingsOpen(null)
      if (!desktop && window.location.hash !== '#app') {
        setMarketing(true)
        return
      }
      setMarketing(false)
      setView({ name: 'list' })
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [desktop])

  function saveProfile(next: Profile) {
    const saved = { ...next, name: next.name.slice(0, 48), onboarded: profile.onboarded }
    writeProfile(saved)
    setProfile(saved)
  }

  function finishSetup(next: Profile, destination?: 'home' | 'connect') {
    const done = { ...next, name: next.name.trim().slice(0, 48), onboarded: true }
    writeProfile(done)
    setProfile(done)
    setSetupOpen(false)
    setSettingsOpen(null)
    if (destination === 'connect') setView({ name: 'connect' })
    else setView({ name: 'list' })
  }

  function runSetup() {
    setSettingsOpen(null)
    setSetupOpen(true)
  }

  async function refreshDesk() {
    const desk = await loadDesk()
    setRows(desk.rows)
    setNotesById(desk.notes)
    setFolders(desk.folders)
    setIndexedNotes(desk.notes)
    setDeskReady(true)
    if (demoForced() || desk.rows.length > 0) {
      const next = readProfile()
      setProfile(next)
      if (next.onboarded) setSetupOpen(false)
    }
  }

  useEffect(() => {
    void refreshDesk()
  }, [])

  const deepLinkDone = useRef(false)
  useEffect(() => {
    if (deepLinkDone.current || !deskReady || rows.length === 0) return
    let params: URLSearchParams
    try {
      const search = new URLSearchParams(window.location.search)
      const hash = window.location.hash
      const hashQuery = hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : ''
      params = new URLSearchParams(search.toString() || hashQuery)
    } catch {
      return
    }
    const screen = params.get('view')
    const meetingId = params.get('meeting') || params.get('id')
    if (!screen) {
      deepLinkDone.current = true
      return
    }
    deepLinkDone.current = true
    // Consume the deep link once so later desk refreshes do not yank the view back.
    const url = new URL(window.location.href)
    url.searchParams.delete('view')
    url.searchParams.delete('meeting')
    url.searchParams.delete('id')
    history.replaceState({ surface: 'app' }, '', `${url.pathname}${url.search}#app`)
    setMarketing(false)
    setSetupOpen(false)
    if (screen === 'live') {
      const live = rows.find((item) => item.id === (meetingId || 'live-product')) ?? rows.find((item) => item.status === 'live')
      if (live) setView({ name: 'live', fresh: false, title: live.title, meetingId: live.id })
      else setView({ name: 'live', fresh: true })
      return
    }
    if (screen === 'notes' && meetingId) {
      setView({ name: 'notes', id: meetingId })
    }
  }, [deskReady, rows])

  useEffect(() => {
    setIndexedNotes(notesById)
  }, [notesById])

  useEffect(() => {
    if (!deskReady) return
    void saveFolders(folders)
  }, [folders, deskReady])

  async function restoreApp() {
    settings.reset()
    resetCalendar()
    clearDeskStorage()
    disableDemoSeed()
    const desk = await loadDesk()
    for (const row of desk.rows) await deleteMeeting(row.id)
    await saveFolders([])
    try {
      localStorage.removeItem('crunchcall.desk.v1')
      localStorage.removeItem('crunchcall.folders')
      localStorage.removeItem('crunchcall.dictations')
    } catch {
      /* storage still cleared for this session */
    }
    const blank = emptyProfile()
    writeProfile(blank)
    setProfile(blank)
    setRows([])
    setNotesById({})
    setFolders([])
    setSettingsOpen(null)
    setView({ name: 'list' })
    setSetupOpen(true)
  }

  function openMeeting(id: string) {
    const meeting = rows.find((item) => item.id === id)
    if (!meeting) return
    setSettingsOpen(null)
    setNoteJump(null)
    setView(
      meeting.status === 'live'
        ? { name: 'live', fresh: false, title: meeting.title, meetingId: meeting.id }
        : { name: 'notes', id },
    )
  }

  function openFromAsk(meetingId: string, utteranceId?: string) {
    const meeting = rows.find((item) => item.id === meetingId)
    if (!meeting) return
    setSettingsOpen(null)
    if (meeting.status === 'live') {
      setNoteJump(null)
      setView({ name: 'live', fresh: false, title: meeting.title, meetingId: meeting.id })
      return
    }
    setNoteJump({ meetingId, utteranceId, nonce: Date.now() })
    setView({ name: 'notes', id: meetingId })
  }

  function fileMeeting(meetingId: string, folderId: string) {
    setFolders((current) =>
      current.map((folder) => {
        const meetingIds = folder.meetingIds.filter((id) => id !== meetingId)
        if (folder.id !== folderId) return { ...folder, meetingIds }
        return { ...folder, meetingIds: [...meetingIds, meetingId] }
      }),
    )
  }

  function addFolder(name: string): string {
    const id = `folder-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'new'}-${folders.length + 1}`
    const accents: ProjectAccent[] = ['green', 'blue', 'violet', 'amber', 'rose', 'slate']
    setFolders((current) => [
      ...current,
      {
        id,
        name,
        blurb: 'A new folder on the desk. File meetings here as they land.',
        accent: accents[current.length % accents.length],
        meetingIds: [],
      },
    ])
    return id
  }

  function openLive() {
    const live = rows.find((item) => item.status === 'live')
    setView(
      live
        ? { name: 'live', fresh: false, title: live.title, meetingId: live.id }
        : { name: 'live', fresh: false },
    )
  }

  useEffect(() => {
    function typing(target: EventTarget | null) {
      if (!(target instanceof HTMLElement)) return false
      const tag = target.tagName
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
    }

    function go(next: View) {
      setSettingsOpen(null)
      setView(next)
    }

    const actions: Record<string, () => void> = {
      'nav.home': () => go({ name: 'list' }),
      'nav.live': () => {
        setSettingsOpen(null)
        const live = rows.find((item) => item.status === 'live')
        setView({ name: 'live', fresh: !live, title: live?.title, meetingId: live?.id })
      },
      'nav.dictate': () => go({ name: 'dictate' }),
      'nav.search': () => {
        setSearchNonce((current) => current + 1)
        go({ name: 'projects' })
      },
      'nav.calendar': () => go({ name: 'calendar' }),
      'nav.projects': () => go({ name: 'projects' }),
      'nav.shortcuts': () => go({ name: 'shortcuts' }),
      'nav.connect': () => go({ name: 'connect' }),
      'meeting.new': () => go({ name: 'live', fresh: true }),
      'settings.listening': () => setSettingsOpen('listening'),
      'settings.speech': () => setSettingsOpen('speech'),
      'settings.notes': () => setSettingsOpen('notes'),
      'settings.machine': () => setSettingsOpen('machine'),
    }

    function onKey(event: KeyboardEvent) {
      if (setupOpen || marketing) return
      if (event.defaultPrevented) return
      if (typing(event.target)) return

      for (const [id, run] of Object.entries(actions)) {
        const chord = settings.shortcuts[id as keyof typeof settings.shortcuts]
        if (!chord || id === 'dictate.global') continue
        if (!eventMatchesChord(event, chord)) continue
        event.preventDefault()
        run()
        return
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [rows, setupOpen, marketing, settings.shortcuts])

  async function removeMeeting(id: string) {
    await deleteMeeting(id)
    setRows((current) => current.filter((item) => item.id !== id))
    setFolders((current) => current.map((folder) => ({ ...folder, meetingIds: folder.meetingIds.filter((item) => item !== id) })))
    if (view.name === 'notes' && view.id === id) setView({ name: 'list' })
  }

  function beginFromCalendar(event: CalendarEvent, fromPrompt: boolean) {
    if (fromPrompt) dismiss(event.instanceKey)
    setMarketing(false)
    setSettingsOpen(null)
    if (window.location.hash !== '#app') history.pushState({ surface: 'app' }, '', '#app')
    setView({ name: 'live', fresh: true, title: event.title, instanceKey: event.instanceKey })
  }

  function openFromLanding(next?: 'list' | 'live' | 'settings') {
    if (window.location.hash !== '#app') history.pushState({ surface: 'app' }, '', '#app')
    setMarketing(false)
    setSettingsOpen(next === 'settings' ? 'listening' : null)
    if (next === 'live') setView({ name: 'live', fresh: true })
    else setView({ name: 'list' })
  }

  if (marketing) return <LandingPage onOpenApp={openFromLanding} />

  const section: Section =
    view.name === 'live' ||
    view.name === 'dictate' ||
    view.name === 'calendar' ||
    view.name === 'shortcuts' ||
    view.name === 'projects' ||
    view.name === 'connect'
      ? view.name
      : 'meetings'
  const notesMeeting = view.name === 'notes' ? rows.find((item) => item.id === view.id) : undefined

  return (
    <div className="app">
      <aside className="side">
        <button
          type="button"
          className="brand"
          onClick={() => {
            setSettingsOpen(null)
            setView({ name: 'list' })
          }}
        >
          <LogoMark />
          <span>annotated</span>
        </button>
        <nav className="nav" aria-label="Primary">
          <button
            type="button"
            className={section === 'meetings' ? 'nav-item on' : 'nav-item'}
            onClick={() => {
              setSettingsOpen(null)
              setView({ name: 'list' })
            }}
          >
            <HomeIcon />
            <span>Home</span>
          </button>
          <button
            type="button"
            className={section === 'live' ? 'nav-item on' : 'nav-item'}
            onClick={() => {
              setSettingsOpen(null)
              openLive()
            }}
          >
            <LiveIcon />
            <span>Live</span>
          </button>
          <button
            type="button"
            className={section === 'dictate' ? 'nav-item on' : 'nav-item'}
            onClick={() => {
              setSettingsOpen(null)
              setView({ name: 'dictate' })
            }}
          >
            <MicIcon />
            <span>Dictate</span>
          </button>
          <div className="nav-rule" />
          <button
            type="button"
            className={section === 'calendar' ? 'nav-item on' : 'nav-item'}
            onClick={() => {
              setSettingsOpen(null)
              setView({ name: 'calendar' })
            }}
          >
            <CalendarIcon />
            <span>Calendar</span>
          </button>
          <button
            type="button"
            className={section === 'projects' ? 'nav-item on' : 'nav-item'}
            onClick={() => {
              setSettingsOpen(null)
              setView({ name: 'projects' })
            }}
          >
            <FolderIcon />
            <span>Projects</span>
          </button>
          <button
            type="button"
            className={section === 'shortcuts' ? 'nav-item on' : 'nav-item'}
            onClick={() => {
              setSettingsOpen(null)
              setView({ name: 'shortcuts' })
            }}
          >
            <ShortcutIcon />
            <span>Shortcuts</span>
          </button>
        </nav>
        <div className="side-foot">
          <div className={update.ready ? 'foot-connect has-update' : 'foot-connect'}>
          <button
            type="button"
            className="local-card connect-card"
            aria-current={section === 'connect' ? 'page' : undefined}
            onClick={() => {
              setSettingsOpen(null)
              setView({ name: 'connect' })
            }}
          >
            <span className="connect-card-head">
              <PlugIcon />
              <p className="local-title">Connect</p>
            </span>
            <p>Claude, Cursor, and others can read notes. Local and read-only.</p>
          </button>
          {update.ready ? (
            <button
              type="button"
              className="update-download"
              onClick={update.install}
              disabled={update.phase === 'downloading' || update.phase === 'downloaded'}
            >
              <DownloadIcon />
              <span>
                {update.phase === 'downloading'
                  ? `Downloading ${update.percent}%`
                  : update.phase === 'downloaded'
                    ? 'Installing…'
                    : 'Download update'}
              </span>
            </button>
          ) : null}
          </div>
          <div className="whoami">
            <span className="avatar" aria-hidden="true">
              {person ? profileInitials(person) : 'C'}
            </span>
            <span className="whoami-id">
              <strong title={person || undefined}>{person || 'This PC'}</strong>
              <small>Local</small>
            </span>
            <button
              type="button"
              className="gear-btn"
              aria-label="Settings"
              aria-haspopup="dialog"
              aria-expanded={settingsOpen !== null}
              onClick={() => {
                setGearSpin(true)
                setSettingsOpen((current) => (current ? null : 'listening'))
              }}
            >
              <GearIcon
                className={gearSpin ? 'gear-icon gear-icon--spin' : 'gear-icon'}
                onAnimationEnd={() => setGearSpin(false)}
              />
            </button>
          </div>
        </div>
      </aside>
      <div className="stage">
      <main className="content">
        <div className="content-scroller">
        {due && view.name !== 'list' && !(view.name === 'live' && view.instanceKey === due.instanceKey) ? (
          <StartAsk
            event={due}
            now={now}
            onDismiss={() => dismiss(due.instanceKey)}
            onStart={() => beginFromCalendar(due, true)}
          />
        ) : null}
        {view.name === 'list' ? (
          <MeetingsScreen
            rows={rows}
            onOpen={openMeeting}
            onRemove={removeMeeting}
            onNew={() => setView({ name: 'live', fresh: true })}
            calendarOn={calendar.enabled}
            calendarError={calendar.error}
            calendarEmpty={
              calendar.source ? 'Nothing coming up in the next two weeks.' : 'Connect Google or Outlook under Calendar, or add a private link.'
            }
            upcoming={upcoming}
            due={due}
            now={now}
            onStartCalendar={(event) => beginFromCalendar(event, event.instanceKey === due?.instanceKey)}
            onDismissCalendar={dismiss}
          />
        ) : null}
        {view.name === 'live' ? (
          <LiveScreen
            key={view.fresh ? `start-${view.instanceKey ?? view.title ?? 'new'}` : (view.meetingId ?? 'idle')}
            title={view.title}
            meetingId={view.meetingId}
            autoStart={view.fresh}
            speechId={settings.speechId}
            writerId={settings.writerId}
            coachId={settings.coachId}
            inputDevice={settings.input}
            language={settings.language}
            showCues={settings.showCues}
            showMeetingIndicator={settings.showMeetingIndicator}
            overlayOpacity={settings.overlayOpacity}
            overlayPosition={settings.overlayPosition}
            cues={settings.cues}
            unlocked={license.unlocked}
            onUnlock={() => setSettingsOpen('license')}
            hasWriterKey={Boolean(settings.savedKeys[settings.writerId])}
            onBack={() => {
              void refreshDesk()
              setView({ name: 'list' })
            }}
            onFinished={(id) => {
              void refreshDesk().then(() => setView({ name: 'notes', id }))
            }}
          />
        ) : null}
        {view.name === 'dictate' ? (
          <DictateScreen
            speechId={settings.speechId}
            chord={settings.shortcuts['dictate.global']}
            mode={settings.dictateMode}
          />
        ) : null}
        {view.name === 'notes' && notesMeeting ? (
          <NotesScreen
            key={notesMeeting.id}
            meeting={notesMeeting}
            notes={notesById[notesMeeting.id] ?? null}
            writerId={settings.writerId}
            hasWriterKey={Boolean(settings.savedKeys[settings.writerId])}
            unlocked={license.unlocked}
            onUnlock={() => setSettingsOpen('license')}
            folders={folders}
            folderId={folders.find((folder) => folder.meetingIds.includes(notesMeeting.id))?.id ?? ''}
            onFile={(folderId) => fileMeeting(notesMeeting.id, folderId)}
            onBack={() => setView({ name: 'list' })}
            onStart={() => setView({ name: 'live', fresh: true })}
            jumpNonce={noteJump && noteJump.meetingId === notesMeeting.id ? noteJump.nonce : 0}
            jumpLine={noteJump && noteJump.meetingId === notesMeeting.id ? noteJump.utteranceId : undefined}
          />
        ) : null}
        {view.name === 'calendar' ? <CalendarScreen onStart={(event) => beginFromCalendar(event, false)} /> : null}
        {view.name === 'shortcuts' ? (
          <ShortcutsScreen
            settings={settings}
            onHome={() => setView({ name: 'list' })}
            onNew={() => setView({ name: 'live', fresh: true })}
            onLive={openLive}
            onDictate={() => setView({ name: 'dictate' })}
            onSearch={() => {
              setSearchNonce((current) => current + 1)
              setView({ name: 'projects' })
            }}
            onCalendar={() => setView({ name: 'calendar' })}
            onProjects={() => setView({ name: 'projects' })}
            onConnect={() => setView({ name: 'connect' })}
            onSettings={(section) => setSettingsOpen(section)}
          />
        ) : null}
        {view.name === 'projects' ? (
          <ProjectsScreen
            rows={rows}
            folders={folders}
            onOpen={openMeeting}
            onAddFolder={addFolder}
            onNewMeeting={() => setView({ name: 'live', fresh: true })}
            searchNonce={searchNonce}
          />
        ) : null}
        {view.name === 'connect' ? <McpScreen /> : null}
        </div>
      </main>
      </div>
      {settingsOpen ? (
        <SettingsDialog
          section={settingsOpen}
          onSection={setSettingsOpen}
          onClose={() => setSettingsOpen(null)}
          settings={settings}
          name={profile.name}
          onName={(value) => saveProfile({ ...profile, name: value })}
          onRunSetup={runSetup}
          onRestore={restoreApp}
          license={license}
          onOpenHelp={() => {
            setSettingsOpen(null)
            setView({ name: 'shortcuts' })
          }}
        />
      ) : null}
      {setupOpen ? (
        <Onboarding
          profile={profile}
          replay={profile.onboarded}
          calendar={calendar}
          upcoming={upcoming}
          now={now}
          launchAtLogin={settings.launchAtLogin}
          onLaunchAtLogin={settings.setLaunchAtLogin}
          onSave={saveProfile}
          onFinish={finishSetup}
          onClose={() => setSetupOpen(false)}
        />
      ) : null}
      <DictatePopup
        speechId={settings.speechId}
        open={dictateOpen}
        onOpenChange={setDictateOpen}
        chord={settings.shortcuts['dictate.global']}
        mode={settings.dictateMode}
      />
      {!setupOpen ? (
        <FloatingAsk
          focus={askFocusFor(view)}
          rows={rows}
          folders={folders}
          upcoming={upcoming}
          writerId={settings.writerId}
          hasWriterKey={Boolean(settings.savedKeys[settings.writerId])}
          userName={person}
          hidden={settingsOpen !== null}
          onOpenSettings={setSettingsOpen}
          onOpenMeeting={openFromAsk}
        />
      ) : null}
    </div>
  )
}
