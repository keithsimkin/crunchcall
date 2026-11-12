import { listedDictations, type DictationRow } from '../../ui/fixtures'

const KEY = 'crunchcall.dictations'
const EVENT = 'crunchcall:dictations'

function clock(): string {
  return new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

export function readDictations(): DictationRow[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return listedDictations.map((row) => ({ ...row }))
    const parsed = JSON.parse(raw) as DictationRow[]
    if (!Array.isArray(parsed)) return listedDictations.map((row) => ({ ...row }))
    return parsed
  } catch {
    return listedDictations.map((row) => ({ ...row }))
  }
}

export function writeDictations(rows: DictationRow[]): void {
  localStorage.setItem(KEY, JSON.stringify(rows))
  window.dispatchEvent(new CustomEvent(EVENT))
}

export function prependDictation(text: string): DictationRow | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  const row: DictationRow = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    at: clock(),
    day: 'Today',
    text: trimmed,
  }
  writeDictations([row, ...readDictations()])
  return row
}

export function onDictationsChange(callback: () => void): () => void {
  function onStorage(event: StorageEvent) {
    if (event.key === KEY) callback()
  }
  window.addEventListener(EVENT, callback)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(EVENT, callback)
    window.removeEventListener('storage', onStorage)
  }
}

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}
