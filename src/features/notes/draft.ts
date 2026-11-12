export type NoteDraft = {
  summary: string
  takeaways: string[]
  markdown: string
  actions: { text: string; owner: string | null; due: string | null }[]
}

const ACTION = /\b(i will|i'll|we'll|we will|will|action|next step|own(?:s|er)?)\b/i
const TAKE = /\b(decided|agree|agreed|ship|send|deadline|next|lock|move)\b/i
const DUE = /\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|\d{1,2}\/\d{1,2})\b/i

export function draftFromLines(lines: { speaker: string; text: string }[]): NoteDraft {
  const cleaned = lines.map((line) => ({ speaker: line.speaker.trim() || 'Speaker', text: line.text.trim() })).filter((line) => line.text)
  if (cleaned.length === 0) {
    return {
      summary: 'Nothing was captured.',
      takeaways: [],
      actions: [],
      markdown: '# Untitled meeting\n\nNothing was captured.',
    }
  }
  const summary = clip(cleaned.map((line) => line.text).join(' '), 420)
  const takeaways = unique(cleaned.filter((line) => TAKE.test(line.text)).map((line) => line.text)).slice(0, 5)
  const actions = uniqueActions(
    cleaned
      .filter((line) => ACTION.test(line.text))
      .map((line) => ({
        text: line.text,
        owner: line.speaker.toLowerCase() === 'room' ? null : line.speaker,
        due: DUE.exec(line.text)?.[0] ?? null,
      })),
  )
  const markdown = renderMarkdown('Meeting', summary, takeaways, actions, cleaned)
  return { summary, takeaways, markdown, actions }
}

export function parseWriterNotes(text: string, fallback: NoteDraft): NoteDraft {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return fallback
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as {
      summary?: unknown
      takeaways?: unknown
      markdown?: unknown
      actions?: unknown
    }
    const summary = typeof parsed.summary === 'string' && parsed.summary.trim() ? parsed.summary.trim() : fallback.summary
    const takeaways = Array.isArray(parsed.takeaways)
      ? parsed.takeaways.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim())
      : fallback.takeaways
    const actions = Array.isArray(parsed.actions)
      ? parsed.actions
          .map((item) => {
            if (!item || typeof item !== 'object') return null
            const row = item as { text?: unknown; owner?: unknown; due?: unknown }
            const actionText = typeof row.text === 'string' ? row.text.trim() : ''
            if (!actionText) return null
            return {
              text: actionText,
              owner: typeof row.owner === 'string' && row.owner.trim() ? row.owner.trim() : null,
              due: typeof row.due === 'string' && row.due.trim() ? row.due.trim() : null,
            }
          })
          .filter((item): item is NoteDraft['actions'][number] => item !== null)
      : fallback.actions
    const markdown =
      typeof parsed.markdown === 'string' && parsed.markdown.trim()
        ? parsed.markdown.trim()
        : renderMarkdown('Meeting', summary, takeaways, actions, [])
    return { summary, takeaways, actions, markdown }
  } catch {
    return fallback
  }
}

export function renderMarkdown(
  title: string,
  summary: string,
  takeaways: string[],
  actions: NoteDraft['actions'],
  lines: { speaker: string; text: string }[],
): string {
  const take = takeaways.length ? takeaways.map((item) => `- ${item}`).join('\n') : '- None yet.'
  const next = actions.length
    ? actions.map((action) => `- [ ] ${action.text} — ${action.owner ?? 'Unassigned'} — ${action.due ?? 'No date'}`).join('\n')
    : '- None yet.'
  const transcript = lines.length ? lines.map((line) => `- ${line.speaker}: ${line.text}`).join('\n') : '- None yet.'
  return `# ${title}

${summary}

## Takeaways

${take}

## Next steps

${next}

## Transcript

${transcript}`
}

function clip(text: string, max: number): string {
  const trimmed = text.trim()
  if (trimmed.length <= max) return trimmed
  return `${trimmed.slice(0, max - 1).trimEnd()}…`
}

function unique(values: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    const key = value.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(value)
  }
  return out
}

function uniqueActions(actions: NoteDraft['actions']): NoteDraft['actions'] {
  const seen = new Set<string>()
  const out: NoteDraft['actions'] = []
  for (const action of actions) {
    const key = action.text.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(action)
  }
  return out.slice(0, 8)
}
