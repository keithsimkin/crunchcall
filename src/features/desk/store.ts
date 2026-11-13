import { callEngine, engineAvailable } from '../engines/call'
import type { ProjectFolder } from '../../ui/fixtures'
import { demoForced, seedDemoData } from './demoSeed'
import {
  readFolders,
  toNotes,
  toRow,
  type EngineAction,
  type EngineMeeting,
  type EngineNotes,
  type EngineUtterance,
} from './present'
import type { RichNotes } from '../../ui/fixtures'

const LOCAL_KEY = 'crunchcall.desk.v1'

export type DeskSnapshot = {
  rows: ReturnType<typeof toRow>[]
  notes: Record<string, RichNotes>
  folders: ProjectFolder[]
}

type LocalDesk = {
  meetings: EngineMeeting[]
  utterances: Record<string, EngineUtterance[]>
  notes: Record<string, EngineNotes | null>
  actions: Record<string, EngineAction[]>
}

const emptyLocal = (): LocalDesk => ({ meetings: [], utterances: {}, notes: {}, actions: {} })

function readLocal(): LocalDesk {
  try {
    const raw = localStorage.getItem(LOCAL_KEY)
    if (!raw) return emptyLocal()
    const parsed = JSON.parse(raw) as LocalDesk
    if (!parsed || !Array.isArray(parsed.meetings)) return emptyLocal()
    return {
      meetings: parsed.meetings,
      utterances: parsed.utterances ?? {},
      notes: parsed.notes ?? {},
      actions: parsed.actions ?? {},
    }
  } catch {
    return emptyLocal()
  }
}

function writeLocal(desk: LocalDesk) {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(desk))
}

function listOf<T>(value: unknown, key: string): T[] {
  if (!value || typeof value !== 'object') return []
  const row = (value as Record<string, unknown>)[key]
  return Array.isArray(row) ? (row as T[]) : []
}

async function engineOk(method: string, params?: Record<string, unknown>): Promise<unknown | null> {
  const result = await callEngine(method, params)
  return result.ok ? result.result : null
}

let creating: Promise<EngineMeeting> | null = null

export async function loadDesk(): Promise<DeskSnapshot> {
  const forced = demoForced()
  seedDemoData({ force: forced })
  // Demo mode always shows the fixture story, even if a previous demo launch
  // left meetings in the sidecar. The sidecar file lives in the demo profile.
  if (forced || !engineAvailable()) return snapshot(readLocal(), readFolders(readFolderCache()))
  const listed = await engineOk('meetings.list')
  const meetings = listOf<EngineMeeting>(listed, 'meetings')
  // Empty sidecar still shows local demo data so screenshots work in desktop too.
  if (meetings.length === 0) return snapshot(readLocal(), readFolders(readFolderCache()))
  const bundles = await Promise.all(
    meetings.map(async (meeting) => {
      const [notesWrap, utteranceWrap, actionWrap] = await Promise.all([
        engineOk('notes.get', { meetingId: meeting.id }),
        engineOk('utterances.list', { meetingId: meeting.id }),
        engineOk('actions.list', { meetingId: meeting.id }),
      ])
      const notes =
        notesWrap && typeof notesWrap === 'object' && 'notes' in notesWrap
          ? ((notesWrap as { notes: EngineNotes | null }).notes ?? null)
          : null
      return {
        meeting,
        utterances: listOf<EngineUtterance>(utteranceWrap, 'utterances'),
        notes,
        actions: listOf<EngineAction>(actionWrap, 'items'),
      }
    }),
  )
  const desk: LocalDesk = { meetings: [], utterances: {}, notes: {}, actions: {} }
  for (const bundle of bundles) {
    desk.meetings.push(bundle.meeting)
    desk.utterances[bundle.meeting.id] = bundle.utterances
    desk.notes[bundle.meeting.id] = bundle.notes
    desk.actions[bundle.meeting.id] = bundle.actions
  }
  const folderWrap = await engineOk('folders.get')
  const folders = readFolders(folderWrap && typeof folderWrap === 'object' ? (folderWrap as { folders?: unknown }).folders : readFolderCache())
  return snapshot(desk, folders)
}

function snapshot(desk: LocalDesk, folders: ProjectFolder[]): DeskSnapshot {
  const notes: Record<string, RichNotes> = {}
  const rows = desk.meetings.map((meeting) => {
    const utterances = desk.utterances[meeting.id] ?? []
    const note = desk.notes[meeting.id] ?? null
    const actions = desk.actions[meeting.id] ?? []
    const rich = toNotes(note, utterances, actions, meeting.id)
    if (rich && (note || utterances.length || actions.length)) notes[meeting.id] = rich
    return toRow(meeting, utterances, note, actions)
  })
  const known = new Set(rows.map((row) => row.id))
  return {
    rows,
    notes,
    folders: folders.map((folder) => ({ ...folder, meetingIds: folder.meetingIds.filter((id) => known.has(id)) })),
  }
}

export async function createLiveMeeting(title?: string): Promise<EngineMeeting> {
  if (creating) return creating
  creating = createLiveMeetingNow(title).finally(() => {
    window.setTimeout(() => {
      creating = null
    }, 400)
  })
  return creating
}

async function createLiveMeetingNow(title?: string): Promise<EngineMeeting> {
  const name = title?.trim() || 'Untitled meeting'
  const startedAt = Date.now()
  if (engineAvailable()) {
    const result = await engineOk('meetings.create', { title: name, status: 'live', startedAt })
    if (result && typeof result === 'object' && 'id' in result) return result as EngineMeeting
    throw new Error('Could not start the meeting.')
  }
  const meeting: EngineMeeting = {
    id: `m-${startedAt}`,
    title: name,
    startedAt,
    endedAt: null,
    status: 'live',
    createdAt: startedAt,
    updatedAt: startedAt,
  }
  const desk = readLocal()
  desk.meetings.unshift(meeting)
  desk.utterances[meeting.id] = []
  desk.notes[meeting.id] = null
  desk.actions[meeting.id] = []
  writeLocal(desk)
  return meeting
}

export async function readMeeting(id: string): Promise<EngineMeeting | null> {
  if (engineAvailable()) {
    const result = await engineOk('meetings.get', { id })
    if (result && typeof result === 'object' && 'id' in result) return result as EngineMeeting
  }
  return readLocal().meetings.find((item) => item.id === id) ?? null
}

export async function listUtterances(meetingId: string): Promise<EngineUtterance[]> {
  if (engineAvailable()) {
    const wrap = await engineOk('utterances.list', { meetingId })
    const rows = listOf<EngineUtterance>(wrap, 'utterances')
    if (rows.length) return rows
  }
  return readLocal().utterances[meetingId] ?? []
}

export async function appendUtterance(meetingId: string, speaker: string, text: string, startedAt = Date.now()): Promise<EngineUtterance | null> {
  const trimmed = text.trim()
  if (!trimmed) return null
  if (engineAvailable()) {
    const result = await engineOk('utterances.append', { meetingId, speaker, text: trimmed, startedAt, endedAt: Date.now() })
    return result && typeof result === 'object' ? (result as EngineUtterance) : null
  }
  const desk = readLocal()
  const line: EngineUtterance = {
    id: `u-${startedAt}-${desk.utterances[meetingId]?.length ?? 0}`,
    meetingId,
    speaker,
    text: trimmed,
    startedAt,
    endedAt: Date.now(),
    seq: (desk.utterances[meetingId]?.length ?? 0) + 1,
    createdAt: startedAt,
  }
  desk.utterances[meetingId] = [...(desk.utterances[meetingId] ?? []), line]
  writeLocal(desk)
  return line
}

export async function finishMeeting(
  meetingId: string,
  draft: { summary: string; takeaways: string[]; markdown: string; actions: { text: string; owner: string | null; due: string | null }[] },
): Promise<void> {
  const endedAt = Date.now()
  if (engineAvailable()) {
    await engineOk('notes.put', {
      meetingId,
      summary: draft.summary,
      takeaways: draft.takeaways,
      markdown: draft.markdown,
    })
    await engineOk('actions.replace', {
      meetingId,
      items: draft.actions.map((action) => ({ text: action.text, owner: action.owner, due: action.due })),
    })
    await engineOk('meetings.update', { id: meetingId, status: 'ready', endedAt })
    return
  }
  const desk = readLocal()
  const meeting = desk.meetings.find((item) => item.id === meetingId)
  if (meeting) {
    meeting.status = 'ready'
    meeting.endedAt = endedAt
    meeting.updatedAt = endedAt
  }
  desk.notes[meetingId] = {
    meetingId,
    summary: draft.summary,
    takeaways: draft.takeaways,
    markdown: draft.markdown,
    updatedAt: endedAt,
  }
  desk.actions[meetingId] = draft.actions.map((action, index) => ({
    id: `a-${meetingId}-${index}`,
    meetingId,
    text: action.text,
    owner: action.owner,
    due: action.due,
    position: index,
  }))
  writeLocal(desk)
}

export async function deleteMeeting(id: string): Promise<void> {
  if (engineAvailable()) {
    await engineOk('meetings.delete', { id })
    return
  }
  const desk = readLocal()
  desk.meetings = desk.meetings.filter((item) => item.id !== id)
  delete desk.utterances[id]
  delete desk.notes[id]
  delete desk.actions[id]
  writeLocal(desk)
}

const FOLDER_KEY = 'crunchcall.folders'

function readFolderCache(): unknown {
  try {
    const raw = localStorage.getItem(FOLDER_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

export async function saveFolders(folders: ProjectFolder[]): Promise<void> {
  localStorage.setItem(FOLDER_KEY, JSON.stringify(folders))
  if (!engineAvailable()) return
  await engineOk('folders.set', { folders })
}

export async function readMcpPolicy(): Promise<{ enabled: boolean; transcripts: boolean; actions: boolean }> {
  const fallback = { enabled: true, transcripts: true, actions: true }
  if (!engineAvailable()) {
    try {
      const raw = localStorage.getItem('crunchcall.mcp')
      return raw ? { ...fallback, ...JSON.parse(raw) } : fallback
    } catch {
      return fallback
    }
  }
  const result = await engineOk('mcp.get')
  const policy = result && typeof result === 'object' ? (result as { policy?: Record<string, unknown> }).policy : undefined
  return {
    enabled: policy?.enabled !== false,
    transcripts: policy?.transcripts !== false,
    actions: policy?.actions !== false,
  }
}

export async function saveMcpPolicy(policy: { enabled: boolean; transcripts: boolean; actions: boolean }): Promise<void> {
  localStorage.setItem('crunchcall.mcp', JSON.stringify(policy))
  if (!engineAvailable()) return
  await engineOk('mcp.set', policy)
}
