import { notesFor } from '../features/desk/notesIndex'
import type { MeetingRow, ProjectFolder } from './fixtures'

export type SearchScope = 'all' | 'people' | 'topics' | 'actions' | 'projects'

export type SearchHitKind =
  | 'title'
  | 'person'
  | 'topic'
  | 'project'
  | 'preview'
  | 'summary'
  | 'takeaway'
  | 'action'
  | 'transcript'

export type SearchHit = {
  kind: SearchHitKind
  label: string
  text: string
  weight: number
}

export type SearchResult = {
  meeting: MeetingRow
  project: ProjectFolder | null
  hits: SearchHit[]
  score: number
}

type Candidate = SearchHit

export function projectForMeeting(folders: ProjectFolder[], meetingId: string): ProjectFolder | null {
  return folders.find((folder) => folder.meetingIds.includes(meetingId)) ?? null
}

function candidatesFor(meeting: MeetingRow, project: ProjectFolder | null): Candidate[] {
  const candidates: Candidate[] = [
    { kind: 'title', label: 'Title', text: meeting.title, weight: 9 },
    { kind: 'preview', label: 'Preview', text: meeting.preview, weight: 3 },
    ...meeting.people.map((person) => ({
      kind: 'person' as const,
      label: 'Person',
      text: person,
      weight: 7,
    })),
    ...meeting.topics.map((topic) => ({
      kind: 'topic' as const,
      label: 'Topic',
      text: topic,
      weight: 6,
    })),
  ]

  if (project) {
    candidates.push({ kind: 'project', label: 'Project', text: project.name, weight: 5 })
    candidates.push({ kind: 'project', label: 'Project brief', text: project.blurb, weight: 2 })
  } else {
    candidates.push({ kind: 'project', label: 'Project', text: 'Unfiled', weight: 2 })
  }

  const notes = notesFor(meeting.id)
  if (notes) {
    candidates.push({ kind: 'summary', label: 'Summary', text: notes.summary, weight: 4 })
    for (const takeaway of notes.takeaways) {
      candidates.push({ kind: 'takeaway', label: 'Takeaway', text: takeaway, weight: 3 })
    }
    for (const action of notes.actions) {
      const meta = [action.owner ?? 'Unassigned', action.due ?? 'No date'].join(' · ')
      candidates.push({ kind: 'action', label: 'Next step', text: `${action.text} — ${meta}`, weight: 4 })
    }
    for (const line of notes.utterances) {
      candidates.push({
        kind: 'transcript',
        label: 'Transcript',
        text: `${line.speaker}: ${line.text}`,
        weight: 2,
      })
    }
  }

  return candidates
}

function inScope(kind: SearchHitKind, scope: SearchScope): boolean {
  switch (scope) {
    case 'people':
      return kind === 'person'
    case 'topics':
      return kind === 'topic'
    case 'actions':
      return kind === 'action'
    case 'projects':
      return kind === 'project'
    case 'all':
      return true
  }
}

function snippet(text: string, tokens: string[]): string {
  if (text.length <= 104) return text
  const lower = text.toLowerCase()
  const first = tokens
    .map((token) => lower.indexOf(token))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0]
  if (first === undefined) return `${text.slice(0, 100)}…`
  const start = Math.max(0, first - 38)
  const end = Math.min(text.length, first + 72)
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`
}

export function searchMeetings(
  rows: MeetingRow[],
  folders: ProjectFolder[],
  query: string,
  scope: SearchScope = 'all',
): SearchResult[] {
  const tokens = query
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
  if (tokens.length === 0) return []

  const results: SearchResult[] = []

  for (const meeting of rows) {
    const project = projectForMeeting(folders, meeting.id)
    const candidates = candidatesFor(meeting, project).filter((candidate) => inScope(candidate.kind, scope))
    const matched = new Map<string, Candidate>()

    let everyTokenLanded = true
    for (const token of tokens) {
      const landed = candidates.filter((candidate) => candidate.text.toLowerCase().includes(token))
      if (landed.length === 0) {
        everyTokenLanded = false
        break
      }
      for (const candidate of landed) {
        const key = `${candidate.kind}:${candidate.label}:${candidate.text}`
        if (!matched.has(key)) matched.set(key, candidate)
      }
    }

    if (!everyTokenLanded || matched.size === 0) continue

    const hits = [...matched.values()]
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 5)
      .map((candidate) => ({ ...candidate, text: snippet(candidate.text, tokens) }))
    const score = hits.reduce((sum, hit) => sum + hit.weight, 0) + (hits[0]?.weight ?? 0)

    results.push({ meeting, project, hits, score })
  }

  return results.sort((a, b) => b.score - a.score || rows.indexOf(a.meeting) - rows.indexOf(b.meeting))
}

function rank(values: string[], limit: number): string[] {
  const counts = new Map<string, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([value]) => value)
}

export function peopleInNotes(rows: MeetingRow[], limit = 10): string[] {
  return rank(
    rows.flatMap((row) => row.people),
    limit,
  )
}

export function topicsInNotes(rows: MeetingRow[], limit = 12): string[] {
  return rank(
    rows.flatMap((row) => row.topics),
    limit,
  )
}
