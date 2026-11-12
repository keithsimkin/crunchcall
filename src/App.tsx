import { useEffect, useState } from 'react'
import type { CalendarEvent } from './features/calendar/ics'
import { dismiss, getState, onCalendarStart, resetCalendar, setActiveMeeting } from './features/calendar/store'
import { clearDeskStorage } from './lib/storage'
import { freshMeeting, listedMeetings, starterProjects, type MeetingRow, type ProjectAccent, type ProjectFolder } from './ui/fixtures'
import { CalendarIcon, FolderIcon, GearIcon, HomeIcon, LiveIcon, LogoMark, MicIcon, PlugIcon, ShortcutIcon } from './ui/icons'
import { CalendarScreen } from './ui/CalendarScreen'
import { McpScreen } from './ui/McpScreen'
import { ProjectsScreen } from './ui/ProjectsScreen'
import { Onboarding } from './ui/Onboarding'
import { emptyProfile, profileInitials, readProfile, writeProfile, type Profile } from './ui/profile'
import { SettingsDialog } from './ui/SettingsScreen'
import { ShortcutsScreen } from './ui/ShortcutsScreen'
import { useSettingsState, type SettingsSection } from './ui/settingsState'
import { UpdatePrompt } from './ui/UpdatePrompt'
import { useUpdates } from './ui/useUpdates'
import type { AskFocus } from './features/ask/context'
import { DictatePopup } from './ui/DictatePopup'
import { DictateScreen } from './ui/DictateScreen'
import { FloatingAsk } from './ui/FloatingAsk'
import { LiveScreen } from './ui/LiveScreen'
import { MeetingsScreen, StartAsk } from './ui/MeetingsScreen'
import { NotesScreen } from './ui/NotesScreen'
import { useCalendarClock } from './ui/useCalendar'
import './App.css'

type View =
  | { name: 'list' }
  | { name: 'live'; fresh: boolean; title?: string; instanceKey?: string }
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
  const [rows, setRows] = useState<MeetingRow[]>(() => listedMeetings.map((meeting) => ({ ...meeting })))
  const [folders, setFolders] = useState<ProjectFolder[]>(() => starterProjects.map((folder) => ({ ...folder, meetingIds: [...folder.meetingIds] })))
  const [view, setView] = useState<View>({ name: 'list' })
  const settings = useSettingsState()
  const update = useUpdates()
  const { calendar, upcoming, due, now } = useCalendarClock()
  const [settingsOpen, setSettingsOpen] = useState<SettingsSection | null>(null)
  const [gearSpin, setGearSpin] = useState(false)
  const [profile, setProfile] = useState(readProfile)
  const [setupOpen, setSetupOpen] = useState(() => !readProfile().onboarded)
  const [searchNonce, setSearchNonce] = useState(0)
  const [dictateOpen, setDictateOpen] = useState(false)
  const desktop = typeof window !== 'undefined' && Boolean(window.crunchcall)
  const person = profile.name.trim()

  useEffect(() => {
    if (!desktop) return
    window.crunchcall?.setChrome?.(settings.resolvedTheme).catch(() => {})
  }, [desktop, settings.resolvedTheme])

  useEffect(() => {
    // The app is the only surface, so keep the app hash even when the window
    // was opened at the bare root or a stale marketing URL.
    if (window.location.hash !== '#app') history.replaceState({ surface: 'app' }, '', '#app')
  }, [])

  useEffect(() => {
    return onCalendarStart((instanceKey) => {
      const event = getState().events.find((item) => item.instanceKey === instanceKey)
      if (!event) return
      dismiss(event.instanceKey)
      setSettingsOpen(null)
      if (window.location.hash !== '#app') history.pushState({ surface: 'app' }, '', '#app')
      setView({ name: 'live', fresh: true, title: event.title, instanceKey: event.instanceKey })
    })
  }, [])

  useEffect(() => {
    setActiveMeeting(view.name === 'live' ? (view.instanceKey ?? null) : null)
  }, [view])

  useEffect(() => {
    function onPop() {
      setSettingsOpen(null)
      setView({ name: 'list' })
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

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

  function restoreApp() {
    settings.reset()
    resetCalendar()
    clearDeskStorage()
    const blank = emptyProfile()
    writeProfile(blank)
    setProfile(blank)
    setRows(listedMeetings.map((meeting) => ({ ...meeting })))
    setFolders(starterProjects.map((folder) => ({ ...folder, meetingIds: [...folder.meetingIds] })))
    setSettingsOpen(null)
    setView({ name: 'list' })
    setSetupOpen(true)
  }

  function openMeeting(id: string) {
    const meeting = rows.find((item) => item.id === id)
    if (!meeting) return
    setSettingsOpen(null)
    setView(meeting.status === 'live' ? { name: 'live', fresh: false } : { name: 'notes', id })
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
    setView({ name: 'live', fresh: !rows.some((item) => item.status === 'live') })
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

    function onKey(event: KeyboardEvent) {
      if (setupOpen) return
      if (event.defaultPrevented || event.altKey || event.metaKey) return
      const key = event.key.toLowerCase()

      if (event.ctrlKey && event.shiftKey) {
        if (typing(event.target)) return
        if (key === 'm') {
          event.preventDefault()
          setSettingsOpen('speech')
          return
        }
        if (key === 'k') {
          event.preventDefault()
          setSettingsOpen('notes')
          return
        }
        if (key === 'p') {
          event.preventDefault()
          setSettingsOpen('machine')
          return
        }
      }

      if (!event.ctrlKey) return
      if (typing(event.target)) return

      if (key === 'n') {
        event.preventDefault()
        go({ name: 'live', fresh: true })
        return
      }
      if (key === ',') {
        event.preventDefault()
        setSettingsOpen('listening')
        return
      }

      const digitViews: Record<string, () => void> = {
        '1': () => go({ name: 'list' }),
        '2': () => {
          setSettingsOpen(null)
          setView({ name: 'live', fresh: !rows.some((item) => item.status === 'live') })
        },
        '3': () => go({ name: 'dictate' }),
        '4': () => {
          setSearchNonce((current) => current + 1)
          go({ name: 'projects' })
        },
        '5': () => go({ name: 'calendar' }),
        '6': () => go({ name: 'projects' }),
        '7': () => go({ name: 'shortcuts' }),
        '8': () => go({ name: 'connect' }),
      }
      const jump = digitViews[key]
      if (!jump) return
      event.preventDefault()
      jump()
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [rows, setupOpen])

  function removeMeeting(id: string) {
    setRows((current) => current.filter((item) => item.id !== id))
    if (view.name === 'notes' && view.id === id) setView({ name: 'list' })
  }

  function beginFromCalendar(event: CalendarEvent, fromPrompt: boolean) {
    if (fromPrompt) dismiss(event.instanceKey)
    setSettingsOpen(null)
    if (window.location.hash !== '#app') history.pushState({ surface: 'app' }, '', '#app')
    setView({ name: 'live', fresh: true, title: event.title, instanceKey: event.instanceKey })
  }

  function endLive(fresh: boolean) {
    const title = view.name === 'live' ? view.title : undefined
    if (fresh) {
      setRows((current) => [freshMeeting(title), ...current.filter((item) => item.id !== 'fresh-session')])
      setView({ name: 'notes', id: 'fresh-session' })
      return
    }
    setRows((current) =>
      current.map((item) =>
        item.id === 'live-product'
          ? {
              ...item,
              status: 'processing',
              when: 'Just now',
              duration: '18:42',
              preview: 'Crunching notes on this PC…',
            }
          : item,
      ),
    )
    setView({ name: 'notes', id: 'live-product' })
  }

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
          <span>CrunchCall</span>
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
          {update.showPrompt && update.phase === 'available' ? (
            <UpdatePrompt latest={update.latest} onOpen={update.open} onDismiss={update.dismiss} />
          ) : null}
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
              calendar.source ? 'Nothing coming up in the next two weeks.' : 'Add a calendar link under Calendar.'
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
            fresh={view.fresh}
            title={view.title}
            onBack={() => setView({ name: 'list' })}
            onEnd={() => endLive(view.fresh)}
          />
        ) : null}
        {view.name === 'dictate' ? <DictateScreen speechId={settings.speechId} /> : null}
        {view.name === 'notes' && notesMeeting ? (
          <NotesScreen
            key={notesMeeting.id}
            meeting={notesMeeting}
            folders={folders}
            folderId={folders.find((folder) => folder.meetingIds.includes(notesMeeting.id))?.id ?? ''}
            onFile={(folderId) => fileMeeting(notesMeeting.id, folderId)}
            onBack={() => setView({ name: 'list' })}
            onStart={() => setView({ name: 'live', fresh: true })}
          />
        ) : null}
        {view.name === 'calendar' ? <CalendarScreen onStart={(event) => beginFromCalendar(event, false)} /> : null}
        {view.name === 'shortcuts' ? (
          <ShortcutsScreen
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
          onOpenHelp={() => {
            setSettingsOpen(null)
            setView({ name: 'shortcuts' })
          }}
          update={update}
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
      <DictatePopup speechId={settings.speechId} open={dictateOpen} onOpenChange={setDictateOpen} />
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
        />
      ) : null}
    </div>
  )
}
