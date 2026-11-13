export type ShortcutId =
  | 'nav.home'
  | 'nav.live'
  | 'nav.dictate'
  | 'nav.search'
  | 'nav.calendar'
  | 'nav.projects'
  | 'nav.shortcuts'
  | 'nav.connect'
  | 'meeting.new'
  | 'settings.listening'
  | 'settings.speech'
  | 'settings.notes'
  | 'settings.machine'
  | 'dictate.global'

export type ShortcutGroup = 'go' | 'settings' | 'dictate'

export type DictateMode = 'toggle' | 'hold'

export type ShortcutChord = {
  ctrl: boolean
  shift: boolean
  alt: boolean
  meta: boolean
  key: string
}

export type ShortcutBindings = Record<ShortcutId, ShortcutChord>

export type ShortcutDef = {
  id: ShortcutId
  label: string
  help: string
  group: ShortcutGroup
}

export const shortcutCatalog: ShortcutDef[] = [
  { id: 'nav.home', label: 'Home', help: 'Meeting history on this PC', group: 'go' },
  { id: 'meeting.new', label: 'New meeting', help: 'Start a fresh live session', group: 'go' },
  { id: 'nav.live', label: 'Live', help: 'Open the live capture screen', group: 'go' },
  { id: 'nav.dictate', label: 'Dictate screen', help: 'History and stats for dictation', group: 'go' },
  { id: 'nav.search', label: 'Search notes', help: 'Search inside Projects by person, topic, or next step', group: 'go' },
  { id: 'nav.calendar', label: 'Calendar', help: 'What’s next, and the link that feeds it', group: 'go' },
  { id: 'nav.projects', label: 'Projects', help: 'The folder desk, including search', group: 'go' },
  { id: 'nav.shortcuts', label: 'This page', help: 'Open the shortcuts list', group: 'go' },
  { id: 'nav.connect', label: 'Connect', help: 'Local MCP so other tools can read curated notes', group: 'go' },
  { id: 'settings.listening', label: 'Listening', help: 'Mic, speech engine, and live cues', group: 'settings' },
  { id: 'settings.speech', label: 'Speech', help: 'Dictation and call speech models, downloads, and keys', group: 'settings' },
  { id: 'settings.notes', label: 'Notes', help: 'Writers, coaching, downloads, and cloud keys', group: 'settings' },
  { id: 'settings.machine', label: 'This PC', help: 'Theme, setup, restore, and local paths', group: 'settings' },
  {
    id: 'dictate.global',
    label: 'Dictate anywhere',
    help: 'System-wide dictation into the focused app',
    group: 'dictate',
  },
]

export const dictateModeOptions: [DictateMode, string][] = [
  ['toggle', 'Toggle'],
  ['hold', 'Hold'],
]

const defaultList: [ShortcutId, ShortcutChord][] = [
  ['nav.home', { ctrl: true, shift: false, alt: false, meta: false, key: '1' }],
  ['nav.live', { ctrl: true, shift: false, alt: false, meta: false, key: '2' }],
  ['nav.dictate', { ctrl: true, shift: false, alt: false, meta: false, key: '3' }],
  ['nav.search', { ctrl: true, shift: false, alt: false, meta: false, key: '4' }],
  ['nav.calendar', { ctrl: true, shift: false, alt: false, meta: false, key: '5' }],
  ['nav.projects', { ctrl: true, shift: false, alt: false, meta: false, key: '6' }],
  ['nav.shortcuts', { ctrl: true, shift: false, alt: false, meta: false, key: '7' }],
  ['nav.connect', { ctrl: true, shift: false, alt: false, meta: false, key: '8' }],
  ['meeting.new', { ctrl: true, shift: false, alt: false, meta: false, key: 'n' }],
  ['settings.listening', { ctrl: true, shift: false, alt: false, meta: false, key: ',' }],
  ['settings.speech', { ctrl: true, shift: true, alt: false, meta: false, key: 'm' }],
  ['settings.notes', { ctrl: true, shift: true, alt: false, meta: false, key: 'k' }],
  ['settings.machine', { ctrl: true, shift: true, alt: false, meta: false, key: 'p' }],
  ['dictate.global', { ctrl: true, shift: false, alt: false, meta: true, key: '' }],
]

export const defaultShortcutBindings: ShortcutBindings = Object.fromEntries(defaultList) as ShortcutBindings

export function defaultDictateMode(): DictateMode {
  return 'toggle'
}

export function readDictateMode(value: unknown): DictateMode {
  return value === 'hold' ? 'hold' : 'toggle'
}

function normalizeKey(raw: string): string {
  const key = raw.trim().toLowerCase()
  if (key === 'escape') return 'esc'
  if (key === ' ') return 'space'
  if (key === 'arrowup') return 'up'
  if (key === 'arrowdown') return 'down'
  if (key === 'arrowleft') return 'left'
  if (key === 'arrowright') return 'right'
  if (key === 'control' || key === 'ctrl' || key === 'shift' || key === 'alt' || key === 'meta' || key === 'os') {
    return ''
  }
  return key.length === 1 || key.length > 1 ? key : ''
}

export function normalizeChord(value: unknown): ShortcutChord | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const key = typeof raw.key === 'string' ? normalizeKey(raw.key) : ''
  const ctrl = Boolean(raw.ctrl)
  const shift = Boolean(raw.shift)
  const alt = Boolean(raw.alt)
  const meta = Boolean(raw.meta)
  if (!key && !meta && !ctrl && !alt) return null
  // Modifier-only chords (e.g. Ctrl+Win) are allowed when meta/ctrl are set.
  if (!key && !(meta || ctrl || alt)) return null
  return { ctrl, shift, alt, meta, key }
}

export function readShortcutBindings(value: unknown): ShortcutBindings {
  const next: ShortcutBindings = { ...defaultShortcutBindings }
  if (!value || typeof value !== 'object') return next
  const raw = value as Record<string, unknown>
  for (const def of shortcutCatalog) {
    const chord = normalizeChord(raw[def.id])
    if (chord) next[def.id] = chord
  }
  return next
}

export function chordsEqual(a: ShortcutChord, b: ShortcutChord): boolean {
  return a.ctrl === b.ctrl && a.shift === b.shift && a.alt === b.alt && a.meta === b.meta && a.key === b.key
}

export function findShortcutConflict(
  bindings: ShortcutBindings,
  id: ShortcutId,
  chord: ShortcutChord,
): ShortcutId | null {
  for (const def of shortcutCatalog) {
    if (def.id === id) continue
    if (chordsEqual(bindings[def.id], chord)) return def.id
  }
  return null
}

export function chordFromEvent(event: KeyboardEvent): ShortcutChord | null {
  const key = normalizeKey(event.key)
  const ctrl = event.ctrlKey
  const shift = event.shiftKey
  const alt = event.altKey
  const meta = event.metaKey
  if (!key) {
    // Allow recording Ctrl+Win (meta) with no other key.
    if ((ctrl || alt) && meta) return { ctrl, shift, alt, meta, key: '' }
    return null
  }
  if (!ctrl && !meta && !alt && key !== 'esc') return null
  return { ctrl, shift, alt, meta, key }
}

export function eventMatchesChord(event: KeyboardEvent, chord: ShortcutChord): boolean {
  if (Boolean(event.ctrlKey) !== chord.ctrl) return false
  if (Boolean(event.shiftKey) !== chord.shift) return false
  if (Boolean(event.altKey) !== chord.alt) return false
  if (Boolean(event.metaKey) !== chord.meta) return false
  if (!chord.key) return false
  return normalizeKey(event.key) === chord.key
}

const displayKey: Record<string, string> = {
  ',': ',',
  '.': '.',
  '/': '/',
  ';': ';',
  "'": "'",
  '[': '[',
  ']': ']',
  '\\': '\\',
  '`': '`',
  '-': '-',
  '=': '=',
  space: 'Space',
  esc: 'Esc',
  enter: 'Enter',
  tab: 'Tab',
  backspace: 'Backspace',
  delete: 'Delete',
  up: '↑',
  down: '↓',
  left: '←',
  right: '→',
}

export function chordLabels(chord: ShortcutChord): string[] {
  const parts: string[] = []
  if (chord.ctrl) parts.push('Ctrl')
  if (chord.alt) parts.push('Alt')
  if (chord.shift) parts.push('Shift')
  if (chord.meta) parts.push(typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? 'Cmd' : 'Win')
  if (chord.key) {
    const pretty = displayKey[chord.key] ?? (chord.key.length === 1 ? chord.key.toUpperCase() : chord.key)
    parts.push(pretty)
  }
  return parts.length ? parts : ['—']
}

export function formatChord(chord: ShortcutChord): string {
  return chordLabels(chord).join(' + ')
}

/** Electron accelerator string for globalShortcut.register */
export function toElectronAccelerator(chord: ShortcutChord): string {
  const parts: string[] = []
  if (chord.ctrl) parts.push('Control')
  if (chord.alt) parts.push('Alt')
  if (chord.shift) parts.push('Shift')
  if (chord.meta) parts.push(processPlatform() === 'darwin' ? 'Meta' : 'Super')
  if (chord.key) {
    const keyMap: Record<string, string> = {
      ',': ',',
      '.': '.',
      '/': '/',
      ';': ';',
      "'": "'",
      '[': '[',
      ']': ']',
      '\\': '\\',
      '`': '`',
      '-': '-',
      '=': '=',
      space: 'Space',
      esc: 'Escape',
      enter: 'Enter',
      tab: 'Tab',
      backspace: 'Backspace',
      delete: 'Delete',
      up: 'Up',
      down: 'Down',
      left: 'Left',
      right: 'Right',
    }
    parts.push(keyMap[chord.key] ?? (chord.key.length === 1 ? chord.key.toUpperCase() : chord.key))
  }
  return parts.join('+')
}

function processPlatform(): string {
  try {
    return typeof process !== 'undefined' && process.platform ? process.platform : 'win32'
  } catch {
    return 'win32'
  }
}

export function shortcutLabel(id: ShortcutId): string {
  return shortcutCatalog.find((item) => item.id === id)?.label ?? id
}
