import type { CalendarEvent } from '../calendar/ics'
import { readDictations } from '../dictate/history'
import { projectForMeeting, searchMeetings } from '../../ui/search'
import { notesFor } from '../desk/notesIndex'
import type { MeetingRow, ProjectFolder } from '../../ui/fixtures'
import { emptyAskTags, meetingsForTags, skillById, type AskSkill, type AskTags } from './mentions'

export type AskFocus =
  | { page: 'list' }
  | { page: 'live'; title?: string }
  | { page: 'notes'; meetingId: string }
  | { page: 'dictate' }
  | { page: 'calendar' }
  | { page: 'projects' }
  | { page: 'shortcuts' }
  | { page: 'connect' }

export type AskPack = {
  focusLabel: string
  system: string
  prompt: string
}

const SYSTEM = [
  'You are annotated’s in-app assistant.',
  'Answer only from the CONTEXT the user already has in the app (meetings, notes, actions, projects, calendar, dictations).',
  'When SKILL, TAGGED MEETINGS, TAGGED PROJECTS, or TAGGED PEOPLE is present, answer from that scope first and follow the skill.',
  'Otherwise prefer the FOCUS section; use RELATED and CORPUS only when needed.',
  'Be concise. Name the meeting or project when you cite a fact.',
  'If the context does not contain the answer, say you do not see it in their notes.',
  'Do not invent owners, dates, or quotes.',
].join(' ')

function clip(text: string, max: number): string {
  const trimmed = text.trim()
  if (trimmed.length <= max) return trimmed
  return `${trimmed.slice(0, max - 1).trimEnd()}…`
}

function formatMeetingBrief(meeting: MeetingRow, folders: ProjectFolder[]): string {
  const project = projectForMeeting(folders, meeting.id)
  const notes = notesFor(meeting.id)
  const lines = [
    `Meeting: ${meeting.title} (${meeting.status}, ${meeting.when}, ${meeting.duration})`,
    `People: ${meeting.people.join(', ') || '—'}`,
    `Topics: ${meeting.topics.join(', ') || '—'}`,
    `Project: ${project?.name ?? 'Unfiled'}`,
    `Preview: ${meeting.preview}`,
  ]
  if (notes) {
    lines.push(`Summary: ${notes.summary}`)
    if (notes.takeaways.length) lines.push(`Takeaways: ${notes.takeaways.join(' | ')}`)
    if (notes.actions.length) {
      lines.push(
        `Actions: ${notes.actions
          .map((action) => `${action.text} (${action.owner ?? 'Unassigned'}${action.due ? `, ${action.due}` : ''})`)
          .join(' | ')}`,
      )
    }
  }
  return lines.join('\n')
}

function formatMeetingDeep(meeting: MeetingRow, folders: ProjectFolder[]): string {
  const brief = formatMeetingBrief(meeting, folders)
  const notes = notesFor(meeting.id)
  if (!notes) return brief
  const transcript = notes.utterances
    .slice(0, 40)
    .map((line) => `[${line.at}] ${line.speaker}: ${line.text}`)
    .join('\n')
  return `${brief}\nTranscript:\n${transcript || '—'}`
}

function focusBlock(
  focus: AskFocus,
  rows: MeetingRow[],
  folders: ProjectFolder[],
  upcoming: CalendarEvent[],
): { label: string; text: string } {
  switch (focus.page) {
    case 'notes': {
      const meeting = rows.find((row) => row.id === focus.meetingId)
      if (!meeting) return { label: 'Notes', text: 'No meeting is open.' }
      return { label: `Notes · ${meeting.title}`, text: formatMeetingDeep(meeting, folders) }
    }
    case 'live': {
      const live = rows.find((row) => row.status === 'live')
      const title = focus.title?.trim() || live?.title || 'Live call'
      if (live) return { label: `Live · ${title}`, text: formatMeetingBrief(live, folders) }
      return {
        label: `Live · ${title}`,
        text: `A live session titled “${title}” is open. Notes are still forming.`,
      }
    }
    case 'list': {
      const lines = rows
        .slice(0, 12)
        .map((row) => {
          const project = projectForMeeting(folders, row.id)
          return `- ${row.title} [${row.status}] ${row.when} · ${row.people.join(', ') || 'no people'} · ${project?.name ?? 'Unfiled'}`
        })
      return { label: 'Home · meetings', text: lines.join('\n') || 'No meetings yet.' }
    }
    case 'calendar': {
      const lines = upcoming.slice(0, 12).map((event) => {
        const when = new Date(event.start).toLocaleString([], {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          hour: event.allDay ? undefined : 'numeric',
          minute: event.allDay ? undefined : '2-digit',
        })
        return `- ${event.title} · ${when}${event.detail ? ` · ${event.detail}` : ''}`
      })
      return {
        label: 'Calendar',
        text: lines.length ? lines.join('\n') : 'No upcoming events in the next window.',
      }
    }
    case 'projects': {
      const lines = folders.map((folder) => {
        const titles = folder.meetingIds
          .map((id) => rows.find((row) => row.id === id)?.title)
          .filter(Boolean)
        return `- ${folder.name}: ${folder.blurb} Meetings: ${titles.join(', ') || 'none'}`
      })
      return { label: 'Projects', text: lines.join('\n') || 'No project folders yet.' }
    }
    case 'dictate': {
      const rowsDict = readDictations().slice(0, 8)
      const lines = rowsDict.map((row) => `- ${row.day} ${row.at}: ${clip(row.text, 160)}`)
      return {
        label: 'Dictate',
        text: lines.length ? lines.join('\n') : 'No saved dictations yet.',
      }
    }
    case 'shortcuts':
      return {
        label: 'Shortcuts',
        text: 'User is on the keyboard shortcuts page. Answer from their notes corpus if they ask about meetings.',
      }
    case 'connect':
      return {
        label: 'Connect',
        text: 'User is on Connect (MCP). Other AI tools can read curated notes via the local MCP server. Answer from their notes if asked.',
      }
  }
}

function relatedBlock(query: string, rows: MeetingRow[], folders: ProjectFolder[], skipId?: string): string {
  const hits = searchMeetings(rows, folders, query, 'all')
    .filter((hit) => hit.meeting.id !== skipId)
    .slice(0, 5)
  if (!hits.length) return 'No extra search hits for this question.'
  return hits
    .map((hit) => {
      const bits = hit.hits.map((item) => `${item.label}: ${item.text}`).join(' · ')
      return `- ${hit.meeting.title}: ${bits}`
    })
    .join('\n')
}

function corpusBlock(rows: MeetingRow[], folders: ProjectFolder[], skipId?: string): string {
  return rows
    .filter((row) => row.id !== skipId)
    .slice(0, 8)
    .map((row) => clip(formatMeetingBrief(row, folders), 520))
    .join('\n\n')
}

function scopeBlocks(
  tags: AskTags,
  rows: MeetingRow[],
  folders: ProjectFolder[],
): { label: string; sections: string[] } {
  const sections: string[] = []
  const labels: string[] = []
  const explicit = tags.meetingIds
    .map((id) => rows.find((row) => row.id === id))
    .filter((row): row is MeetingRow => Boolean(row))
  const explicitIds = new Set(explicit.map((meeting) => meeting.id))

  if (explicit.length) {
    labels.push(...explicit.map((meeting) => meeting.title))
    sections.push(`TAGGED MEETINGS\n${clip(explicit.map((meeting) => formatMeetingDeep(meeting, folders)).join('\n\n'), 7000)}`)
  }

  const projectSections: string[] = []
  for (const id of tags.projectIds) {
    const folder = folders.find((item) => item.id === id)
    if (!folder) continue
    labels.push(folder.name)
    const meetings = folder.meetingIds
      .map((meetingId) => rows.find((row) => row.id === meetingId))
      .filter((row): row is MeetingRow => Boolean(row))
      .filter((row) => !explicitIds.has(row.id))
    const body = meetings.length
      ? meetings.map((meeting) => formatMeetingBrief(meeting, folders)).join('\n\n')
      : 'No meetings in this folder yet.'
    projectSections.push(`# ${folder.name}\n${folder.blurb}\n${body}`)
  }
  if (projectSections.length) sections.push(`TAGGED PROJECTS\n${clip(projectSections.join('\n\n'), 4000)}`)

  const peopleSections: string[] = []
  for (const name of tags.people) {
    labels.push(name)
    const key = name.trim().toLowerCase()
    const meetings = rows.filter(
      (row) => !explicitIds.has(row.id) && row.people.some((person) => person.trim().toLowerCase() === key),
    )
    const body = meetings.length
      ? meetings.map((meeting) => formatMeetingBrief(meeting, folders)).join('\n\n')
      : 'No meetings name this person.'
    peopleSections.push(`@ ${name}\n${body}`)
  }
  if (peopleSections.length) sections.push(`TAGGED PEOPLE\n${clip(peopleSections.join('\n\n'), 4000)}`)

  const skills = tags.skillIds.map((id) => skillById(id)).filter((skill): skill is AskSkill => Boolean(skill))
  if (skills.length) {
    labels.push(...skills.map((skill) => skill.name))
    sections.push(`SKILL\n${skills.map((skill) => `${skill.name}: ${skill.instruction}`).join('\n')}`)
  }

  return { label: labels.join(' · '), sections }
}

export function buildAskPack(input: {
  focus: AskFocus
  question: string
  rows: MeetingRow[]
  folders: ProjectFolder[]
  upcoming: CalendarEvent[]
  tags?: AskTags
}): AskPack {
  const question = input.question.trim()
  const focus = focusBlock(input.focus, input.rows, input.folders, input.upcoming)
  const tags = input.tags ?? emptyAskTags()
  const scope = scopeBlocks(tags, input.rows, input.folders)
  const skipId = tags.meetingIds[0] ?? (input.focus.page === 'notes' ? input.focus.meetingId : undefined)
  const related = relatedBlock(question, input.rows, input.folders, skipId)
  const corpus = corpusBlock(input.rows, input.folders, skipId)
  const hasScope = scope.sections.length > 0

  const context = [
    ...scope.sections,
    hasScope ? `PAGE FOCUS (${focus.label})\n${clip(focus.text, 2500)}` : `FOCUS (${focus.label})\n${clip(focus.text, 6000)}`,
    `RELATED SEARCH\n${clip(related, 2500)}`,
    `CORPUS\n${clip(corpus, 4000)}`,
  ].join('\n\n')

  return {
    focusLabel: scope.label || focus.label,
    system: SYSTEM,
    prompt: `CONTEXT\n${context}\n\nQUESTION\n${question}`,
  }
}

function skillLines(skillId: string, meetings: MeetingRow[]): string[] {
  const lines: string[] = []
  for (const meeting of meetings) {
    const notes = notesFor(meeting.id)
    if (!notes) continue
    if (skillId === 'summary' || skillId === 'prep') {
      lines.push(`• ${meeting.title} — ${clip(notes.summary, 200)}`)
    }
    if (skillId === 'owners' || skillId === 'prep') {
      for (const action of notes.actions) {
        lines.push(
          `• ${action.text} — ${action.owner ?? 'Unassigned'}${action.due ? `, ${action.due}` : ''} (${meeting.title})`,
        )
      }
    }
    if (skillId === 'follow-ups') {
      for (const action of notes.actions.filter((item) => !item.owner)) {
        lines.push(`• ${action.text}${action.due ? ` — ${action.due}` : ''} (${meeting.title})`)
      }
    }
    if (skillId === 'decisions') {
      for (const takeaway of notes.takeaways) lines.push(`• ${takeaway} (${meeting.title})`)
    }
    if (skillId === 'risks') {
      const blobs = [notes.summary, ...notes.takeaways, ...notes.utterances.map((line) => line.text)]
      for (const text of blobs) {
        if (!/risk|slip|block|late|worry|fail/i.test(text)) continue
        lines.push(`• ${clip(text, 180)} (${meeting.title})`)
      }
    }
  }
  return lines.slice(0, 8)
}

/** Extractive reply when no cloud writer is ready. */
export function localAskReply(
  question: string,
  rows: MeetingRow[],
  folders: ProjectFolder[],
  focus: AskFocus,
  tags: AskTags = emptyAskTags(),
): string {
  const narrowed = tags.meetingIds.length + tags.projectIds.length + tags.people.length > 0
  const pool = narrowed ? meetingsForTags(tags, rows, folders) : rows
  if (narrowed && !pool.length) return 'Nothing in your notes matches that tag.'

  if (tags.skillIds.length) {
    const lines = tags.skillIds.flatMap((id) => skillLines(id, pool.slice(0, 6)))
    if (lines.length) {
      return `From your notes (local search — link a cloud writer in Settings for a fuller answer):\n\n${lines.join('\n')}`
    }
  }

  const hits = searchMeetings(pool, folders, question, 'all').slice(0, 4)
  if (hits.length) {
    const lines = hits.map((hit) => {
      const top = hit.hits[0]
      return `• ${hit.meeting.title}${top ? ` — ${top.label}: ${top.text}` : ''}`
    })
    return `From your notes (local search — link a cloud writer in Settings for a fuller answer):\n\n${lines.join('\n')}`
  }

  if (focus.page === 'notes') {
    const meeting = rows.find((row) => row.id === focus.meetingId)
    const notes = meeting ? notesFor(meeting.id) : undefined
    if (notes) {
      return `I do not see a direct match for that. On this meeting (${meeting?.title}): ${clip(notes.summary, 280)}`
    }
  }

  return 'I do not see that in your notes yet. Try another name, topic, or open a meeting with notes. For full answers, pick a cloud writer and save its key under Settings → Keys.'
}
