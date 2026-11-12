import { useEffect, useState } from 'react'
import { callEngine, engineAvailable } from '../features/engines/call'
import { engineById, engineDefaults, engineModules } from '../features/engines/catalog'
import { useTheme, type ThemePreference } from './theme'
import { ListenIcon, MeetingsIcon, MicIcon, PcIcon } from './icons'

export type SettingsSection = 'listening' | 'speech' | 'notes' | 'machine'

export const settingsItems: { id: SettingsSection; label: string; hint: string; icon: typeof ListenIcon; find: string }[] = [
  {
    id: 'listening',
    label: 'Listening',
    hint: 'Mic, language, cues',
    icon: ListenIcon,
    find: 'audio input microphone mic default headset cues speech willow whisper dictate groq language',
  },
  {
    id: 'speech',
    label: 'Speech',
    hint: 'Dictation & call audio',
    icon: MicIcon,
    find: 'whisper speech tiny small dictate dictation model download local cloud api key groq deepgram assemblyai willow external',
  },
  {
    id: 'notes',
    label: 'Notes',
    hint: 'Writers, coaching, keys',
    icon: MeetingsIcon,
    find: 'notes writer qwen llama model download coach coaching gemini claude openai anthropic api key credential secret cloud local',
  },
  {
    id: 'machine',
    label: 'This PC',
    hint: 'Name, theme, startup',
    icon: PcIcon,
    find: 'pc path folder version login local models windows startup appearance theme light dark system onboarding setup name restore defaults reset update updates github latest check release',
  },
]

export type SupportActionId = 'restore' | 'support' | 'help'

export const supportItems: {
  id: SupportActionId
  label: string
  find: string
  external?: boolean
  href?: string
}[] = [
  {
    id: 'restore',
    label: 'Restore defaults',
    find: 'restore defaults reset factory fresh clear',
  },
  {
    id: 'support',
    label: 'Get support',
    find: 'support help contact email feedback bug',
    href: 'mailto:hello@crunchcall.app?subject=CrunchCall%20support',
  },
  {
    id: 'help',
    label: 'Help center',
    find: 'help center docs documentation guide faq',
    external: true,
    href: 'https://github.com/search?q=crunchcall&type=repositories',
  },
]

export type InputDevice = 'default' | 'array' | 'headset' | 'external'
export type CueId = 'talk' | 'stacked' | 'date' | 'next' | 'interrupt'
export type SpeechLanguage = 'auto' | 'english'

export const inputDevices: { id: InputDevice; name: string }[] = [
  { id: 'default', name: 'Default' },
  { id: 'array', name: 'Microphone array' },
  { id: 'headset', name: 'Headset microphone' },
  { id: 'external', name: 'External microphone' },
]

export const cueOptions: { id: CueId; name: string; help: string }[] = [
  { id: 'talk', name: 'Talk ratio', help: 'When one person is carrying the call.' },
  { id: 'stacked', name: 'Stacked topics', help: 'When the call jumps without closing the last point.' },
  { id: 'date', name: 'Missing date', help: 'When a next step has no day attached.' },
  { id: 'next', name: 'No next step', help: 'When the call is ending without an owner or action.' },
  { id: 'interrupt', name: 'Interruptions', help: 'When someone keeps getting cut off.' },
]

type StoredSettings = {
  speechId: string
  writerId: string
  coachId: string
  language: SpeechLanguage
  modelOverrides: Record<string, string>
  input: InputDevice
  cues: Record<CueId, boolean>
  showCues: boolean
  launchAtLogin: boolean
}

const storageKey = 'crunchcall.settings'

function readStringMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object') return {}
  const out: Record<string, string> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (typeof item === 'string') out[key] = item
  }
  return out
}

function defaultCues(): Record<CueId, boolean> {
  return {
    talk: true,
    stacked: true,
    date: true,
    next: true,
    interrupt: false,
  }
}

function readCues(value: unknown): Record<CueId, boolean> {
  const base = defaultCues()
  if (!value || typeof value !== 'object') return base
  const raw = value as Record<string, unknown>
  for (const id of Object.keys(base) as CueId[]) {
    if (typeof raw[id] === 'boolean') base[id] = raw[id]
  }
  return base
}

function loadSettings(): StoredSettings {
  const fallback: StoredSettings = {
    speechId: engineDefaults.speech,
    writerId: engineDefaults.writer,
    coachId: engineDefaults.coach,
    language: 'auto',
    modelOverrides: {},
    input: 'default',
    cues: defaultCues(),
    showCues: true,
    launchAtLogin: false,
  }
  try {
    const raw = localStorage.getItem(storageKey)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as Partial<StoredSettings>
    return {
      speechId: typeof parsed.speechId === 'string' ? parsed.speechId : fallback.speechId,
      writerId: typeof parsed.writerId === 'string' ? parsed.writerId : fallback.writerId,
      coachId: typeof parsed.coachId === 'string' ? parsed.coachId : fallback.coachId,
      language: parsed.language === 'english' ? 'english' : 'auto',
      modelOverrides: readStringMap(parsed.modelOverrides),
      input:
        parsed.input === 'array' || parsed.input === 'headset' || parsed.input === 'external'
          ? parsed.input
          : 'default',
      cues: readCues(parsed.cues),
      showCues: typeof parsed.showCues === 'boolean' ? parsed.showCues : true,
      launchAtLogin: typeof parsed.launchAtLogin === 'boolean' ? parsed.launchAtLogin : false,
    }
  } catch {
    return fallback
  }
}

export type SettingsHandlers = ReturnType<typeof useSettingsState>

export function useSettingsState() {
  const initial = loadSettings()
  const { preference, setPreference, resolved } = useTheme()
  const [speechId, setSpeechId] = useState(initial.speechId)
  const [writerId, setWriterId] = useState(initial.writerId)
  const [coachId, setCoachId] = useState(initial.coachId)
  const [language, setLanguage] = useState<SpeechLanguage>(initial.language)
  const [modelOverrides, setModelOverrides] = useState<Record<string, string>>(initial.modelOverrides)
  const [input, setInput] = useState<InputDevice>(initial.input)
  const [cues, setCues] = useState(initial.cues)
  const [showCues, setShowCues] = useState(initial.showCues)
  const [launchAtLogin, setLaunchAtLogin] = useState(initial.launchAtLogin)
  const [keys, setKeys] = useState<Record<string, string>>({})
  const [savedKeys, setSavedKeys] = useState<Record<string, boolean>>({})
  const [engineError, setEngineError] = useState<string | null>(null)

  useEffect(() => {
    const payload: StoredSettings = {
      speechId,
      writerId,
      coachId,
      language,
      modelOverrides,
      input,
      cues,
      showCues,
      launchAtLogin,
    }
    localStorage.setItem(storageKey, JSON.stringify(payload))
  }, [speechId, writerId, coachId, language, modelOverrides, input, cues, showCues, launchAtLogin])

  useEffect(() => {
    if (!engineAvailable()) return
    let cancelled = false
    async function hydrate() {
      const next: Record<string, boolean> = {}
      for (const item of engineModules) {
        if (!item.needsKey) continue
        const result = await callEngine('secrets.has', { moduleId: item.id })
        if (cancelled) return
        if (!result.ok) {
          setEngineError(result.message)
          return
        }
        const saved = Boolean((result.result as { saved?: unknown } | null)?.saved)
        if (saved) next[item.id] = true
      }
      if (cancelled) return
      setSavedKeys(next)
      setEngineError(null)
    }
    void hydrate()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!engineAvailable()) return
    void callEngine('settings.set', {
      values: {
        speech: speechId,
        writer: writerId,
        coach: coachId,
        language,
        modelOverrides,
      },
    })
  }, [speechId, writerId, coachId, language, modelOverrides])

  function setKey(id: string, value: string) {
    setKeys((current) => ({ ...current, [id]: value }))
  }

  async function commitKey(id: string, value: string) {
    if (!engineAvailable()) {
      setEngineError('Keys save in the desktop app.')
      return
    }
    const trimmed = value.trim()
    if (!trimmed) {
      const cleared = await callEngine('secrets.delete', { moduleId: id })
      if (!cleared.ok) {
        setEngineError(cleared.message)
        return
      }
      setSavedKeys((current) => {
        const next = { ...current }
        delete next[id]
        return next
      })
      setKeys((current) => {
        const next = { ...current }
        delete next[id]
        return next
      })
      setEngineError(null)
      return
    }
    const saved = await callEngine('secrets.put', { moduleId: id, key: trimmed })
    if (!saved.ok) {
      setEngineError(saved.message)
      return
    }
    setSavedKeys((current) => ({ ...current, [id]: true }))
    setKeys((current) => ({ ...current, [id]: '' }))
    setEngineError(null)
  }

  function setModelOverride(moduleId: string, value: string) {
    const trimmed = value.trim()
    setModelOverrides((current) => {
      const fallback = engineById(moduleId)?.model ?? ''
      if (!trimmed || trimmed === fallback) {
        if (!(moduleId in current)) return current
        const next = { ...current }
        delete next[moduleId]
        return next
      }
      return { ...current, [moduleId]: trimmed }
    })
  }

  function toggleCue(id: CueId) {
    setCues((current) => ({ ...current, [id]: !current[id] }))
  }

  function reset() {
    setSpeechId(engineDefaults.speech)
    setWriterId(engineDefaults.writer)
    setCoachId(engineDefaults.coach)
    setLanguage('auto')
    setModelOverrides({})
    setInput('default')
    setCues(defaultCues())
    setShowCues(true)
    setLaunchAtLogin(false)
    setKeys({})
    setEngineError(null)
  }

  return {
    speechId,
    setSpeechId,
    writerId,
    setWriterId,
    coachId,
    setCoachId,
    language,
    setLanguage,
    modelOverrides,
    setModelOverride,
    input,
    setInput,
    cues,
    toggleCue,
    showCues,
    setShowCues,
    launchAtLogin,
    setLaunchAtLogin,
    theme: preference,
    setTheme: setPreference as (next: ThemePreference) => void,
    resolvedTheme: resolved,
    keys,
    setKey,
    savedKeys,
    commitKey,
    engineError,
    reset,
  }
}
