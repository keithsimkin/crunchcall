import { richNotes, type MeetingRow } from '../../ui/fixtures'
import type { AskFocus } from './context'

export type AskPull = {
  id: string
  meetingId: string
  meetingTitle: string
  kind: 'transcript' | 'notes'
  utteranceId?: string
  at?: string
  speaker?: string
  text: string
}

const STOP = new Set([
  'the',
  'and',
  'for',
  'with',
  'that',
  'this',
  'what',
  'who',
  'how',
  'when',
  'where',
  'from',
  'your',
  'about',
  'into',
  'are',
  'was',
  'were',
  'did',
  'does',
  'have',
  'has',
  'you',
  'our',
  'not',
  'but',
  'can',
  'could',
  'would',
  'should',
  'just',
  'like',
  'any',
  'all',
  'its',
  'their',
  'them',
  'then',
  'than',
  'out',
  'get',
  'got',
  'let',
  'ask',
])

function tokensFor(question: string): string[] {
  const tokens = question
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 2 && !STOP.has(token))
  return [...new Set(tokens)]
}

function preferredIds(focus: AskFocus, taggedMeetingIds: string[] | undefined): Set<string> {
  const ids = new Set((taggedMeetingIds ?? []).filter(Boolean))
  if (focus.page === 'notes') ids.add(focus.meetingId)
  return ids
}

/** Transcript lines (and a meeting fallback) the ask actually drew from. */
export function pullsForAsk(input: {
  question: string
  rows: MeetingRow[]
  focus: AskFocus
  taggedMeetingIds?: string[]
}): AskPull[] {
  const needles = tokensFor(input.question)
  const prefer = preferredIds(input.focus, input.taggedMeetingIds)
  const scored: { pull: AskPull; score: number }[] = []

  for (const meeting of input.rows) {
    const notes = richNotes[meeting.id]
    const boost = prefer.has(meeting.id) ? 2 : 0
    const titleHit = needles.some((token) => meeting.title.toLowerCase().includes(token))
    if (!notes) {
      const blob = `${meeting.title} ${meeting.preview} ${meeting.people.join(' ')}`.toLowerCase()
      const hits = needles.filter((token) => blob.includes(token)).length
      if (hits > 0) {
        scored.push({
          score: hits * 2 + boost,
          pull: {
            id: `notes:${meeting.id}`,
            meetingId: meeting.id,
            meetingTitle: meeting.title,
            kind: 'notes',
            text: meeting.preview,
          },
        })
      }
      continue
    }

    for (const line of notes.utterances) {
      const said = `${line.speaker} ${line.text}`.toLowerCase()
      const hits = needles.filter((token) => said.includes(token)).length
      const score = hits * 3 + (titleHit ? 1 : 0) + boost
      if (hits === 0) continue
      scored.push({
        score,
        pull: {
          id: `${meeting.id}:${line.id}`,
          meetingId: meeting.id,
          meetingTitle: meeting.title,
          kind: 'transcript',
          utteranceId: line.id,
          at: line.at,
          speaker: line.speaker,
          text: line.text,
        },
      })
    }
  }

  scored.sort((a, b) => b.score - a.score)
  const seen = new Set<string>()
  const pulls: AskPull[] = []
  for (const row of scored) {
    if (seen.has(row.pull.id)) continue
    seen.add(row.pull.id)
    pulls.push(row.pull)
    if (pulls.length === 5) break
  }
  if (pulls.length) return pulls

  for (const meeting of input.rows) {
    if (!prefer.has(meeting.id)) continue
    const notes = richNotes[meeting.id]
    if (!notes?.utterances.length) {
      pulls.push({
        id: `notes:${meeting.id}`,
        meetingId: meeting.id,
        meetingTitle: meeting.title,
        kind: 'notes',
        text: meeting.preview,
      })
      continue
    }
    for (const line of notes.utterances.slice(0, 3)) {
      pulls.push({
        id: `${meeting.id}:${line.id}`,
        meetingId: meeting.id,
        meetingTitle: meeting.title,
        kind: 'transcript',
        utteranceId: line.id,
        at: line.at,
        speaker: line.speaker,
        text: line.text,
      })
    }
    break
  }
  return pulls.slice(0, 5)
}
