import type { CalendarEvent } from '../calendar/ics'
import { readDictations } from '../dictate/history'
import { projectForMeeting, searchMeetings } from '../../ui/search'
import { richNotes, type MeetingRow, type ProjectFolder } from '../../ui/fixtures'

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
  'You are CrunchCall’s in-app assistant.',
  'Answer only from the CONTEXT the user already has in the app (meetings, notes, actions, projects, calendar, dictations).',
  'Prefer the FOCUS section when it answers the question; use RELATED and CORPUS only when needed.',
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
  const notes = richNotes[meeting.id]
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
  const notes = richNotes[meeting.id]
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

export function buildAskPack(input: {
  focus: AskFocus
  question: string
  rows: MeetingRow[]
  folders: ProjectFolder[]
  upcoming: CalendarEvent[]
  taggedMeetingIds?: string[]
}): AskPack {
  const question = input.question.trim()
  const focus = focusBlock(input.focus, input.rows, input.folders, input.upcoming)
  const taggedIds = [...new Set((input.taggedMeetingIds ?? []).filter(Boolean))]
  const taggedMeetings = taggedIds
    .map((id) => input.rows.find((row) => row.id === id))
    .filter((row): row is MeetingRow => Boolean(row))
  const taggedBlock = taggedMeetings.length
    ? taggedMeetings.map((meeting) => formatMeetingDeep(meeting, input.folders)).join('\n\n')
    : ''
  const skipId =
    taggedIds[0] ?? (input.focus.page === 'notes' ? input.focus.meetingId : undefined)
  const related = relatedBlock(question, input.rows, input.folders, skipId)
  const corpus = corpusBlock(input.rows, input.folders, skipId)

  const context = [
    taggedBlock
      ? `TAGGED MEETINGS\n${clip(taggedBlock, 7000)}`
      : `FOCUS (${focus.label})\n${clip(focus.text, 6000)}`,
    taggedBlock ? `PAGE FOCUS (${focus.label})\n${clip(focus.text, 2500)}` : null,
    `RELATED SEARCH\n${clip(related, 2500)}`,
    `CORPUS\n${clip(corpus, 4000)}`,
  ]
    .filter(Boolean)
    .join('\n\n')

  return {
    focusLabel: taggedMeetings.length
      ? taggedMeetings.map((meeting) => meeting.title).join(' · ')
      : focus.label,
    system: SYSTEM,
    prompt: `CONTEXT\n${context}\n\nQUESTION\n${question}`,
  }
}

/** Extractive reply when the desktop writer is unavailable (Vite-only demo). */
export function localAskReply(question: string, rows: MeetingRow[], folders: ProjectFolder[], focus: AskFocus): string {
  const hits = searchMeetings(rows, folders, question, 'all').slice(0, 4)
  if (hits.length) {
    const lines = hits.map((hit) => {
      const top = hit.hits[0]
      return `• ${hit.meeting.title}${top ? ` — ${top.label}: ${top.text}` : ''}`
    })
    return `From your notes (local search — link a cloud writer in Settings for a fuller answer):\n\n${lines.join('\n')}`
  }

  if (focus.page === 'notes') {
    const meeting = rows.find((row) => row.id === focus.meetingId)
    const notes = meeting ? richNotes[meeting.id] : undefined
    if (notes) {
      return `I do not see a direct match for that. On this meeting (${meeting?.title}): ${clip(notes.summary, 280)}`
    }
  }

  return 'I do not see that in your notes yet. Try another name, topic, or open a meeting with notes. For full answers, pick a cloud writer and save its key under Settings → Keys.'
}
