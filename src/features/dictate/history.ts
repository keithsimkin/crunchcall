import { callEngine, engineAvailable } from '../engines/call'
import type { DictationRow } from '../../ui/fixtures'

const KEY = 'crunchcall.dictations'
const EVENT = 'crunchcall:dictations'

function clock(): string {
  return new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

export function readDictations(): DictationRow[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as DictationRow[]
    if (!Array.isArray(parsed)) return []
    return parsed.filter((row) => row && typeof row.text === 'string')
  } catch {
    return []
  }
}

export async function loadDictationRows(): Promise<DictationRow[]> {
  if (!engineAvailable()) return readDictations()
  const result = await callEngine('dictate.list', { limit: 200 })
  if (!result.ok || !result.result || typeof result.result !== 'object') return readDictations()
  const rows = (result.result as { dictations?: { id?: string; text?: string; createdAt?: number }[] }).dictations
  if (!Array.isArray(rows)) return readDictations()
  return rows
    .filter((row) => typeof row.text === 'string' && row.text.trim())
    .map((row) => {
      const atMs = typeof row.createdAt === 'number' ? row.createdAt : Date.now()
      return {
        id: row.id || String(atMs),
        at: new Date(atMs).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
        day: dayBucket(atMs),
        text: row.text!.trim(),
        createdAt: atMs,
      }
    })
}

function dayBucket(ms: number): DictationRow['day'] {
  const now = new Date()
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  if (ms >= startToday) return 'Today'
  if (ms >= startToday - 24 * 60 * 60 * 1000) return 'Yesterday'
  return 'Earlier'
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
