import { useEffect, useRef, useState, type ReactNode } from 'react'
import { callEngine, describeEngineResult, engineAvailable } from '../features/engines/call'
import {
  engineById,
  engineChip,
  engineDefaults,
  engineModules,
  enginesWhere,
  speechPrivacy,
  type EngineModule,
} from '../features/engines/catalog'
import {
  CheckIcon,
  ChevronIcon,
  DownloadIcon,
  ExternalLinkIcon,
  EyeIcon,
  EyeOffIcon,
  HelpIcon,
  RestoreIcon,
  SearchIcon,
  SupportIcon,
} from './icons'
import {
  cueOptions,
  overlayPositionOptions,
  settingsItems,
  supportItems,
  type SettingsHandlers,
  type SettingsSection,
  type SupportActionId,
} from './settingsState'
import { appVersion } from './updates'
import { ACCOUNT_URL, BUY_URL, type LicenseDesk } from './useLicense'

type PlaceId = 'local' | 'cloud' | 'external'

type InstallRow = {
  moduleId: string
  status: string
  message: string
  bytesDone: number
  bytesTotal: number | null
  speedBps: number
}

const pages: Record<SettingsSection, { title: string; lede: string }> = {
  listening: {
    title: 'Listening',
    lede: 'Microphone, language, and the cues that appear during a call.',
  },
  speech: {
    title: 'Speech',
    lede: 'What hears the call and Dictate. Download on this PC, or paste a cloud key here.',
  },
  notes: {
    title: 'Notes',
    lede: 'What writes the notes and phrases the cues. Download or paste a key on the same screen.',
  },
  machine: {
    title: 'System',
    lede: 'Name, appearance, and startup for this copy.',
  },
  license: {
    title: 'License',
    lede: 'One-time unlock for live coaching and Markdown export. Checked on this PC.',
  },
}

export function SettingsDialog({
  section,
  onSection,
  onClose,
  settings,
  name,
  onName,
  onRunSetup,
  onRestore,
  onOpenHelp,
  license,
}: {
  section: SettingsSection
  onSection: (next: SettingsSection) => void
  onClose: () => void
  settings: SettingsHandlers
  name: string
  onName: (name: string) => void
  onRunSetup: () => void
  onRestore: () => void
  onOpenHelp: () => void
  license: LicenseDesk
}) {
  const sheetRef = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')
  const [restoreArmed, setRestoreArmed] = useState(false)
  const needle = query.trim().toLowerCase()
  const matches = (item: (typeof settingsItems)[number]) =>
    !needle || `${item.label} ${item.hint} ${item.find}`.toLowerCase().includes(needle)
  const matchesSupport = (item: (typeof supportItems)[number]) =>
    !needle || `${item.label} ${item.find}`.toLowerCase().includes(needle)
  const visible = settingsItems.filter(matches)
  const visibleSupport = supportItems.filter(matchesSupport)
  const page = pages[section]
  const speech = engineById(settings.speechId) ?? engineById(engineDefaults.speech)
  const privacy = speech ? speechPrivacy(speech) : 'Speech stays on this PC.'

  function runSupport(id: SupportActionId) {
    const item = supportItems.find((entry) => entry.id === id)
    if (!item) return
    if (id === 'restore') {
      if (!restoreArmed) {
        setRestoreArmed(true)
        return
      }
      setRestoreArmed(false)
      onRestore()
      return
    }
    setRestoreArmed(false)
    if (id === 'help') {
      onOpenHelp()
      return
    }
    if (item.href) window.open(item.href, '_blank', 'noopener,noreferrer')
  }

  useEffect(() => {
    const node = sheetRef.current
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab' || !node) return
      const items = [
        ...node.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), summary, [href]',
        ),
      ]
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
  }, [onClose])

  function onQuery(value: string) {
    setQuery(value)
    const nextNeedle = value.trim().toLowerCase()
    const next = settingsItems.filter(
      (item) => !nextNeedle || `${item.label} ${item.hint} ${item.find}`.toLowerCase().includes(nextNeedle),
    )
    if (next.length > 0 && !next.some((item) => item.id === section)) onSection(next[0].id)
  }

  return (
    <div className="pop-root">
      <button type="button" className="pop-scrim" aria-label="Close settings" onClick={onClose} />
      <div
        ref={sheetRef}
        className="pop-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        tabIndex={-1}
      >
        <aside className="pop-nav">
          <label className="search">
            <SearchIcon />
            <span className="sr">Search settings</span>
            <input
              value={query}
              onChange={(event) => onQuery(event.target.value)}
              placeholder="Search settings"
              autoComplete="off"
            />
          </label>
          <nav className="pop-menu" aria-label="Settings">
            {visible.length === 0 && visibleSupport.length === 0 ? <p className="pop-empty">Nothing matches.</p> : null}
            {visible.map((item) => {
              const Icon = item.icon
              return (
                <button
                  key={item.id}
                  type="button"
                  className={section === item.id ? 'pop-item on' : 'pop-item'}
                  onClick={() => {
                    setRestoreArmed(false)
                    onSection(item.id)
                  }}
                >
                  <Icon />
                  <span className="pop-item-text">
                    <strong>{item.label}</strong>
                    <small>{item.hint}</small>
                  </span>
                </button>
              )
            })}
          </nav>
          {visibleSupport.length > 0 ? (
            <nav className="pop-support" aria-label="Support">
              {visibleSupport.map((item) => {
                const Icon = item.id === 'restore' ? RestoreIcon : item.id === 'support' ? SupportIcon : HelpIcon
                const restoring = item.id === 'restore' && restoreArmed
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={restoring ? 'pop-support-item warn' : 'pop-support-item'}
                    onClick={() => runSupport(item.id)}
                  >
                    <Icon />
                    <span>{restoring ? 'Confirm restore' : item.label}</span>
                    {item.external ? <ExternalLinkIcon className="pop-support-ext" /> : null}
                  </button>
                )
              })}
            </nav>
          ) : null}
          <p className="pop-foot">{privacy}</p>
        </aside>
        <div className="pop-body">
          <header className="pop-head">
            <div>
              <h2 id="settings-title">{page.title}</h2>
              <p className="pop-kicker">{page.lede}</p>
            </div>
            <button type="button" className="pop-x" onClick={onClose} aria-label="Close">
              ×
            </button>
          </header>
          <div className="pop-scroll">
            {settings.engineError ? <p className="pop-alert">{settings.engineError}</p> : null}
            {section === 'listening' ? (
              <Listening settings={settings} onSection={onSection} unlocked={license.unlocked} />
            ) : null}
            {section === 'speech' ? <SpeechPage settings={settings} /> : null}
            {section === 'notes' ? <NotesPage settings={settings} /> : null}
            {section === 'machine' ? (
              <Machine
                settings={settings}
                name={name}
                onName={onName}
                onRunSetup={onRunSetup}
                onRestore={onRestore}
              />
            ) : null}
            {section === 'license' ? <LicensePage license={license} /> : null}
          </div>
        </div>
      </div>
    </div>
  )
}

function Listening({
  settings,
  onSection,
  unlocked,
}: {
  settings: SettingsHandlers
  onSection: (next: SettingsSection) => void
  unlocked: boolean
}) {
  const {
    input,
    setInput,
    showCues,
    setShowCues,
    showMeetingIndicator,
    setShowMeetingIndicator,
    overlayOpacity,
    setOverlayOpacity,
    overlayPosition,
    setOverlayPosition,
    cues,
    toggleCue,
    language,
    setLanguage,
    speechId,
  } = settings
  const speech = engineById(speechId) ?? engineById(engineDefaults.speech)
  const [mics, setMics] = useState([{ id: 'default', name: 'Default' }])
  useEffect(() => {
    if (!navigator.mediaDevices?.enumerateDevices) return
    let cancel = false
    async function load() {
      let list = await navigator.mediaDevices.enumerateDevices()
      const inputs = () => list.filter((item) => item.kind === 'audioinput' && item.deviceId)
      if (inputs().length > 0 && inputs().every((item) => !item.label)) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
          stream.getTracks().forEach((track) => track.stop())
          list = await navigator.mediaDevices.enumerateDevices()
        } catch {
          /* names stay hidden until the microphone is allowed */
        }
      }
      if (cancel) return
      const found = inputs().map((item, index) => ({ id: item.deviceId, name: item.label || `Microphone ${index + 1}` }))
      if (found.length) setMics([{ id: 'default', name: 'Default' }, ...found])
    }
    void load()
    return () => {
      cancel = true
    }
  }, [])
  const current = mics.find((item) => item.id === input) ?? mics[0]
  const cuesOn = cueOptions.filter((cue) => cues[cue.id]).length

  return (
    <div className="page-stack">
      <div>
        <Section label="Hearing the room">
          <Row
            title="Speech to text"
            help={`${speech?.name ?? 'Whisper Tiny'} · ${speech ? whereLabel(speech) : 'On this PC'}`}
          >
            <button type="button" className="text-btn" onClick={() => onSection('speech')}>
              Change
            </button>
          </Row>
          <Row
            title="Input"
            help={
              input === 'default'
                ? 'Using the default input on this PC. annotated never joins the call.'
                : `Using ${current?.name}. annotated never joins the call.`
            }
          >
            <select
              className="input-select"
              aria-label="Input"
              value={mics.some((item) => item.id === input) ? input : 'default'}
              onChange={(event) => setInput(event.target.value as typeof input)}
            >
              {mics.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </Row>
          <Row title="Language" help="Auto follows the call. English keeps the speech model on English.">
            <Choice
              label="Speech language"
              value={language}
              options={[
                ['auto', 'Auto'],
                ['english', 'English'],
              ]}
              onChange={setLanguage}
            />
          </Row>
        </Section>
        <p className="privacy-line">{speech ? speechPrivacy(speech) : 'Speech stays on this PC.'}</p>
      </div>

      <Section
        label="During the call"
        aside={showCues ? <span className="tag">{cuesOn} on</span> : <span className="tag">Off</span>}
      >
        <Row
          title="Live meeting indicator"
          help="A floating panel over Zoom, Meet, or Teams while annotated is listening. Stays off your screen share."
        >
          <Switch
            on={showMeetingIndicator}
            label="Live meeting indicator"
            onClick={() => setShowMeetingIndicator((value) => !value)}
          />
        </Row>
        <Row
          title="Overlay position"
          help="Where the live meeting bar floats. You can still drag it during a call."
        >
          <div className={showMeetingIndicator ? undefined : 'opacity-slider dim'}>
            <Choice
              label="Overlay position"
              value={overlayPosition}
              options={overlayPositionOptions}
              onChange={setOverlayPosition}
            />
          </div>
        </Row>
        <Row
          title="Overlay opacity"
          help={`${Math.round(overlayOpacity * 100)}% · Lower makes the panel more see-through over the call.`}
        >
          <label className={showMeetingIndicator ? 'opacity-slider' : 'opacity-slider dim'}>
            <span className="sr">Overlay opacity</span>
            <input
              type="range"
              min={35}
              max={100}
              step={1}
              value={Math.round(overlayOpacity * 100)}
              disabled={!showMeetingIndicator}
              aria-valuetext={`${Math.round(overlayOpacity * 100)} percent`}
              onChange={(event) => setOverlayOpacity(Number(event.target.value) / 100)}
            />
          </label>
        </Row>
        <Row title="Cues" help="Mid-call nudges on the indicator and Live screen when something needs fixing.">
          <Switch on={showCues} label="Show cues" onClick={() => setShowCues((value) => !value)} />
        </Row>
        <div className={showCues ? 'cue-layout' : 'cue-layout dim'}>
          <div className="cue-list">
            {cueOptions.map((cue) => (
              <div key={cue.id} className={showCues ? 'cue-row' : 'cue-row dim'}>
                <div>
                  <p className="set-label">{cue.name}</p>
                  <p className="help">{cue.help}</p>
                </div>
                <Switch on={cues[cue.id]} label={cue.name} disabled={!showCues} onClick={() => toggleCue(cue.id)} />
              </div>
            ))}
          </div>
        </div>
        {unlocked ? null : (
          <p className="pop-note">Live cues need Unlock. The meeting indicator and notes on this PC stay free.</p>
        )}
      </Section>
    </div>
  )
}

function SpeechPage({ settings }: { settings: SettingsHandlers }) {
  const selected = engineById(settings.speechId) ?? engineById(engineDefaults.speech)
  return (
    <EngineStudio
      settings={settings}
      selected={selected}
      onSelect={settings.setSpeechId}
      places={[
        {
          id: 'local',
          name: 'On this PC',
          hint: 'Audio stays on this computer. Download a model if it is not installed yet.',
          modules: enginesWhere('speech', 'local'),
        },
        {
          id: 'cloud',
          name: 'Cloud',
          hint: 'A lab hears the audio. Paste its key below when you pick one.',
          modules: enginesWhere('speech', 'cloud'),
        },
        {
          id: 'external',
          name: 'Another app',
          hint: 'A dictation app hears the mic. You paste the text in.',
          modules: enginesWhere('speech', 'external'),
        },
      ]}
      privacy={
        selected?.where === 'cloud'
          ? `${selected.maker} hears the audio. Keys stay in Windows Credential Manager.`
          : selected?.where === 'external'
            ? `${selected.name} hears the mic. annotated keeps the text you give it.`
            : 'Speech stays on this PC. Keys stay in Windows Credential Manager.'
      }
    />
  )
}

function NotesPage({ settings }: { settings: SettingsHandlers }) {
  const writer = engineById(settings.writerId) ?? engineById(engineDefaults.writer)
  const coach = engineById(settings.coachId) ?? engineById(engineDefaults.coach)
  const [role, setRole] = useState<'writer' | 'coach'>('writer')
  const selected = role === 'writer' ? writer : coach
  const places =
    role === 'writer'
      ? [
          {
            id: 'local' as const,
            name: 'On this PC',
            hint: 'Notes are written on this computer. Download a model if it is not installed yet.',
            modules: enginesWhere('writer', 'local'),
          },
          {
            id: 'cloud' as const,
            name: 'Cloud',
            hint: 'A lab writes the notes. Paste its key below when you pick one.',
            modules: enginesWhere('writer', 'cloud'),
          },
        ]
      : [
          {
            id: 'local' as const,
            name: 'On this PC',
            hint: 'Cues and packs that never leave this computer.',
            modules: engineModules.filter((item) => item.kind === 'coach' && item.where !== 'cloud'),
          },
          {
            id: 'cloud' as const,
            name: 'Cloud',
            hint: 'The notes model phrases the cue. Audio stays here.',
            modules: enginesWhere('coach', 'cloud'),
          },
        ]

  return (
    <div className="models-page">
      <div className="role-rail role-rail-pair" role="tablist" aria-label="Notes roles">
        <button
          type="button"
          role="tab"
          aria-selected={role === 'writer'}
          className={role === 'writer' ? 'role-tab on' : 'role-tab'}
          onClick={() => setRole('writer')}
        >
          <span className="role-tab-label">Writing</span>
          <span className="role-tab-name">{writer?.name ?? 'None'}</span>
          <span className="role-tab-detail">
            {writer ? writerDetail(writer) : 'On this PC'}
            {writer?.needsKey && !settings.savedKeys[writer.id] ? <span className="tag warn">Key needed</span> : null}
          </span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={role === 'coach'}
          className={role === 'coach' ? 'role-tab on' : 'role-tab'}
          onClick={() => setRole('coach')}
        >
          <span className="role-tab-label">Coaching</span>
          <span className="role-tab-name">{coach?.name ?? 'None'}</span>
          <span className="role-tab-detail">
            {coach ? `${whereLabel(coach)}${coach.size ? ` · ${coach.size}` : ''}` : 'Built in'}
          </span>
        </button>
      </div>

      <EngineStudio
        key={role}
        settings={settings}
        selected={selected}
        onSelect={role === 'writer' ? settings.setWriterId : settings.setCoachId}
        places={places}
        embedded
        privacy={
          writer?.where === 'cloud'
            ? `Notes text goes to ${writer.maker}. Keys stay in Windows Credential Manager.`
            : 'Notes stay on this PC unless you pick a cloud writer. Keys stay in Windows Credential Manager.'
        }
      />
    </div>
  )
}

function EngineStudio({
  settings,
  selected,
  onSelect,
  places,
  privacy,
  embedded,
}: {
  settings: SettingsHandlers
  selected: EngineModule | undefined
  onSelect: (id: string) => void
  places: { id: PlaceId; name: string; hint: string; modules: EngineModule[] }[]
  privacy: string
  embedded?: boolean
}) {
  const usingPlace = selected ? placeOf(selected) : 'local'
  const [place, setPlace] = useState<PlaceId>(usingPlace)
  const placeForSelected = useRef(selected?.id)
  const [installs, setInstalls] = useState<Record<string, InstallRow>>({})
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [keyShown, setKeyShown] = useState(false)
  const watching = Object.values(installs).some((row) => row.status === 'downloading' || row.status === 'paused')
  const currentPlace = places.find((item) => item.id === place) ?? places[0]

  useEffect(() => {
    if (placeForSelected.current === selected?.id) return
    placeForSelected.current = selected?.id
    setPlace(usingPlace)
  }, [selected?.id, usingPlace])

  useEffect(() => {
    if (!places.some((item) => item.id === place)) setPlace(places[0]?.id ?? 'local')
  }, [place, places])

  useEffect(() => {
    if (!engineAvailable()) return
    let cancelled = false
    async function load() {
      const result = await callEngine('models.list')
      if (cancelled || !result.ok) return
      setInstalls(readInstalls(result.result))
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!watching) return
    const timer = window.setInterval(() => {
      void callEngine('models.list').then((result) => {
        if (result.ok) setInstalls(readInstalls(result.result))
      })
    }, 400)
    return () => window.clearInterval(timer)
  }, [watching])

  useEffect(() => {
    setKeyShown(false)
  }, [place, selected?.id])

  async function runDownload(method: 'models.install' | 'models.pause' | 'models.resume', moduleId: string) {
    if (!engineAvailable()) {
      setNotes((current) => ({ ...current, [moduleId]: 'Downloads run in the desktop app.' }))
      return
    }
    setBusy(moduleId)
    const result = await callEngine(method, { moduleId })
    if (!result.ok) {
      setBusy(null)
      setNotes((current) => ({ ...current, [moduleId]: result.message }))
      return
    }
    const status = await callEngine('models.status', { moduleId })
    setBusy(null)
    const row = status.ok ? readInstall(status.result) : readInstall(result.result)
    if (row) setInstalls((current) => ({ ...current, [moduleId]: row }))
    if (row && (row.status === 'manual' || row.status === 'error')) {
      setNotes((current) => ({ ...current, [moduleId]: row.message || describeEngineResult(result.result) }))
      return
    }
    setNotes((current) => {
      if (!current[moduleId]) return current
      const next = { ...current }
      delete next[moduleId]
      return next
    })
  }

  const body = (
    <>
      <div className="model-stage" role="tabpanel">
        <div className="model-stage-head">
          <div>
            <p className="model-stage-kicker">Where it runs</p>
            <p className="model-stage-hint">{currentPlace.hint}</p>
          </div>
          <div className="seg model-place-seg" role="radiogroup" aria-label="Where it runs">
            {places.map((item) => (
              <button
                key={item.id}
                type="button"
                role="radio"
                aria-checked={item.id === currentPlace.id}
                className={item.id === currentPlace.id ? 'on' : ''}
                onClick={() => setPlace(item.id)}
              >
                {item.name}
                {usingPlace === item.id ? <span className="model-place-dot" aria-hidden="true" /> : null}
              </button>
            ))}
          </div>
        </div>

        {selected && usingPlace !== currentPlace.id ? (
          <p className="model-stage-note">
            Still using <strong>{selected.name}</strong> until you pick one here.
          </p>
        ) : null}

        <ModelCatalog
          modules={currentPlace.modules}
          selectedId={selected?.id ?? ''}
          settings={settings}
          installs={installs}
          notes={notes}
          busy={busy}
          keyShown={keyShown}
          onToggleKeyShown={() => setKeyShown((value) => !value)}
          onSelect={onSelect}
          onDownload={(id) => void runDownload('models.install', id)}
          onPause={(id) => void runDownload('models.pause', id)}
          onResume={(id) => void runDownload('models.resume', id)}
        />

        {currentPlace.id === 'local' ? (
          <p className="model-stage-foot">
            Downloads land in <span className="pop-path-inline">%LocalAppData%\CrunchCall\models</span>. Pause keeps
            what you already have. Manual models are installed by you from the maker.
          </p>
        ) : null}
      </div>
      <p className="privacy-line">{privacy}</p>
    </>
  )

  return embedded ? body : <div className="models-page">{body}</div>
}

function placeOf(module: EngineModule): PlaceId {
  if (module.where === 'cloud') return 'cloud'
  if (module.where === 'external') return 'external'
  return 'local'
}

function ModelCatalog({
  modules,
  selectedId,
  settings,
  installs,
  notes,
  busy,
  keyShown,
  onToggleKeyShown,
  onSelect,
  onDownload,
  onPause,
  onResume,
}: {
  modules: EngineModule[]
  selectedId: string
  settings: SettingsHandlers
  installs: Record<string, InstallRow>
  notes: Record<string, string>
  busy: string | null
  keyShown: boolean
  onToggleKeyShown: () => void
  onSelect: (id: string) => void
  onDownload: (moduleId: string) => void
  onPause: (moduleId: string) => void
  onResume: (moduleId: string) => void
}) {
  const [query, setQuery] = useState('')
  const [showManual, setShowManual] = useState(false)
  const needle = query.trim().toLowerCase()
  const primary = modules.filter((item) => item.download === 'direct' || item.download === 'none')
  const manual = modules.filter((item) => item.download !== 'direct' && item.download !== 'none')
  const listed = showManual ? [...primary, ...manual] : primary.length > 0 ? primary : modules
  const visible = listed
    .filter((item) => !needle || `${item.name} ${item.maker} ${item.blurb}`.toLowerCase().includes(needle))
    .slice()
    .sort((a, b) => Number(b.id === selectedId) - Number(a.id === selectedId))
  const selected = modules.find((item) => item.id === selectedId)
  const keyTarget = selected?.needsKey ? selected : null

  if (modules.length === 0) return <p className="empty tight">Nothing in this list.</p>

  return (
    <div className="model-catalog">
      {modules.length > 7 ? (
        <input
          className="engine-filter"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={`Filter ${modules.length} options`}
          aria-label="Filter models"
          autoComplete="off"
        />
      ) : null}

      {visible.length === 0 ? (
        <p className="empty tight">Nothing matches.</p>
      ) : (
        <div className="model-catalog-list" role="listbox" aria-label="Models">
          {visible.map((item) => {
            const on = item.id === selectedId
            const install = installs[item.id]
            const status = install?.status
            const installed = status === 'installed'
            const downloading = status === 'downloading'
            const paused = status === 'paused'
            const failed = status === 'error'
            const working = busy === item.id
            const showMeter = Boolean(install && (downloading || paused || (failed && install.bytesDone > 0)))
            const saved = Boolean(settings.savedKeys[item.id])
            return (
              <div key={item.id} className={on ? 'model-card on' : 'model-card'}>
                <button
                  type="button"
                  role="option"
                  aria-selected={on}
                  className="model-card-main"
                  onClick={() => onSelect(item.id)}
                >
                  <span className="model-card-copy">
                    <span className="model-card-name">
                      {item.name}
                      <span className="model-card-maker">{item.maker}</span>
                    </span>
                    <span className="model-card-blurb">{item.blurb}</span>
                    {notes[item.id] ? <span className="model-card-note">{notes[item.id]}</span> : null}
                    {showMeter && install ? <DownloadMeter install={install} /> : null}
                  </span>
                  <span className="model-card-side">
                    {on ? (
                      <span className="tag ok">
                        <CheckIcon />
                        In use
                      </span>
                    ) : item.needsKey ? (
                      <span className={saved ? 'tag ok' : 'tag'}>{saved ? 'Key saved' : 'Needs key'}</span>
                    ) : (
                      <span className="engine-chip">{engineChip(item)}</span>
                    )}
                  </span>
                </button>
                {item.download === 'direct' || downloading || paused || failed ? (
                  <div className="model-card-actions">
                    {installed ? <span className="tag ok">Installed</span> : null}
                    {downloading ? (
                      <button type="button" className="btn small ghost" disabled={working} onClick={() => onPause(item.id)}>
                        {working ? 'Pausing…' : 'Pause'}
                      </button>
                    ) : null}
                    {paused || (failed && item.download === 'direct') ? (
                      <button type="button" className="btn small ghost" disabled={working} onClick={() => onResume(item.id)}>
                        {working ? 'Continuing…' : paused ? 'Continue' : 'Retry'}
                      </button>
                    ) : null}
                    {!installed && !downloading && !paused && !failed && item.download === 'direct' ? (
                      <button type="button" className="btn small ghost" disabled={working} onClick={() => onDownload(item.id)}>
                        <DownloadIcon />
                        {working ? 'Starting…' : 'Download'}
                      </button>
                    ) : null}
                  </div>
                ) : null}
                {!installed && item.download !== 'direct' && item.download !== 'none' ? (
                  <div className="model-card-actions">
                    <span className="tag" title={install?.message || undefined}>
                      Manual
                    </span>
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      )}

      {manual.length > 0 && primary.length > 0 ? (
        <button
          type="button"
          className="model-more-btn"
          aria-expanded={showManual}
          onClick={() => setShowManual((value) => !value)}
        >
          {showManual ? 'Hide' : 'Show'} {manual.length} models installed by hand
          <ChevronIcon className={showManual ? 'disclosure-chevron on' : 'disclosure-chevron'} />
        </button>
      ) : null}

      {keyTarget ? (
        <div className="model-key-panel">
          <div className="model-key-head">
            <div>
              <p className="set-label">API key for {keyTarget.name}</p>
              <p className="help">Saved in Windows Credential Manager. Local models never need one.</p>
            </div>
            <span className={settings.savedKeys[keyTarget.id] ? 'tag ok' : 'tag warn'}>
              {settings.savedKeys[keyTarget.id] ? 'Saved' : 'Key needed'}
            </span>
          </div>
          <InlineKey item={keyTarget} settings={settings} shown={keyShown} onToggleShown={onToggleKeyShown} />
        </div>
      ) : null}
    </div>
  )
}

function InlineKey({
  item,
  settings,
  shown,
  onToggleShown,
}: {
  item: EngineModule
  settings: SettingsHandlers
  shown: boolean
  onToggleShown: () => void
}) {
  const [replacing, setReplacing] = useState(false)
  const dirty = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const value = settings.keys[item.id] ?? ''
  const saved = Boolean(settings.savedKeys[item.id])
  const masked = saved && value.length === 0 && !replacing
  const modelValue = settings.modelOverrides[item.id] ?? item.model ?? ''
  const placeholder =
    saved && !value
      ? 'Saved — paste a new key to replace'
      : item.keyHint
        ? `Paste key (${item.keyHint})`
        : 'Paste API key'

  useEffect(() => {
    if (replacing) inputRef.current?.focus()
  }, [replacing])

  useEffect(() => {
    if (!saved && !masked) inputRef.current?.focus()
  }, [item.id, saved, masked])

  return (
    <>
      <div className="key-field">
        {masked ? (
          <button type="button" className="key-mask" onClick={() => setReplacing(true)}>
            <span aria-hidden="true">••••••••••••</span>
            <span className="sr">Saved {item.name} key, hidden. Activate to replace it.</span>
          </button>
        ) : (
          <input
            ref={inputRef}
            type={shown ? 'text' : 'password'}
            aria-label={`${item.name} API key`}
            autoComplete="off"
            spellCheck={false}
            placeholder={saved ? 'Paste a new key to replace' : placeholder}
            value={value}
            onChange={(event) => {
              dirty.current = true
              settings.setKey(item.id, event.target.value)
            }}
            onBlur={(event) => {
              const next = event.currentTarget.value
              if (dirty.current) {
                dirty.current = false
                void settings.commitKey(item.id, next)
              }
              if (!next) setReplacing(false)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur()
            }}
          />
        )}
        <button
          type="button"
          className="icon-btn"
          aria-label={shown ? `Hide ${item.name} key` : `Show ${item.name} key`}
          aria-pressed={shown}
          disabled={!value}
          title={value ? (shown ? 'Hide key' : 'Show key') : 'Saved keys stay hidden'}
          onMouseDown={(event) => event.preventDefault()}
          onClick={onToggleShown}
        >
          {shown && value ? <EyeOffIcon /> : <EyeIcon />}
        </button>
        {value || saved ? (
          <button
            type="button"
            className="text-btn"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              dirty.current = false
              setReplacing(false)
              settings.setKey(item.id, '')
              void settings.commitKey(item.id, '')
            }}
          >
            Clear
          </button>
        ) : null}
      </div>
      {item.model ? (
        <details className="key-advanced">
          <summary>Model id</summary>
          <p className="help">Sent with the request. Clear it to use the catalog id again.</p>
          <input
            className="model-id"
            aria-label={`${item.name} model id`}
            spellCheck={false}
            value={modelValue}
            onChange={(event) => settings.setModelOverride(item.id, event.target.value)}
          />
        </details>
      ) : null}
    </>
  )
}

function DownloadMeter({ install }: { install: InstallRow }) {
  const total = install.bytesTotal
  const done = Math.max(0, install.bytesDone)
  const known = typeof total === 'number' && total > 0
  const ratio = known ? Math.max(0, Math.min(1, done / total)) : null
  const amount = known ? `${formatBytes(done)} of ${formatBytes(total)}` : formatBytes(done)
  const pace =
    install.status === 'paused'
      ? 'Paused'
      : install.status === 'downloading'
        ? install.speedBps > 0
          ? `${formatBytes(install.speedBps)}/s`
          : 'Starting…'
        : 'Stopped'
  return (
    <div className="lib-progress">
      <div
        className="lib-bar"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={known ? total : undefined}
        aria-valuenow={done}
        aria-label="Download progress"
      >
        <span
          className={ratio == null ? 'lib-bar-fill unknown' : 'lib-bar-fill'}
          style={ratio == null ? undefined : { width: `${ratio * 100}%` }}
        />
      </div>
      <p className="lib-stats">
        {amount} · {pace}
      </p>
    </div>
  )
}

function installerLabel(status: LicenseDesk['status'], desktop: boolean) {
  if (!status) return desktop ? 'Checking' : 'Desktop app'
  if (status.authenticity === 'genuine') return 'Signed'
  if (status.authenticity === 'development') return 'Development'
  if (status.authenticity === 'unsigned') return 'Not signed'
  if (status.authenticity === 'tampered') return 'Altered'
  if (status.authenticity === 'untrusted') return 'Not trusted'
  return 'Unknown'
}

function LicensePage({ license }: { license: LicenseDesk }) {
  const { desktop, status, refresh } = license
  const [token, setToken] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [phase, setPhase] = useState<'idle' | 'checking' | 'revoking' | 'ok' | 'rejected'>('idle')
  const unlocked = status?.tier === 'unlock'
  const onTrial = status?.tier === 'trial'
  const plan = !desktop
    ? 'Checked in the desktop app'
    : unlocked
      ? 'Unlock'
      : onTrial
        ? `Trial · ${status?.trialDaysLeft ?? 0} day${status?.trialDaysLeft === 1 ? '' : 's'} left`
        : status?.trialEndsAt
          ? 'Trial ended'
          : 'Free'
  const appsumo = Boolean(status?.order?.startsWith('appsumo_'))
  const licensedHere =
    desktop && status?.license === 'valid' && (!appsumo || status?.seat === 'active')
  const canActivate =
    Boolean(token.trim()) || (appsumo && status?.license === 'valid' && status?.seat !== 'active')

  async function buy() {
    if (window.crunchcall?.buyLicense) {
      await window.crunchcall.buyLicense()
      return
    }
    window.open(BUY_URL, '_blank', 'noopener,noreferrer')
  }

  async function openAccount() {
    if (window.crunchcall?.openAccount) {
      await window.crunchcall.openAccount()
      return
    }
    window.open(ACCOUNT_URL, '_blank', 'noopener,noreferrer')
  }

  async function activate() {
    const activateLicense = window.crunchcall?.activateLicense
    if (!activateLicense) return
    setBusy(true)
    setPhase('checking')
    setError('')
    setNotice('')
    try {
      const result = await activateLicense(token.trim())
      if (!result.ok) {
        setPhase('rejected')
        setError(result.message)
        return
      }
      setToken('')
      setPhase('ok')
      setNotice('License activated on this PC.')
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  async function revoke() {
    setBusy(true)
    setPhase('revoking')
    setError('')
    setNotice('')
    try {
      if (appsumo && status?.seat === 'active') {
        const deactivateLicense = window.crunchcall?.deactivateLicense
        if (!deactivateLicense) return
        const result = await deactivateLicense()
        if (!result.ok) {
          setPhase('rejected')
          setError(result.message)
          return
        }
        setToken('')
        setPhase('ok')
        setNotice(
          'Revoked on this PC. On the next PC, open annotated.click/redeem with the same code and email, paste the key, and activate it.',
        )
        await refresh()
        return
      }
      const clearLicense = window.crunchcall?.clearLicense
      if (!clearLicense) return
      await clearLicense()
      setToken('')
      setPhase('ok')
      setNotice('License revoked on this PC.')
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page-stack">
      <Section label="This copy">
        <Row
          title="Plan"
          help={
            unlocked
              ? `Licensed to ${status?.email}.`
              : onTrial
                ? 'Seven-day trial on this PC. Live cues and Unlock features are included until it ends.'
                : 'Browse and capture notes free. Live cues need Unlock after the trial.'
          }
        >
          <span className="pop-value">{plan}</span>
        </Row>
        {status?.order ? (
          <Row
            title="Order"
            help={
              appsumo
                ? 'AppSumo. This code stays on one Windows PC until you revoke it here.'
                : 'The payment this license came from.'
            }
          >
            <span className="pop-value">{status.order}</span>
          </Row>
        ) : null}
        <Row
          title="Installer"
          help={
            status?.detail ??
            (desktop ? 'Checking this copy…' : 'Open the desktop app to check this copy.')
          }
        >
          <span className="pop-value">{installerLabel(status, desktop)}</span>
        </Row>
        {licensedHere ? (
          <Row
            title="This device"
            help={
              appsumo
                ? 'Revoke this license before you can add another. That also frees the code for another Windows PC.'
                : 'Revoke this license before you can add another. You can paste a key again after that.'
            }
            stack
          >
            <button type="button" className="btn small" disabled={busy} onClick={() => void revoke()}>
              {phase === 'revoking' ? 'Revoking…' : 'Revoke on this device'}
            </button>
            {phase === 'revoking' ? (
              <p className="license-status is-checking" role="status" aria-live="polite">
                Revoking on this device…
              </p>
            ) : null}
            {phase === 'rejected' && error ? (
              <p className="license-status is-rejected" role="alert">
                {error}
              </p>
            ) : null}
          </Row>
        ) : null}
      </Section>
      {status?.authenticity === 'tampered' ? <p className="pop-alert">{status.detail}</p> : null}
      {status?.license === 'invalid' ? <p className="pop-alert">The saved license is not valid.</p> : null}
      {status?.seatDetail ? <p className="pop-alert">{status.seatDetail}</p> : null}
      {!licensedHere ? (
        <Section label="Add a license">
          {desktop ? (
            <Row
              title="License"
              help={
                appsumo
                  ? 'Paste the key from annotated.click/redeem. One code activates this PC.'
                  : 'Paste the license from your account, or from the payment page.'
              }
              stack
            >
              <textarea
                className="license-field"
                aria-label="License"
                rows={2}
                spellCheck={false}
                autoComplete="off"
                value={token}
                disabled={busy}
                onChange={(event) => {
                  setToken(event.target.value)
                  if (phase !== 'idle') {
                    setPhase('idle')
                    setError('')
                    setNotice('')
                  }
                }}
                placeholder="annotated1…"
              />
              {phase === 'checking' ? (
                <p className="license-status is-checking" role="status" aria-live="polite">
                  Checking license…
                </p>
              ) : null}
              {phase === 'ok' && notice ? (
                <p className="license-status is-ok" role="status" aria-live="polite">
                  {notice}
                </p>
              ) : null}
              {phase === 'rejected' && error ? (
                <p className="license-status is-rejected" role="alert">
                  {error}
                </p>
              ) : null}
              <div className="head-actions">
                <button type="button" className="btn small primary" disabled={busy || !canActivate} onClick={() => void activate()}>
                  {phase === 'checking' ? 'Checking…' : 'Activate'}
                </button>
              </div>
            </Row>
          ) : (
            <Row title="License" help="The desktop app stores the license on this PC and checks it offline.">
              <span className="pop-value">Desktop app</span>
            </Row>
          )}
          <Row title="Buy Unlock" help="One payment. You get the license and the signed installer.">
            <button type="button" className="btn small primary" onClick={() => void buy()}>
              Buy Unlock
            </button>
          </Row>
          <Row title="Your licenses" help="Sign in with the email you paid with. The key stays there after the payment page is closed.">
            <button type="button" className="btn small" onClick={() => void openAccount()}>
              Open account
            </button>
          </Row>
        </Section>
      ) : null}
      <p className="pop-note standalone">
        A license that was altered does not unlock this PC. A copy of the app that was changed after signing stays on the free plan.
        {appsumo ? ' Each AppSumo code stays on one Windows PC until you revoke it.' : ''}
      </p>
    </div>
  )
}

function Machine({
  settings,
  name,
  onName,
  onRunSetup,
  onRestore,
}: {
  settings: SettingsHandlers
  name: string
  onName: (name: string) => void
  onRunSetup: () => void
  onRestore: () => void
}) {
  const { launchAtLogin, setLaunchAtLogin, theme, setTheme } = settings
  const [armed, setArmed] = useState(false)
  return (
    <div className="page-stack">
      <Section label="You">
        <Row title="Your name" help="Shown in the sidebar, and written into the MCP prompt.">
          <input
            className="name-field"
            aria-label="Your name"
            autoComplete="name"
            maxLength={48}
            spellCheck={false}
            placeholder="Your name"
            value={name}
            onChange={(event) => onName(event.target.value)}
            onBlur={(event) => onName(event.target.value.trim())}
          />
        </Row>
        <Row title="Setup" help="Name, calendar sync, and a prompt for Claude, Cursor, or ChatGPT.">
          <button type="button" className="btn small primary" onClick={onRunSetup}>
            Run setup
          </button>
        </Row>
      </Section>
      <Section label="Appearance">
        <Row title="Theme" help="Light, dark, or match Windows.">
          <Choice
            label="Theme"
            value={theme}
            options={[
              ['light', 'Light'],
              ['dark', 'Dark'],
              ['system', 'System'],
            ]}
            onChange={setTheme}
          />
        </Row>
      </Section>
      <Section label="This copy">
        <Row title="Launch at login" help="Open annotated when Windows starts.">
          <Switch on={launchAtLogin} label="Launch at login" onClick={() => setLaunchAtLogin((value) => !value)} />
        </Row>
        <Row title="Version" help="This copy on this PC. Local mode needs no account.">
          <span className="pop-value">{appVersion}</span>
        </Row>
        <Row
          title="Restore defaults"
          help={
            armed
              ? 'This clears your name, calendar sign-in, settings, and meetings on this PC.'
              : 'Put this PC back to a fresh copy of annotated.'
          }
        >
          {armed ? (
            <div className="head-actions">
              <button type="button" className="btn small ghost" onClick={() => setArmed(false)}>
                Cancel
              </button>
              <button type="button" className="btn small danger" onClick={onRestore}>
                Restore
              </button>
            </div>
          ) : (
            <button type="button" className="btn small ghost" onClick={() => setArmed(true)}>
              Restore defaults
            </button>
          )}
        </Row>
      </Section>
    </div>
  )
}

function Section({
  label,
  aside,
  bare,
  children,
}: {
  label: string
  aside?: ReactNode
  bare?: boolean
  children: ReactNode
}) {
  return (
    <section className="set-section">
      <div className="set-section-head">
        <p className="pop-group-label">{label}</p>
        {aside}
      </div>
      {bare ? children : <div className="pop-group">{children}</div>}
    </section>
  )
}

function Row({ title, help, stack, children }: { title: string; help: string; stack?: boolean; children: ReactNode }) {
  return (
    <div className={stack ? 'pop-row stack' : 'pop-row'}>
      <div>
        <p className="set-label">{title}</p>
        <p className="help">{help}</p>
      </div>
      <div className="pop-control">{children}</div>
    </div>
  )
}

function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: [T, string][]
  onChange: (next: T) => void
}) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map(([id, name]) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={value === id}
          className={value === id ? 'on' : ''}
          onClick={() => onChange(id)}
        >
          {name}
        </button>
      ))}
    </div>
  )
}

function Switch({ on, label, disabled, onClick }: { on: boolean; label: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      className={on ? 'switch on' : 'switch'}
      onClick={onClick}
    >
      <span />
    </button>
  )
}

function whereLabel(module: EngineModule): string {
  if (module.where === 'cloud') return 'Cloud'
  if (module.where === 'external') return 'Another app'
  if (module.where === 'rules') return 'Built in'
  return 'On this PC'
}

function writerDetail(module: EngineModule): string {
  const bits = [whereLabel(module)]
  if (module.size) bits.push(module.size)
  else if (module.textLeavesDevice) bits.push('text leaves this PC')
  else bits.push('ready')
  return bits.join(' · ')
}

function readInstall(value: unknown): InstallRow | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  if (typeof row.moduleId !== 'string') return null
  return {
    moduleId: row.moduleId,
    status: typeof row.status === 'string' ? row.status : 'missing',
    message: typeof row.message === 'string' ? row.message : '',
    bytesDone: typeof row.bytesDone === 'number' ? row.bytesDone : 0,
    bytesTotal: typeof row.bytesTotal === 'number' ? row.bytesTotal : null,
    speedBps: typeof row.speedBps === 'number' ? row.speedBps : 0,
  }
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  const digits = unit === 0 || value >= 100 ? 0 : 1
  const text = value.toFixed(digits).replace(/\.0$/, '')
  return `${text} ${units[unit]}`
}

function readInstalls(value: unknown): Record<string, InstallRow> {
  if (!value || typeof value !== 'object') return {}
  const list = (value as { modules?: unknown }).modules
  if (!Array.isArray(list)) return {}
  const out: Record<string, InstallRow> = {}
  for (const item of list) {
    const row = readInstall(item)
    if (row) out[row.moduleId] = row
  }
  return out
}
