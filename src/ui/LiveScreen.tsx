import { useEffect, useRef, useState } from 'react'
import { listMicrophones, startListening, type ListenHandle, type MicOption } from '../features/audio/listen'
import { pcm16ToWavBase64 } from '../features/audio/wav'
import { callEngine, engineAvailable } from '../features/engines/call'
import { engineById } from '../features/engines/catalog'
import { appendUtterance, createLiveMeeting, finishMeeting, listUtterances, readMeeting } from '../features/desk/store'
import { toUtterance, type EngineUtterance } from '../features/desk/present'
import { draftFromLines, parseWriterNotes, renderMarkdown } from '../features/notes/draft'
import type { CueId } from './settingsState'
import { productLive, type LiveLine } from './fixtures'

type LiveScreenProps = {
  title?: string
  meetingId?: string
  speechId: string
  writerId: string
  coachId: string
  inputDevice: string
  onInputDeviceChange: (deviceId: string) => void
  language: 'auto' | 'english'
  showCues: boolean
  showMeetingIndicator: boolean
  overlayOpacity: number
  overlayPosition: 'center' | 'top-right' | 'top-left' | 'bottom-center'
  cues: Record<CueId, boolean>
  unlocked: boolean
  onUnlock: () => void
  hasWriterKey: boolean
  autoStart: boolean
  onBack: () => void
  onFinished: (meetingId: string) => void
}

const cueLabel: Record<string, string> = {
  'talk-ratio': 'Talk ratio',
  'stacked-questions': 'Stacked questions',
  'no-date': 'Missing date',
  'no-next-steps': 'No next step',
  interrupt: 'Interruption',
}

const cueFlag: Record<string, CueId> = {
  'talk-ratio': 'talk',
  'stacked-questions': 'stacked',
  'no-date': 'date',
  'no-next-steps': 'next',
  interrupt: 'interrupt',
}

export function LiveScreen({
  title,
  meetingId,
  speechId,
  writerId,
  coachId,
  inputDevice,
  onInputDeviceChange,
  language,
  showCues,
  showMeetingIndicator,
  overlayOpacity,
  overlayPosition,
  cues,
  unlocked,
  onUnlock,
  hasWriterKey,
  autoStart,
  onBack,
  onFinished,
}: LiveScreenProps) {
  const demoPlayback = meetingId === 'live-product'
  const [armed, setArmed] = useState(autoStart || demoPlayback)
  const [lines, setLines] = useState<LiveLine[]>([])
  const [device, setDevice] = useState(demoPlayback ? productLive.device : autoStart ? 'Starting…' : 'Not listening')
  const [status, setStatus] = useState(
    demoPlayback
      ? 'Listening to system audio.'
      : autoStart
        ? 'Starting the meeting…'
        : meetingId
          ? 'Paused.'
          : 'Press Start when you want annotated to listen.',
  )
  const [elapsed, setElapsed] = useState(demoPlayback ? productLive.elapsed : '0:00')
  const [mic, setMic] = useState(false)
  const [mics, setMics] = useState<MicOption[]>([{ id: 'default', name: 'Default' }])
  const [overlayOn, setOverlayOn] = useState(showCues)
  const [cuesOnScreen, setCuesOnScreen] = useState<{ id: string; label: string; message: string }[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(meetingId ?? null)
  const [nubDismissed, setNubDismissed] = useState(false)
  const meetingRef = useRef<string | null>(meetingId ?? null)
  const startedAt = useRef(Date.now())
  const listenRef = useRef<ListenHandle | null>(null)
  const linesRef = useRef(lines)
  const micRef = useRef(mic)
  const cuesRef = useRef(cues)
  const showCuesRef = useRef(showCues)
  const coachRef = useRef(coachId)
  const speechRef = useRef(speechId)
  const languageRef = useRef(language)
  const endRef = useRef<() => Promise<void>>(async () => {})
  const speechBlocked = useRef(false)
  const chunking = useRef(false)
  const ending = useRef(false)
  const transcribeRef = useRef<(force?: boolean) => Promise<void>>(async () => {})
  const transcriptEnd = useRef<HTMLDivElement | null>(null)
  micRef.current = mic
  cuesRef.current = cues
  showCuesRef.current = showCues && unlocked
  coachRef.current = coachId
  speechRef.current = speechId
  languageRef.current = language

  useEffect(() => {
    let cancel = false
    void listMicrophones().then((found) => {
      if (!cancel && found.length) setMics(found)
    })
    const onChange = () => {
      void listMicrophones().then((found) => {
        if (!cancel && found.length) setMics(found)
      })
    }
    navigator.mediaDevices?.addEventListener?.('devicechange', onChange)
    return () => {
      cancel = true
      navigator.mediaDevices?.removeEventListener?.('devicechange', onChange)
    }
  }, [])

  useEffect(() => {
    if (meetingId === 'live-product') return
    if (!armed && !meetingId) return
    const timer = window.setInterval(() => {
      const seconds = Math.max(0, Math.round((Date.now() - startedAt.current) / 1000))
      const minutes = Math.floor(seconds / 60)
      setElapsed(`${minutes}:${String(seconds % 60).padStart(2, '0')}`)
    }, 1000)
    return () => window.clearInterval(timer)
  }, [armed, meetingId])

  useEffect(() => {
    if (!meetingId && !armed) return
    let stopped = false
    const boot = (async () => {
      try {
        const meeting = meetingId ? await readMeeting(meetingId) : await createLiveMeeting(title)
        if (stopped) return
        if (!meeting) {
          setStatus('That meeting is no longer on this PC.')
          return
        }
        meetingRef.current = meeting.id
        setSessionId(meeting.id)
        if (typeof meeting.startedAt === 'number') startedAt.current = meeting.startedAt
        if (meetingId) {
          const prior = (await listUtterances(meeting.id)).map(toLive)
          if (!stopped) {
            linesRef.current = prior
            setLines(prior)
            // Demo Product sync already has fixture cues; show them without waiting on coach.scan.
            if (meeting.id === 'live-product' && prior.length > 0) {
              seedDemoCues(meeting.id, prior)
            }
          }
        }
        if (meeting.id === 'live-product') {
          setStatus('Listening to system audio.')
          setElapsed(productLive.elapsed)
        } else {
          setStatus(armed ? 'Listening…' : 'Paused.')
        }
      } catch (error) {
        if (!stopped) setStatus(error instanceof Error ? error.message : 'Could not start the meeting.')
      }
    })()
    void boot
    return () => {
      stopped = true
    }
  }, [meetingId, title, armed])

  useEffect(() => {
    if (!armed || !sessionId) return
    if (meetingId === 'live-product') {
      setDevice(productLive.device)
      setStatus('Listening to system audio.')
      setElapsed(productLive.elapsed)
      return
    }
    let cancelled = false
    ;(async () => {
      listenRef.current?.stop()
      listenRef.current = null
      try {
        const handle = await startListening({ mic, deviceId: inputDevice })
        if (cancelled) {
          handle.stop()
          return
        }
        listenRef.current = handle
        setDevice(handle.label)
        setStatus(
          handle.kind === 'microphone'
            ? 'Listening on the microphone.'
            : mic
              ? 'Listening to system audio and the microphone.'
              : 'Listening to system audio.',
        )
      } catch (error) {
        if (!cancelled) setStatus(error instanceof Error ? error.message : 'Could not open the microphone.')
      }
    })()
    return () => {
      cancelled = true
      listenRef.current?.stop()
      listenRef.current = null
    }
  }, [armed, mic, inputDevice, sessionId, meetingId])

  useEffect(() => {
    const tick = window.setInterval(() => {
      void transcribeRef.current(false)
    }, 8000)
    return () => {
      window.clearInterval(tick)
      void window.crunchcall?.setOverlaySession?.(null)
    }
  }, [])

  useEffect(() => {
    if (armed || sessionId) setNubDismissed(false)
  }, [armed, sessionId])

  useEffect(() => {
    transcriptEnd.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [lines.length])

  useEffect(() => {
    const desktop = Boolean(window.crunchcall?.setOverlaySession)
    if (!desktop) return
    if (!showMeetingIndicator || nubDismissed || ending.current || !(sessionId || armed)) {
      void window.crunchcall?.setOverlaySession?.(null)
      return
    }
    const lead = unlocked && overlayOn && showCues ? cuesOnScreen[0] : undefined
    void window.crunchcall?.setOverlaySession?.({
      meetingId: sessionId ?? meetingRef.current ?? '',
      title: title || 'Live meeting',
      elapsed,
      listening: armed,
      opacity: overlayOpacity,
      position: overlayPosition,
      cue: lead ? { label: lead.label, message: lead.message } : null,
      lines: lines.slice(-3).map((line) => ({
        id: line.id,
        speaker: line.speaker,
        text: line.text,
      })),
    })
  }, [
    showMeetingIndicator,
    nubDismissed,
    sessionId,
    armed,
    title,
    elapsed,
    overlayOpacity,
    overlayPosition,
    unlocked,
    overlayOn,
    showCues,
    cuesOnScreen,
    lines,
  ])

  useEffect(() => {
    return window.crunchcall?.onOverlayAction?.((action) => {
      if (action === 'dismiss') {
        setNubDismissed(true)
        return
      }
      if (action === 'pause') {
        setArmed(false)
        setStatus('Paused.')
        return
      }
      if (action === 'resume') {
        setArmed(true)
        setStatus('Listening…')
        return
      }
      if (action === 'end') {
        void endRef.current()
      }
    })
  }, [])

  async function transcribeChunk(force = false) {
    if (ending.current && !force) return
    if (chunking.current) return
    const handle = listenRef.current
    const id = meetingRef.current
    if (!handle || !id || speechBlocked.current) return
    const pcm = handle.pull()
    const min = Math.max(8000, (handle.sampleRate || 16000) * 0.5)
    if (pcm.length === 0 || (!force && pcm.length < min)) return
    if (!engineAvailable()) {
      speechBlocked.current = true
      setStatus('Desktop engine is not running. Type a line, then end the meeting.')
      return
    }
    const speech = engineById(speechRef.current)
    if (speech && !speech.clientReady) {
      speechBlocked.current = true
      setStatus(`${speech.name} is not linked yet. Type the line, or pick a cloud speech model.`)
      return
    }
    chunking.current = true
    try {
      const result = await callEngine('speech.transcribe', {
        moduleId: speechRef.current,
        language: languageRef.current,
        wavBase64: pcm16ToWavBase64(pcm, handle.sampleRate || 16000),
      })
      if (!result.ok) {
        const lower = result.message.toLowerCase()
        if (
          lower.includes('not linked') ||
          lower.includes('not ready') ||
          lower.includes('not in this build') ||
          lower.includes('api key') ||
          lower.includes('paste the text')
        ) {
          speechBlocked.current = true
        }
        setStatus(result.message)
        return
      }
      const text = readText(result.result)
      if (!text) return
      const speaker = micRef.current && handle.kind === 'microphone' ? 'You' : 'Room'
      await addLine(speaker, text)
    } finally {
      chunking.current = false
    }
  }
  transcribeRef.current = transcribeChunk

  async function addLine(speaker: string, text: string) {
    const id = meetingRef.current
    if (!id) return
    const saved = await appendUtterance(id, speaker, text)
    const line = saved ? toLive(saved) : { id: `local-${Date.now()}`, at: new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }), speaker, you: speaker === 'You', text }
    const next = [...linesRef.current, line]
    linesRef.current = next
    setLines(next)
    await refreshCues(next)
  }

  function seedDemoCues(id: string, next: LiveLine[]) {
    if (!showCuesRef.current || id !== 'live-product' || next.length === 0) {
      if (!showCuesRef.current) setCuesOnScreen([])
      return
    }
    const flags = cuesRef.current
    const visible = productLive.cues.filter((cue) => {
      if (cue.label === 'Missing date') return flags.date !== false
      if (cue.label === 'Stacked questions') return flags.stacked !== false
      if (cue.label === 'Talk ratio') return flags.talk !== false
      return true
    })
    setCuesOnScreen(visible)
  }

  async function refreshCues(next: LiveLine[]) {
    if (!showCuesRef.current) {
      setCuesOnScreen([])
      return
    }
    if (!engineAvailable()) {
      seedDemoCues(meetingRef.current ?? '', next)
      return
    }
    const result = await callEngine('coach.scan', {
      lines: next.map((line) => `${line.speaker}: ${line.text}`),
      pack: coachRef.current,
    })
    if (!result.ok || !result.result || typeof result.result !== 'object') {
      seedDemoCues(meetingRef.current ?? '', next)
      return
    }
    const raw = (result.result as { cues?: { kind?: string; message?: string }[] }).cues ?? []
    const flags = cuesRef.current
    const visible = raw
      .filter((cue) => cue.kind && cue.message && flags[cueFlag[cue.kind] ?? 'talk'] !== false)
      .map((cue, index) => ({
        id: `${cue.kind}-${index}`,
        label: cueLabel[cue.kind ?? ''] ?? 'Cue',
        message: cue.message ?? '',
      }))
    if (visible.length === 0) {
      seedDemoCues(meetingRef.current ?? '', next)
      return
    }
    setCuesOnScreen(visible)
  }

  async function submitLine() {
    const text = draft.trim()
    if (!text) return
    setDraft('')
    await addLine('You', text)
  }

  async function end() {
    const id = meetingRef.current
    if (!id || busy) return
    setBusy(true)
    ending.current = true
    void window.crunchcall?.setOverlaySession?.(null)
    setStatus('Writing notes…')
    const waitUntil = Date.now() + 20000
    while (chunking.current && Date.now() < waitUntil) {
      await new Promise((resolve) => window.setTimeout(resolve, 40))
    }
    await transcribeChunk(true)
    listenRef.current?.stop()
    listenRef.current = null
    const spoken = linesRef.current.map((line) => ({ speaker: line.speaker, text: line.text }))
    const fallback = draftFromLines(spoken)
    fallback.markdown = renderMarkdown(title || 'Meeting', fallback.summary, fallback.takeaways, fallback.actions, spoken)
    let draftNotes = fallback
    const writer = engineById(writerId)
    const writerReady = writer && writer.clientReady && (!writer.needsKey || hasWriterKey)
    if (writerReady && spoken.length && engineAvailable()) {
      const result = await callEngine('writer.complete', {
        moduleId: writerId,
        system: 'You write meeting notes. Return only JSON with keys summary, takeaways, actions, markdown. actions items have text, owner, due. Use null when owner or due is unknown. Do not invent facts.',
        prompt: spoken.map((line) => `${line.speaker}: ${line.text}`).join('\n'),
      })
      if (result.ok) {
        const text = readText(result.result)
        if (text) draftNotes = parseWriterNotes(text, fallback)
      }
    }
    try {
      await finishMeeting(id, draftNotes)
      onFinished(id)
    } catch (error) {
      setBusy(false)
      ending.current = false
      setStatus(error instanceof Error ? error.message : 'Could not save the notes.')
    }
  }
  endRef.current = end

  const lead = unlocked && overlayOn && showCues ? cuesOnScreen[0] : undefined
  const selectedMic = mics.find((item) => item.id === inputDevice) ?? mics[0]
  const micValue = mics.some((item) => item.id === inputDevice) ? inputDevice : 'default'

  return (
    <section className="live-page" aria-labelledby="live-title">
      <header className="live-top">
        <button type="button" className="text-btn live-back" onClick={onBack}>
          ← Meetings
        </button>
        <div className="live-title-row">
          <h1 id="live-title" className="page-title">
            {title || 'Untitled meeting'}
          </h1>
          <div className="head-actions">
            {!armed ? (
              <button type="button" className="btn primary" onClick={() => setArmed(true)}>
                {meetingId || sessionId ? 'Resume' : 'Start'}
              </button>
            ) : (
              <button
                type="button"
                className="btn ghost"
                onClick={() => {
                  setArmed(false)
                  setStatus('Paused.')
                }}
              >
                Pause
              </button>
            )}
            {armed || meetingId || sessionId ? (
              <button
                type="button"
                className="btn ghost"
                onClick={() => void end()}
                disabled={busy || !(meetingId || sessionId)}
              >
                {busy ? 'Saving…' : 'End meeting'}
              </button>
            ) : null}
          </div>
        </div>
      </header>

      <div className="live-toolbar">
        <div className="live-toolbar-row">
          <div className="live-listening">
            <span className={armed ? 'live-dot' : 'live-dot paused'} aria-hidden="true" />
            <span className="live-time">{elapsed}</span>
            <span className="muted live-status-text">{status}</span>
          </div>
          <div className="live-input">
            <button
              type="button"
              className={mic ? 'chip on' : 'chip'}
              aria-pressed={mic}
              onClick={() => setMic((value) => !value)}
            >
              Mic {mic ? 'on' : 'off'}
            </button>
            <label className="live-mic-field">
              <span className="sr">Microphone</span>
              <select
                className="input-select"
                value={micValue}
                aria-label="Choose microphone"
                onChange={(event) => onInputDeviceChange(event.target.value)}
              >
                {mics.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
        <p className="muted live-input-note">
          {mic
            ? `Using ${selectedMic?.name ?? 'Default'}. Source: ${device}.`
            : `Mic off. Source: ${device}.`}
        </p>
      </div>

      <div className="live-body">
        <section className="panel live-transcript" aria-label="Transcript">
          <div className="panel-h">
            <h2>Transcript</h2>
            <span className="muted">{lines.length === 0 ? 'Waiting' : `${lines.length} lines`}</span>
          </div>
          <div className="live-transcript-scroll">
            {lines.length === 0 ? (
              <p className="empty tight">Speech shows up here as the call goes. It stays on this machine unless you picked a cloud speech model.</p>
            ) : (
              <ol className="transcript">
                {lines.map((line) => (
                  <li key={line.id} className={line.you ? 'utter you' : 'utter'}>
                    <time>{line.at}</time>
                    <p>
                      <strong>{line.speaker}</strong>
                      <span>{line.text}</span>
                    </p>
                  </li>
                ))}
              </ol>
            )}
            <div ref={transcriptEnd} />
          </div>
          <form
            className="composer live-composer"
            onSubmit={(event) => {
              event.preventDefault()
              void submitLine()
            }}
          >
            <label className="sr" htmlFor="live-line">
              Add a line
            </label>
            <input
              id="live-line"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Type a line if speech is quiet"
              autoComplete="off"
            />
            <button type="submit" className="btn primary small">
              Add
            </button>
          </form>
        </section>

        <aside className="live-side" aria-label="Coaching">
          {unlocked ? null : (
            <section className="panel" aria-label="Cues">
              <div className="panel-h">
                <h2>Cues</h2>
              </div>
              <p className="empty tight">Live coaching is part of Unlock. Notes from this call stay on this PC either way.</p>
              <button type="button" className="btn small ghost" onClick={onUnlock}>
                Add a license
              </button>
            </section>
          )}
          {unlocked && lead ? (
            <aside className="overlay" aria-label="Live cue">
              <div className="overlay-top">
                <p className="overlay-kicker">Live cue</p>
                <button type="button" onClick={() => setOverlayOn(false)} aria-label="Dismiss cue">
                  ×
                </button>
              </div>
              <p className="overlay-kind">{lead.label}</p>
              <p className="overlay-msg">{lead.message}</p>
              <p className="overlay-safe">Not on your screen share</p>
            </aside>
          ) : null}
          {unlocked ? (
            <section className="panel" aria-label="Cues">
              <div className="panel-h">
                <h2>Cues</h2>
                {!overlayOn && cuesOnScreen[0] ? (
                  <button type="button" className="text-btn" onClick={() => setOverlayOn(true)}>
                    Show cue
                  </button>
                ) : null}
              </div>
              {cuesOnScreen.length === 0 ? (
                <p className="empty tight">Cues land here mid-call. They stay off your screen share.</p>
              ) : (
                <ul className="cue-list">
                  {cuesOnScreen.map((cue) => (
                    <li key={cue.id} className="cue">
                      <p className="cue-kind">{cue.label}</p>
                      <p>{cue.message}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : null}
        </aside>
      </div>
    </section>
  )
}

function toLive(row: EngineUtterance): LiveLine {
  const line = toUtterance(row)
  return { id: line.id, at: line.at, speaker: line.speaker, you: line.you, text: line.text }
}

function readText(result: unknown): string {
  if (!result || typeof result !== 'object') return ''
  const text = (result as { text?: unknown }).text
  return typeof text === 'string' ? text.trim() : ''
}
