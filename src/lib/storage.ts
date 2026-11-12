import type { Meeting } from '../features/meetings/types'
import type { MeetingNotes } from '../features/notes/types'

const MEETINGS_KEY = 'crunchcall.meetings'
const NOTES_KEY = 'crunchcall.notes'

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function writeJson<T>(key: string, value: T): void {
  localStorage.setItem(key, JSON.stringify(value))
}

export function listMeetings(): Meeting[] {
  return readJson<Meeting[]>(MEETINGS_KEY, [])
}

export function saveMeeting(meeting: Meeting): void {
  const all = listMeetings()
  const index = all.findIndex((m) => m.id === meeting.id)
  if (index >= 0) all[index] = meeting
  else all.unshift(meeting)
  writeJson(MEETINGS_KEY, all)
}

export function getNotes(meetingId: string): MeetingNotes | null {
  const all = readJson<Record<string, MeetingNotes>>(NOTES_KEY, {})
  return all[meetingId] ?? null
}

export function clearDeskStorage(): void {
  try {
    localStorage.removeItem(MEETINGS_KEY)
    localStorage.removeItem(NOTES_KEY)
  } catch {
    // Preferences still reset if storage is blocked.
  }
}

export function saveNotes(notes: MeetingNotes): void {
  const all = readJson<Record<string, MeetingNotes>>(NOTES_KEY, {})
  all[notes.meetingId] = notes
  writeJson(NOTES_KEY, all)
}
