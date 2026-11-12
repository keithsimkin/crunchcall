import { useEffect, useRef, useState } from 'react'
import { callEngine } from '../features/engines/call'
import { engineById, engineDefaults } from '../features/engines/catalog'
import { prependDictation } from '../features/dictate/history'
import { downsampleToPcm16, pcm16ToBase64, readDictationText, readSessionId } from '../features/dictate/pcm'

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

export function DictatePopup({ speechId, open, onOpenChange }: DictatePopupProps) {
  const speech = engineById(speechId) ?? engineById(engineDefaults.speech)
  const [listening, setListening] = useState(false)
  const [draft, setDraft] = useState('')
  const [status, setStatus] = useState('Press Ctrl + Win and speak')
  const holdingRef = useRef(false)
  const sessionRef = useRef<string | null>(null)
  const audioRef = useRef<LiveAudio | null>(null)
  const generation = useRef(0)
  const openRef = useRef(open)
  const beginRef = useRef<() => Promise<void>>(async () => {})
  const endRef = useRef<(commit: boolean) => Promise<void>>(async () => {})

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
        setStatus('Press Ctrl + Win and speak')
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
    function onEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      if (!openRef.current && !holdingRef.current) return
      event.preventDefault()
      void endRef.current(false)
    }

    window.addEventListener('keydown', onEscape, true)

    // Desktop: Electron owns Ctrl+Win globally (toggle). Web: hold Ctrl+Win / Ctrl+Cmd.
    if (window.crunchcall?.onDictateHotkey) {
      const stopHotkey = window.crunchcall.onDictateHotkey((phase) => {
        if (phase === 'start') void beginRef.current()
        else void endRef.current(true)
      })
      return () => {
        window.removeEventListener('keydown', onEscape, true)
        stopHotkey()
      }
    }

    function chordDown(event: KeyboardEvent) {
      if (event.repeat) return
      if (!(event.ctrlKey && event.metaKey)) return
      event.preventDefault()
      void beginRef.current()
    }

    function chordUp(event: KeyboardEvent) {
      if (!holdingRef.current) return
      if (event.key !== 'Control' && event.key !== 'Meta' && event.key !== 'OS') return
      void endRef.current(true)
    }

    window.addEventListener('keydown', chordDown, true)
    window.addEventListener('keyup', chordUp, true)
    return () => {
      window.removeEventListener('keydown', onEscape, true)
      window.removeEventListener('keydown', chordDown, true)
      window.removeEventListener('keyup', chordUp, true)
    }
  }, [])

  if (!open && !listening) return null

  return (
    <div className="dictate-flow" role="status" aria-live="polite">
      <div className={listening ? 'dictate-bar listening' : 'dictate-bar'}>
        <span className="dictate-pulse" aria-hidden="true" />
        <div className="dictate-bar-copy">
          <strong>{listening ? 'Dictate here' : draft ? 'Ready' : 'Dictate here'}</strong>
          <p>{draft || status}</p>
        </div>
        <div className="dictate-bar-actions">
          {listening ? (
            <button type="button" className="btn small ghost" onClick={() => void endListen(false)}>
              Esc
            </button>
          ) : null}
          {listening ? (
            <button type="button" className="btn small primary" onClick={() => void endListen(true)}>
              Done
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
