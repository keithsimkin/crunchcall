import { callEngine, engineAvailable } from '../engines/call'
import { engineById } from '../engines/catalog'
import { buildAskPack, localAskReply, type AskFocus } from './context'
import { emptyAskTags, meetingsForTags, type AskTags } from './mentions'
import { pullsForAsk, type AskPull } from './pulls'
import type { CalendarEvent } from '../calendar/ics'
import type { MeetingRow, ProjectFolder } from '../../ui/fixtures'

export type AskMessage = {
  id: string
  role: 'user' | 'assistant'
  text: string
}

export type { AskPull }

export type AskCompleteResult =
  | { ok: true; text: string; source: 'writer' | 'local'; pulls: AskPull[] }
  | { ok: false; message: string; openModels?: boolean; pulls: AskPull[] }

function readWriterText(result: unknown): string | null {
  if (!result || typeof result !== 'object') return null
  const text = (result as { text?: unknown }).text
  return typeof text === 'string' && text.trim() ? text.trim() : null
}

export async function completeAsk(input: {
  question: string
  writerId: string
  hasWriterKey: boolean
  focus: AskFocus
  rows: MeetingRow[]
  folders: ProjectFolder[]
  upcoming: CalendarEvent[]
  tags?: AskTags
}): Promise<AskCompleteResult> {
  const question = input.question.trim()
  const tags = input.tags ?? emptyAskTags()
  const taggedMeetingIds = [
    ...new Set([...tags.meetingIds, ...meetingsForTags(tags, input.rows, input.folders).map((row) => row.id)]),
  ]
  const pulls = question
    ? pullsForAsk({
        question,
        rows: input.rows,
        focus: input.focus,
        taggedMeetingIds,
      })
    : []
  if (!question) return { ok: false, message: 'Type a question first.', pulls }

  const writer = engineById(input.writerId)
  const pack = buildAskPack({
    focus: input.focus,
    question,
    rows: input.rows,
    folders: input.folders,
    upcoming: input.upcoming,
    tags,
  })

  if (!engineAvailable() || (writer && writer.where === 'local' && !writer.clientReady)) {
    return {
      ok: true,
      text: localAskReply(question, input.rows, input.folders, input.focus, tags),
      source: 'local',
      pulls,
    }
  }

  if (!writer) {
    return { ok: false, message: 'No writer module is selected.', openModels: true, pulls }
  }

  if (writer.where === 'local' && !writer.clientReady) {
    return {
      ok: false,
      message: `${writer.name} is not linked yet. Pick a cloud writer under Settings → Models, or finish linking the local engine.`,
      openModels: true,
      pulls,
    }
  }

  if (writer.needsKey && !input.hasWriterKey) {
    return {
      ok: false,
      message: `Save an API key for ${writer.name} under Settings → Models, then ask again.`,
      openModels: true,
      pulls,
    }
  }

  const response = await callEngine('writer.complete', {
    moduleId: writer.id,
    system: pack.system,
    prompt: pack.prompt,
  })

  if (!response.ok) {
    const lower = response.message.toLowerCase()
    return {
      ok: false,
      message: response.message,
      pulls,
      openModels:
        lower.includes('key') ||
        lower.includes('missing_key') ||
        lower.includes('not linked') ||
        lower.includes('not ready') ||
        lower.includes('engine_not_linked'),
    }
  }

  const text = readWriterText(response.result)
  if (!text) return { ok: false, message: 'The writer returned an empty reply.', pulls }
  return { ok: true, text, source: 'writer', pulls }
}
