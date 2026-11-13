import type { CalendarEvent } from '../calendar/ics'
import { seedDemoCalendar } from '../calendar/store'
import { writeDictations } from '../dictate/history'
import {
  listedDictations,
  listedMeetings,
  productLive,
  richNotes,
  starterProjects,
  type MeetingRow,
  type RichNotes,
} from '../../ui/fixtures'
import { readProfile, writeProfile } from '../../ui/profile'
import type { EngineAction, EngineMeeting, EngineNotes, EngineUtterance } from './present'

const DESK_KEY = 'crunchcall.desk.v1'
const FOLDER_KEY = 'crunchcall.folders'
const DEMO_KEY = 'crunchcall.demo'

type LocalDesk = {
  meetings: EngineMeeting[]
  utterances: Record<string, EngineUtterance[]>
  notes: Record<string, EngineNotes | null>
  actions: Record<string, EngineAction[]>
}

function urlWantsDemo(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const search = new URLSearchParams(window.location.search)
    if (search.get('demo') === '1' || search.get('demo') === 'force') return true
    const hash = window.location.hash
    return /(?:^|[?#&])demo=1(?:&|$)/.test(hash)
  } catch {
    return false
  }
}

export function demoForced(): boolean {
  return urlWantsDemo()
}

export function demoDisabled(): boolean {
  try {
    return localStorage.getItem(DEMO_KEY) === 'off'
  } catch {
    return false
  }
}

export function disableDemoSeed(): void {
  try {
    localStorage.setItem(DEMO_KEY, 'off')
  } catch {
    /* ignore */
  }
}

export function enableDemoSeed(): void {
  try {
    localStorage.setItem(DEMO_KEY, 'on')
  } catch {
    /* ignore */
  }
}

function durationMs(duration: string, status: string): number {
  if (!duration || duration === '—') return status === 'live' ? 18 * 60_000 + 42_000 : 30 * 60_000
  const hour = duration.match(/(\d+)\s*h/i)
  const minLabel = duration.match(/(\d+)\s*min/i)
  if (hour || minLabel) {
    return ((Number(hour?.[1] ?? 0) * 60 + Number(minLabel?.[1] ?? 0)) * 60_000) || 30 * 60_000
  }
  const clock = duration.match(/^(\d+):(\d+)$/)
  if (clock) return (Number(clock[1]) * 60 + Number(clock[2])) * 1000
  return 30 * 60_000
}

function startedAtFor(row: MeetingRow, index: number, now: number): number {
  const startToday = new Date(now)
  startToday.setHours(0, 0, 0, 0)
  const base = startToday.getTime()
  if (row.day === 'Today') {
    if (row.status === 'live') return now - durationMs(row.duration, row.status)
    return base + (9 * 60 + 30 - index * 20) * 60_000
  }
  if (row.day === 'Yesterday') return base - 24 * 60 * 60_000 + (11 * 60 + index * 35) * 60_000
  return base - (3 + index) * 24 * 60 * 60_000 + (10 * 60 + index * 40) * 60_000
}

function parseClockOffset(at: string, meetingStart: number): number {
  const parts = at.split(':').map((part) => Number(part))
  if (parts.length >= 2 && parts.every((n) => Number.isFinite(n))) {
    return meetingStart + (parts[0] * 60 + parts[1]) * 1000
  }
  return meetingStart
}

function notesFor(id: string): RichNotes | null {
  return richNotes[id] ?? null
}

function buildDesk(now = Date.now()): LocalDesk {
  const desk: LocalDesk = { meetings: [], utterances: {}, notes: {}, actions: {} }
  listedMeetings.forEach((row, index) => {
    const startedAt = startedAtFor(row, index, now)
    const span = durationMs(row.duration, row.status)
    const endedAt = row.status === 'live' || row.status === 'draft' ? null : startedAt + span
    const rich = notesFor(row.id)
    const meeting: EngineMeeting = {
      id: row.id,
      title: row.title,
      startedAt,
      endedAt,
      status: row.status,
      createdAt: startedAt,
      updatedAt: endedAt ?? now,
    }
    desk.meetings.push(meeting)

    const lines =
      rich?.utterances?.length
        ? rich.utterances
        : row.id === 'live-product'
          ? productLive.lines
          : []
    desk.utterances[row.id] = lines.map((line, seq) => {
      const at = parseClockOffset(line.at, startedAt)
      return {
        id: line.id,
        meetingId: row.id,
        speaker: line.speaker,
        text: line.text,
        startedAt: at,
        endedAt: at + 4_000,
        seq: seq + 1,
        createdAt: at,
      }
    })

    if (rich && (rich.summary || rich.markdown || rich.takeaways.length)) {
      desk.notes[row.id] = {
        meetingId: row.id,
        summary: rich.summary,
        takeaways: rich.takeaways,
        markdown: rich.markdown,
        updatedAt: endedAt ?? now,
      }
    } else {
      desk.notes[row.id] = null
    }

    desk.actions[row.id] = (rich?.actions ?? []).map((action, position) => ({
      id: action.id,
      meetingId: row.id,
      text: action.text,
      owner: action.owner,
      due: action.due,
      position,
    }))
  })
  return desk
}

function buildDictations(now = Date.now()) {
  const startToday = new Date(now)
  startToday.setHours(0, 0, 0, 0)
  const base = startToday.getTime()
  return listedDictations.map((row, index) => {
    let createdAt = now - index * 12 * 60_000
    if (row.day === 'Yesterday') createdAt = base - 24 * 60 * 60_000 + (14 * 60 - index * 40) * 60_000
    if (row.day === 'Earlier') createdAt = base - (2 + index) * 24 * 60 * 60_000 + 15 * 60 * 60_000
    return {
      ...row,
      at: new Date(createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
      createdAt,
    }
  })
}

function buildCalendar(now = Date.now()): CalendarEvent[] {
  const day = (offset: number, hour: number, minute: number, lengthMin: number, title: string, detail: string, uid: string): CalendarEvent => {
    const start = new Date(now)
    start.setHours(0, 0, 0, 0)
    start.setDate(start.getDate() + offset)
    start.setHours(hour, minute, 0, 0)
    const startMs = start.getTime()
    const endMs = startMs + lengthMin * 60_000
    return {
      uid,
      instanceKey: `${uid}:${startMs}`,
      title,
      start: startMs,
      end: endMs,
      allDay: false,
      detail,
    }
  }
  return [
    (() => {
      const start = new Date(now + 3 * 60 * 60 * 1000)
      start.setMinutes(0, 0, 0)
      const startMs = start.getTime()
      return {
        uid: 'demo-northwind',
        instanceKey: `demo-northwind:${startMs}`,
        title: 'Customer check-in — Northwind',
        start: startMs,
        end: startMs + 45 * 60_000,
        allDay: false,
        detail: 'Zoom · Pricing follow-up with Sam',
      }
    })(),
    day(5, 16, 30, 30, 'Design critique', 'Meet · Overlay polish with Priya', 'demo-critique'),
    day(1, 9, 30, 60, 'Weekly product sync', 'Meet · Launch sequence', 'demo-product'),
    day(1, 13, 0, 45, 'Lumen pilot kickoff', 'Zoom · Overlay off for call one', 'demo-lumen'),
    day(2, 10, 0, 30, 'Hiring panel debrief', 'Rooms · Design loop', 'demo-hiring'),
    day(2, 15, 0, 50, 'Atlas renewal review', 'Teams · Billing fix check', 'demo-atlas'),
    day(3, 11, 0, 40, 'Store screenshot review', 'Meet · Final overlay', 'demo-store'),
    day(4, 9, 0, 25, '1:1 — Priya', 'In person · Launch date', 'demo-priya'),
  ]
}

export function deskIsEmpty(): boolean {
  try {
    const raw = localStorage.getItem(DESK_KEY)
    if (!raw) return true
    const parsed = JSON.parse(raw) as { meetings?: unknown }
    return !Array.isArray(parsed.meetings) || parsed.meetings.length === 0
  } catch {
    return true
  }
}

/** Writes meetings, notes, projects, dictations, calendar, and a demo profile. */
export function seedDemoData(options?: { force?: boolean }): boolean {
  if (typeof localStorage === 'undefined') return false
  const force = Boolean(options?.force) || demoForced()
  if (!force && demoDisabled()) return false
  if (!force && !deskIsEmpty()) return false

  const now = Date.now()
  const desk = buildDesk(now)
  localStorage.setItem(DESK_KEY, JSON.stringify(desk))
  localStorage.setItem(FOLDER_KEY, JSON.stringify(starterProjects))
  writeDictations(buildDictations(now))
  seedDemoCalendar(buildCalendar(now))
  enableDemoSeed()

  try {
    localStorage.setItem('crunchcall.theme', 'light')
  } catch {
    /* ignore */
  }

  const profile = readProfile()
  if (force || !profile.onboarded || !profile.name.trim()) {
    writeProfile({
      name: 'Alex Rivera',
      onboarded: true,
      mcpClient: 'claude',
      mcpCopied: true,
    })
  }
  return true
}
