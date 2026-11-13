import { useEffect, useRef, useState } from 'react'
import { callEngine } from '../features/engines/call'
import { engineById, engineDefaults } from '../features/engines/catalog'
import { prependDictation } from '../features/dictate/history'
import { downsampleToPcm16, pcm16ToBase64, readDictationText, readSessionId } from '../features/dictate/pcm'
import { defaultShortcutBindings, formatChord, type DictateMode, type ShortcutChord } from './shortcuts'

type LiveAudio = {
  context: AudioContext
  stream: MediaStream
  source: MediaStreamAudioSourceNode
  processor: ScriptProcessorNode
  mute: GainNode
}

type DictatePopupProps = {
  speechId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  chord?: ShortcutChord
  mode?: DictateMode
}

function releaseAudio(audio: LiveAudio | null) {
  if (!audio) return
  audio.processor.onaudioprocess = null
  audio.processor.disconnect()
  audio.source.disconnect()
  audio.mute.disconnect()
  audio.stream.getTracks().forEach((track) => track.stop())
  void audio.context.close()
}

const WAVE_BARS = 28

export function DictatePopup({
  speechId,
  open,
  onOpenChange,
  chord = defaultShortcutBindings['dictate.global'],
  mode = 'toggle',
}: DictatePopupProps) {
  const speech = engineById(speechId) ?? engineById(engineDefaults.speech)
  const prompt = `Press ${formatChord(chord)} and speak`
  const [listening, setListening] = useState(false)
  const [draft, setDraft] = useState('')
  const [status, setStatus] = useState(prompt)
  const [levels, setLevels] = useState<number[]>(() => Array.from({ length: WAVE_BARS }, () => 0.08))
  const holdingRef = useRef(false)
  const sessionRef = useRef<string | null>(null)
  const audioRef = useRef<LiveAudio | null>(null)
  const generation = useRef(0)
  const openRef = useRef(open)
  const modeRef = useRef(mode)
  const chordRef = useRef(chord)
  const beginRef = useRef<() => Promise<void>>(async () => {})
  const endRef = useRef<(commit: boolean) => Promise<void>>(async () => {})
  const levelTick = useRef(0)

  useEffect(() => {
    modeRef.current = mode
    chordRef.current = chord
    if (!listening && !holdingRef.current) setStatus(prompt)
  }, [chord, mode, prompt, listening])

  useEffect(() => {
    openRef.current = open
  }, [open])

  async function beginListen() {
    if (!speech || holdingRef.current) return
    if (speech.where === 'external') {
      onOpenChange(true)
      setListening(false)
      setStatus(`Pick an in-app speech engine — ${speech.name} keeps its own hotkey`)
      return
    }
    const gen = generation.current + 1
    generation.current = gen
    holdingRef.current = true
    setListening(true)
    setDraft('')
    setLevels(Array.from({ length: WAVE_BARS }, () => 0.08))
    setStatus('Listening…')
    onOpenChange(true)

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (error) {
      if (generation.current === gen) {
        holdingRef.current = false
        setListening(false)
        setStatus(error instanceof Error ? error.message : 'Microphone unavailable')
      }
      return
    }

    if (!window.crunchcall?.engine) {
      stream.getTracks().forEach((track) => track.stop())
      holdingRef.current = false
      setListening(false)
      setStatus('The desktop engine is not running, so this cannot transcribe.')
      return
    }

    if (!holdingRef.current || generation.current !== gen) {
      stream.getTracks().forEach((track) => track.stop())
      return
    }

    const started = await callEngine('dictate.start', { moduleId: speech.id, sampleRate: 16000 })
    if (!holdingRef.current || generation.current !== gen) {
      stream.getTracks().forEach((track) => track.stop())
      if (started.ok) {
        const sessionId = readSessionId(started.result)
        if (sessionId) void callEngine('dictate.stop', { sessionId })
      }
      return
    }
    if (!started.ok) {
      stream.getTracks().forEach((track) => track.stop())
      holdingRef.current = false
      setListening(false)
      setStatus(started.message)
      return
    }

    const sessionId = readSessionId(started.result)
    if (!sessionId) {
      stream.getTracks().forEach((track) => track.stop())
      holdingRef.current = false
      setListening(false)
      setStatus('Could not start dictation')
      return
    }

    sessionRef.current = sessionId
    const context = new AudioContext()
    const source = context.createMediaStreamSource(stream)
    const processor = context.createScriptProcessor(4096, 1, 1)
    const mute = context.createGain()
    mute.gain.value = 0
    processor.onaudioprocess = (event) => {
      if (sessionRef.current !== sessionId || generation.current !== gen) return
      const channel = event.inputBuffer.getChannelData(0)
      levelTick.current += 1
      if (levelTick.current % 2 === 0) {
        const step = Math.max(1, Math.floor(channel.length / WAVE_BARS))
        const next = Array.from({ length: WAVE_BARS }, (_, index) => {
          let peak = 0
          const start = index * step
          const end = Math.min(channel.length, start + step)
          for (let i = start; i < end; i += 1) {
            const value = Math.abs(channel[i] ?? 0)
            if (value > peak) peak = value
          }
          const envelope = 0.35 + 0.65 * Math.sin((index / (WAVE_BARS - 1)) * Math.PI)
          return Math.min(1, Math.max(0.06, peak * 4.2 * envelope))
        })
        setLevels(next)
      }
      const pcm = downsampleToPcm16(channel, context.sampleRate)
      if (pcm.length === 0) return
      void callEngine('dictate.push', { sessionId, pcmBase64: pcm16ToBase64(pcm) }).then((result) => {
        if (result.ok || generation.current !== gen) return
        setStatus(result.message)
        void endListen(false)
      })
    }
    source.connect(processor)
    processor.connect(mute)
    mute.connect(context.destination)
    audioRef.current = { context, stream, source, processor, mute }
  }

  async function endListen(commit: boolean) {
    if (!holdingRef.current && !sessionRef.current && !audioRef.current) {
      if (!commit) onOpenChange(false)
      return
    }
    holdingRef.current = false
    generation.current += 1
    setListening(false)
    setLevels(Array.from({ length: WAVE_BARS }, () => 0.08))
    const audio = audioRef.current
    audioRef.current = null
    const sessionId = sessionRef.current
    sessionRef.current = null
    releaseAudio(audio)

    let text = draft.trim()
    if (sessionId) {
      setStatus('Transcribing…')
      const stopped = await callEngine('dictate.stop', { sessionId })
      if (!stopped.ok) {
        setStatus(stopped.message)
        return
      }
      text = readDictationText(stopped.result).trim() || text
    }

    if (!commit || !text) {
      setDraft('')
      setStatus(commit ? 'Nothing captured' : 'Cancelled')
      window.setTimeout(() => {
        if (!holdingRef.current) onOpenChange(false)
      }, 700)
      return
    }

    setDraft(text)
    setStatus('Inserting…')
    prependDictation(text)
    if (window.crunchcall?.pasteDictation) {
      await window.crunchcall.pasteDictation(text)
    } else {
      try {
        await navigator.clipboard.writeText(text)
      } catch {
        /* ignore */
      }
    }
    setStatus('Inserted')
    window.setTimeout(() => {
      if (!holdingRef.current) {
        setDraft('')
        setStatus(prompt)
        onOpenChange(false)
      }
    }, 900)
  }

  useEffect(() => {
    beginRef.current = beginListen
    endRef.current = endListen
  })

  useEffect(() => {
    return () => {
      holdingRef.current = false
      generation.current += 1
      const audio = audioRef.current
      audioRef.current = null
      const sessionId = sessionRef.current
      sessionRef.current = null
      releaseAudio(audio)
      if (sessionId && window.crunchcall?.engine) void callEngine('dictate.stop', { sessionId })
    }
  }, [])

  useEffect(() => {
    function matchesConfiguredChord(event: KeyboardEvent) {
      const want = chordRef.current
      if (Boolean(event.ctrlKey) !== want.ctrl) return false
      if (Boolean(event.shiftKey) !== want.shift) return false
      if (Boolean(event.altKey) !== want.alt) return false
      if (Boolean(event.metaKey) !== want.meta) return false
      if (!want.key) return true
      return event.key.toLowerCase() === want.key
    }

    function chordStillHeld(event: KeyboardEvent) {
      const want = chordRef.current
      if (want.ctrl && event.key === 'Control') return false
      if (want.meta && (event.key === 'Meta' || event.key === 'OS')) return false
      if (want.alt && event.key === 'Alt') return false
      if (want.shift && event.key === 'Shift') return false
      if (want.key && event.key.toLowerCase() === want.key) return false
      return true
    }

    function onEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      if (!openRef.current && !holdingRef.current) return
      event.preventDefault()
      void endRef.current(false)
    }

    window.addEventListener('keydown', onEscape, true)

    // Desktop: Electron owns the global chord. Toggle uses start/stop IPC;
    // hold starts on press and finishes when modifiers are released.
    if (window.crunchcall?.onDictateHotkey) {
      const stopHotkey = window.crunchcall.onDictateHotkey((phase) => {
        if (phase === 'start') void beginRef.current()
        else void endRef.current(true)
      })
      function onHoldRelease(event: KeyboardEvent) {
        if (modeRef.current !== 'hold' || !holdingRef.current) return
        if (chordStillHeld(event)) return
        void endRef.current(true)
      }
      window.addEventListener('keyup', onHoldRelease, true)
      return () => {
        window.removeEventListener('keydown', onEscape, true)
        window.removeEventListener('keyup', onHoldRelease, true)
        stopHotkey()
      }
    }

    function chordDown(event: KeyboardEvent) {
      if (event.repeat) return
      if (!matchesConfiguredChord(event)) return
      event.preventDefault()
      if (modeRef.current === 'toggle' && holdingRef.current) {
        void endRef.current(true)
        return
      }
      void beginRef.current()
    }

    function chordUp(event: KeyboardEvent) {
      if (!holdingRef.current) return
      if (modeRef.current === 'toggle') return
      if (chordStillHeld(event)) return
      void endRef.current(true)
    }

    window.addEventListener('keydown', chordDown, true)
    window.addEventListener('keyup', chordUp, true)
    return () => {
      window.removeEventListener('keydown', onEscape, true)
      window.removeEventListener('keydown', chordDown, true)
      window.removeEventListener('keyup', chordUp, true)
    }
  }, [prompt])

  if (!open && !listening) return null

  return (
    <div className="dictate-flow" role="status" aria-live="polite" aria-label={draft || status}>
      <div className={listening ? 'dictate-bar listening' : 'dictate-bar'}>
        <button
          type="button"
          className="dictate-pill-btn cancel"
          aria-label="Cancel dictation"
          onClick={() => void endListen(false)}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M6.5 6.5l11 11M17.5 6.5l-11 11"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
            />
          </svg>
        </button>
        <div className="dictate-wave" aria-hidden="true">
          {levels.map((level, index) => (
            <span
              key={index}
              className="dictate-wave-bar"
              style={{ height: `${Math.round(8 + level * 22)}px` }}
            />
          ))}
        </div>
        <button
          type="button"
          className="dictate-pill-btn confirm"
          aria-label="Insert dictation"
          disabled={!listening && !draft}
          onClick={() => void endListen(true)}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M5.5 12.5l4.2 4.2L18.5 7.8"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
    </div>
  )
}
