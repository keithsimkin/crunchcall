import type { MeetingRow, ProjectFolder } from '../../ui/fixtures'

/** Typed at the start of the draft, or after a space, to tag context in Ask. */
export type MentionTrigger = '@' | '#' | '/' | '$'

export type MentionKind = 'person' | 'project' | 'skill' | 'meeting'

export type AskTags = {
  meetingIds: string[]
  projectIds: string[]
  people: string[]
  skillIds: string[]
}

export type AskSkill = {
  id: string
  name: string
  hint: string
  instruction: string
}

export type MentionItem = {
  kind: MentionKind
  id: string
  label: string
  detail: string
  trigger: MentionTrigger
}

export type ActiveMention = {
  trigger: MentionTrigger
  kind: MentionKind
  query: string
  start: number
  end: number
}

export const MENTION_KEYS: readonly {
  trigger: MentionTrigger
  kind: MentionKind
  menu: string
  noun: string
}[] = [
  { trigger: '@', kind: 'person', menu: 'People', noun: 'person' },
  { trigger: '#', kind: 'project', menu: 'Projects', noun: 'project' },
  { trigger: '/', kind: 'skill', menu: 'Skills', noun: 'skill' },
  { trigger: '$', kind: 'meeting', menu: 'Meetings', noun: 'meeting' },
]

export const ASK_SKILLS: readonly AskSkill[] = [
  {
    id: 'summary',
    name: 'Summary',
    hint: 'A short recap of the tagged notes',
    instruction:
      'Answer with a short recap. Lead with the outcome, then the few facts that matter. Stay inside the tagged scope.',
  },
  {
    id: 'owners',
    name: 'Owners',
    hint: 'Open next steps and who owns them',
    instruction:
      'List open next steps. Each line names the owner and the due date when the notes have one. Say when a step has no owner.',
  },
  {
    id: 'decisions',
    name: 'Decisions',
    hint: 'What was decided, and what is still open',
    instruction:
      'Separate decisions from open questions. Name the meeting each one came from. Do not turn a discussion into a decision.',
  },
  {
    id: 'prep',
    name: 'Prep',
    hint: 'What to know before the next conversation',
    instruction:
      'Write a short prep brief: the last decision, open next steps, and anything due soon. Skip background the notes do not support.',
  },
  {
    id: 'follow-ups',
    name: 'Follow-ups',
    hint: 'Unanswered asks and loose ends',
    instruction: 'List unanswered asks and loose ends. Name who raised each one and in which meeting.',
  },
  {
    id: 'risks',
    name: 'Risks',
    hint: 'What could slip',
    instruction: 'Name the risks the notes support, each with the meeting it came from. Skip generic risks.',
  },
]

export function emptyAskTags(): AskTags {
  return { meetingIds: [], projectIds: [], people: [], skillIds: [] }
}

export function mentionMeta(kind: MentionKind) {
  const meta = MENTION_KEYS.find((item) => item.kind === kind)
  if (!meta) return MENTION_KEYS[0]
  return meta
}

export function skillById(id: string): AskSkill | undefined {
  return ASK_SKILLS.find((skill) => skill.id === id)
}

export const MENTION_GUIDE: readonly { trigger: MentionTrigger; title: string; text: string }[] = [
  {
    trigger: '@',
    title: 'Person',
    text: 'Someone already named on a meeting. The answer stays on the calls they were in.',
  },
  {
    trigger: '#',
    title: 'Project',
    text: 'A project folder. The answer uses the meetings filed in that folder.',
  },
  {
    trigger: '/',
    title: 'Skill',
    text: 'How to answer: a summary, owners, decisions, prep, follow-ups, or risks.',
  },
  {
    trigger: '$',
    title: 'Meeting',
    text: 'One meeting. Same pin as the + button, typed instead of searched.',
  },
]

/**
 * The caret has to sit inside the token. `@` in an email, or a trigger after
 * another character, does not open the menu.
 */
export function activeMention(text: string, caret: number): ActiveMention | null {
  const safe = Math.max(0, Math.min(caret, text.length))
  const match = /(?:^|\s)([@#/$])([^\s@#/$]*)$/.exec(text.slice(0, safe))
  if (!match) return null
  const trigger = match[1] as MentionTrigger
  const meta = MENTION_KEYS.find((item) => item.trigger === trigger)
  if (!meta) return null
  const query = match[2] ?? ''
  const start = safe - query.length - 1
  if (text[start] !== trigger) return null
  return { trigger, kind: meta.kind, query, start, end: safe }
}

export function dropActiveMention(text: string, active: ActiveMention): { text: string; caret: number } {
  const before = text.slice(0, active.start)
  let after = text.slice(active.end)
  if (before.endsWith(' ') && after.startsWith(' ')) after = after.slice(1)
  else if (!before && after.startsWith(' ')) after = after.slice(1)
  return { text: `${before}${after}`, caret: before.length }
}

function matches(query: string, ...parts: string[]): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  return parts.some((part) => part.toLowerCase().includes(needle))
}

function personKey(name: string): string {
  return name.trim().toLowerCase()
}

export function listMentions(input: {
  kind: MentionKind
  query: string
  rows: MeetingRow[]
  folders: ProjectFolder[]
  tags: AskTags
}): MentionItem[] {
  const { kind, query, rows, folders, tags } = input

  if (kind === 'person') {
    const seen = new Set<string>()
    const items: MentionItem[] = []
    for (const row of rows) {
      for (const person of row.people) {
        const name = person.trim()
        const key = personKey(name)
        if (!name || seen.has(key)) continue
        seen.add(key)
        if (tags.people.some((item) => personKey(item) === key)) continue
        const count = rows.filter((meeting) => meeting.people.some((item) => personKey(item) === key)).length
        items.push({
          kind: 'person',
          id: name,
          label: name,
          detail: count === 1 ? '1 meeting' : `${count} meetings`,
          trigger: '@',
        })
      }
    }
    items.sort((a, b) => a.label.localeCompare(b.label))
    return items.filter((item) => matches(query, item.label)).slice(0, 8)
  }

  if (kind === 'project') {
    return folders
      .filter((folder) => !tags.projectIds.includes(folder.id))
      .filter((folder) => matches(query, folder.name, folder.blurb))
      .slice(0, 8)
      .map((folder) => ({
        kind: 'project' as const,
        id: folder.id,
        label: folder.name,
        detail: folder.blurb,
        trigger: '#' as const,
      }))
  }

  if (kind === 'skill') {
    return ASK_SKILLS.filter((skill) => !tags.skillIds.includes(skill.id))
      .filter((skill) => matches(query, skill.name, skill.hint))
      .slice(0, 8)
      .map((skill) => ({
        kind: 'skill' as const,
        id: skill.id,
        label: skill.name,
        detail: skill.hint,
        trigger: '/' as const,
      }))
  }

  return rows
    .filter((row) => !tags.meetingIds.includes(row.id))
    .filter((row) =>
      matches(query, row.title, row.when, ...row.people, ...row.topics),
    )
    .slice(0, 8)
    .map((row) => ({
      kind: 'meeting' as const,
      id: row.id,
      label: row.title,
      detail: row.people.length ? `${row.when} · ${row.people.slice(0, 2).join(', ')}` : row.when,
      trigger: '$' as const,
    }))
}

export function withMention(tags: AskTags, item: MentionItem): AskTags {
  if (item.kind === 'person') {
    if (tags.people.some((name) => personKey(name) === personKey(item.id))) return tags
    return { ...tags, people: [...tags.people, item.id] }
  }
  if (item.kind === 'project') {
    if (tags.projectIds.includes(item.id)) return tags
    return { ...tags, projectIds: [...tags.projectIds, item.id] }
  }
  if (item.kind === 'skill') {
    if (tags.skillIds.includes(item.id)) return tags
    return { ...tags, skillIds: [...tags.skillIds, item.id] }
  }
  if (tags.meetingIds.includes(item.id)) return tags
  return { ...tags, meetingIds: [...tags.meetingIds, item.id] }
}

export function withoutMention(tags: AskTags, kind: MentionKind, id: string): AskTags {
  if (kind === 'person') {
    const key = personKey(id)
    return { ...tags, people: tags.people.filter((name) => personKey(name) !== key) }
  }
  if (kind === 'project') return { ...tags, projectIds: tags.projectIds.filter((item) => item !== id) }
  if (kind === 'skill') return { ...tags, skillIds: tags.skillIds.filter((item) => item !== id) }
  return { ...tags, meetingIds: tags.meetingIds.filter((item) => item !== id) }
}

/** Meetings explicitly tagged, plus meetings in tagged projects or with tagged people. */
export function meetingsForTags(tags: AskTags, rows: MeetingRow[], folders: ProjectFolder[]): MeetingRow[] {
  const ids = new Set(tags.meetingIds)
  for (const folder of folders) {
    if (!tags.projectIds.includes(folder.id)) continue
    for (const id of folder.meetingIds) ids.add(id)
  }
  const people = new Set(tags.people.map(personKey))
  if (people.size) {
    for (const row of rows) {
      if (row.people.some((person) => people.has(personKey(person)))) ids.add(row.id)
    }
  }
  return rows.filter((row) => ids.has(row.id))
}
