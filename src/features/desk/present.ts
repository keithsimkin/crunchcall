import type { MeetingStatus } from '../meetings/types'
import { richNotes, type MeetingRow, type NoteAction, type NoteUtterance, type ProjectAccent, type ProjectFolder, type RichNotes } from '../../ui/fixtures'

export type EngineMeeting = {
  id: string
  title: string
  startedAt?: number | null
  endedAt?: number | null
  status: string
  createdAt: number
  updatedAt: number
}

export type EngineUtterance = {
  id: string
  meetingId: string
  speaker?: string | null
  text: string
  startedAt?: number | null
  endedAt?: number | null
  seq: number
  createdAt: number
}

export type EngineNotes = {
  meetingId: string
  summary: string
  takeaways: string[]
  markdown: string
  updatedAt: number
}

export type EngineAction = {
  id: string
  meetingId: string
  text: string
  owner?: string | null
  due?: string | null
  position: number
}

const accents: ProjectAccent[] = ['green', 'blue', 'violet', 'amber', 'rose', 'slate']

export function asStatus(value: string): MeetingStatus {
  if (value === 'live' || value === 'processing' || value === 'ready' || value === 'draft') return value
  return 'draft'
}

export function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

export function whenOf(ms: number, now = Date.now()): { when: string; day: MeetingRow['day'] } {
  const date = new Date(ms)
  const today = new Date(now)
  const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  const startYesterday = startToday - 24 * 60 * 60 * 1000
  const time = clock(ms)
  if (ms >= startToday) return { when: `Today · ${time}`, day: 'Today' }
  if (ms >= startYesterday) return { when: `Yesterday · ${time}`, day: 'Yesterday' }
  const label = date.toLocaleDateString([], { month: 'short', day: 'numeric' })
  return { when: `${label} · ${time}`, day: 'Earlier' }
}

export function durationOf(start: number | null | undefined, end: number | null | undefined, status: string, now = Date.now()): string {
  if (!start) return '—'
  const stop = end ?? (status === 'live' || status === 'processing' ? now : start)
  const seconds = Math.max(0, Math.round((stop - start) / 1000))
  const minutes = Math.floor(seconds / 60)
  const remain = seconds % 60
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60)
    return `${hours}h ${minutes % 60}m`
  }
  return `${minutes}:${String(remain).padStart(2, '0')}`
}

export function toUtterance(row: EngineUtterance): NoteUtterance {
  const speaker = row.speaker?.trim() || 'Speaker'
  return {
    id: row.id,
    at: clock(row.startedAt || row.createdAt),
    speaker,
    you: speaker.toLowerCase() === 'you',
    text: row.text,
  }
}

export function toAction(row: EngineAction): NoteAction {
  return {
    id: row.id,
    text: row.text,
    owner: row.owner?.trim() || null,
    due: row.due?.trim() || null,
  }
}

export function toNotes(
  notes: EngineNotes | null,
  utterances: EngineUtterance[],
  actions: EngineAction[],
  meetingId?: string,
): RichNotes | null {
  if (!notes && utterances.length === 0 && actions.length === 0) return null
  const fixture = meetingId ? richNotes[meetingId] : undefined
  return {
    summary: notes?.summary ?? '',
    takeaways: notes?.takeaways ?? [],
    actions: actions.map(toAction),
    utterances: utterances.map(toUtterance),
    // Demo fixtures keep the Ask thread + cite chips; the engine desk has no ask store yet.
    ask: fixture?.ask ?? [],
    sampleReply: fixture?.sampleReply ?? { id: 'unused', role: 'assistant', text: '' },
    markdown: notes?.markdown ?? '',
  }
}

export function toRow(
  meeting: EngineMeeting,
  utterances: EngineUtterance[],
  notes: EngineNotes | null,
  actions: EngineAction[],
  now = Date.now(),
): MeetingRow {
  const people = [...new Set(utterances.map((line) => line.speaker?.trim() || '').filter((name) => name && name.toLowerCase() !== 'you' && name.toLowerCase() !== 'room'))]
  const stamp = meeting.startedAt || meeting.createdAt
  const placed = whenOf(stamp, now)
  const preview =
    notes?.summary?.trim() ||
    utterances[utterances.length - 1]?.text ||
    (meeting.status === 'live' ? 'Listening on this PC.' : 'No notes yet.')
  return {
    id: meeting.id,
    title: meeting.title,
    status: asStatus(meeting.status),
    when: placed.when,
    day: placed.day,
    duration: durationOf(meeting.startedAt, meeting.endedAt, meeting.status, now),
    preview,
    people,
    topics: [],
    source: 'This PC',
    actionCount: actions.length,
  }
}

export function readFolders(value: unknown): ProjectFolder[] {
  if (!Array.isArray(value)) return []
  const folders: ProjectFolder[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const name = typeof row.name === 'string' ? row.name.trim() : ''
    if (!name) continue
    const id = typeof row.id === 'string' && row.id.trim() ? row.id : `folder-${folders.length + 1}`
    const accent = accents.includes(row.accent as ProjectAccent) ? (row.accent as ProjectAccent) : accents[folders.length % accents.length]
    const meetingIds = Array.isArray(row.meetingIds)
      ? row.meetingIds.filter((id): id is string => typeof id === 'string')
      : []
    folders.push({
      id,
      name,
      blurb: typeof row.blurb === 'string' ? row.blurb : 'Meetings filed on this PC.',
      accent,
      meetingIds,
    })
  }
  return folders
}
