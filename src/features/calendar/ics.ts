/** ICS (RFC 5545) reader for a private calendar link or an imported file. */

const DAY_MS = 86_400_000
const MAX_STEPS = 8000
const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const

export type CalendarEvent = {
  uid: string
  instanceKey: string
  title: string
  start: number
  end: number
  allDay: boolean
  detail: string | null
}

type Parts = {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

type Zone = 'utc' | 'local' | 'zoned'

type Stamp = {
  parts: Parts
  zone: Zone
  timeZone: string | null
  allDay: boolean
  ms: number
}

type RawEvent = {
  uid: string
  title: string
  start: Stamp
  end: Stamp | null
  durationMs: number | null
  rrule: Map<string, string> | null
  exdates: number[]
  recurrenceId: number | null
  status: string
  detail: string | null
}

type Expanded = {
  origin: number
  event: CalendarEvent
}

export function parseCalendar(text: string, range: { start: number; end: number }): CalendarEvent[] {
  const source = text.replace(/^\uFEFF/, '')
  if (!/BEGIN:(VCALENDAR|VEVENT)/i.test(source)) throw new Error('not-calendar')

  const raws = extractEvents(source)
    .map(readRaw)
    .filter((event): event is RawEvent => event !== null)

  const groups = new Map<string, { master: RawEvent | null; extras: RawEvent[] }>()
  for (const raw of raws) {
    const group = groups.get(raw.uid) ?? { master: null, extras: [] }
    if (raw.recurrenceId == null) group.master = raw
    else group.extras.push(raw)
    groups.set(raw.uid, group)
  }

  const padded = { start: range.start - 2 * DAY_MS, end: range.end + DAY_MS }
  const events: CalendarEvent[] = []
  const seen = new Set<string>()

  for (const group of groups.values()) {
    for (const event of materialize(group.master, group.extras, padded)) {
      if (event.end <= range.start || event.start >= range.end) continue
      if (seen.has(event.instanceKey)) continue
      seen.add(event.instanceKey)
      events.push(event)
    }
  }

  events.sort((a, b) => a.start - b.start || a.title.localeCompare(b.title))
  return events.slice(0, 200)
}

function materialize(master: RawEvent | null, extras: RawEvent[], range: { start: number; end: number }): CalendarEvent[] {
  if (!master) {
    return extras.filter((extra) => extra.status !== 'CANCELLED').flatMap((extra) => single(extra))
  }
  if (master.status === 'CANCELLED') return []

  const instances = master.rrule ? expand(master, range) : singleExpanded(master)
  const cancelled = new Set<number>()
  const replacements = new Map<number, CalendarEvent>()
  for (const extra of extras) {
    if (extra.recurrenceId == null) continue
    if (extra.status === 'CANCELLED') {
      cancelled.add(extra.recurrenceId)
      continue
    }
    const [event] = single(extra)
    if (event) replacements.set(extra.recurrenceId, event)
  }

  const chosen: CalendarEvent[] = []
  const matched = new Set<number>()
  for (const instance of instances) {
    if (cancelled.has(instance.origin)) continue
    const replacement = replacements.get(instance.origin)
    if (replacement) {
      matched.add(instance.origin)
      chosen.push(replacement)
      continue
    }
    chosen.push(instance.event)
  }
  for (const [origin, event] of replacements) {
    if (!matched.has(origin)) chosen.push(event)
  }
  return chosen
}

function single(raw: RawEvent): CalendarEvent[] {
  if (raw.status === 'CANCELLED') return []
  return [makeEvent(raw, raw.start.ms, raw.start.allDay)]
}

function singleExpanded(raw: RawEvent): Expanded[] {
  if (raw.status === 'CANCELLED') return []
  return [{ origin: raw.start.ms, event: makeEvent(raw, raw.start.ms, raw.start.allDay) }]
}

function makeEvent(raw: RawEvent, startMs: number, allDay: boolean): CalendarEvent {
  return {
    uid: raw.uid,
    instanceKey: `${raw.uid}@${startMs}`,
    title: raw.title,
    start: startMs,
    end: startMs + durationOf(raw),
    allDay,
    detail: raw.detail,
  }
}

function durationOf(raw: RawEvent): number {
  if (raw.end && raw.end.ms > raw.start.ms) return raw.end.ms - raw.start.ms
  if (raw.durationMs && raw.durationMs > 0) return raw.durationMs
  if (raw.start.allDay) return DAY_MS
  return 30 * 60 * 1000
}

function expand(raw: RawEvent, range: { start: number; end: number }): Expanded[] {
  const rule = raw.rrule
  if (!rule) return singleExpanded(raw)
  const freq = (rule.get('FREQ') ?? '').toUpperCase()
  const interval = Math.max(1, Number(rule.get('INTERVAL') || '1') || 1)
  const countCap = rule.has('COUNT') ? Math.max(0, Number(rule.get('COUNT') || '0') || 0) : null
  const until = untilMs(rule, raw.start)
  const excluded = new Set(raw.exdates)
  const out: Expanded[] = []
  let produced = 0

  const consider = (parts: Parts): boolean => {
    if (countCap != null && produced >= countCap) return false
    const ms = toMs(parts, raw.start.zone, raw.start.timeZone, raw.start.allDay)
    if (ms == null) return true
    if (until != null && ms > until) return false
    if (ms >= range.end) return false
    produced += 1
    if (!excluded.has(ms)) {
      const event = makeEvent(raw, ms, raw.start.allDay)
      if (event.end > range.start) out.push({ origin: ms, event })
    }
    return countCap == null || produced < countCap
  }

  if (freq === 'DAILY') walkDaily(raw.start.parts, interval, countCap, range, consider)
  else if (freq === 'WEEKLY') walkWeekly(raw.start.parts, rule, interval, countCap, range, consider)
  else if (freq === 'MONTHLY') walkMonthly(raw.start.parts, rule, interval, countCap, range, consider)
  else if (freq === 'YEARLY') walkYearly(raw.start.parts, interval, countCap, range, consider)
  else consider(raw.start.parts)

  return out
}

function walkDaily(
  start: Parts,
  interval: number,
  countCap: number | null,
  range: { start: number; end: number },
  consider: (parts: Parts) => boolean,
) {
  let index = 0
  if (countCap == null) {
    const delta = civilDay(partsFromMs(range.start)) - civilDay(start)
    if (delta > interval * 2) index = Math.floor(delta / interval) - 1
  }
  for (let step = 0; step < MAX_STEPS; step += 1) {
    if (!consider(addDays(start, index * interval))) return
    index += 1
  }
}

function walkWeekly(
  start: Parts,
  rule: Map<string, string>,
  interval: number,
  countCap: number | null,
  range: { start: number; end: number },
  consider: (parts: Parts) => boolean,
) {
  const days = bydays(rule.get('BYDAY'), start)
  const wkst = weekdayIndex(rule.get('WKST') || 'MO')
  const origin = weekStartParts(start, wkst)
  const offsets = days.map((day) => (day - wkst + 7) % 7).sort((a, b) => a - b)
  let weekIndex = 0
  if (countCap == null) {
    const delta = civilDay(partsFromMs(range.start)) - civilDay(origin)
    if (delta > 14) weekIndex = Math.max(0, Math.floor(delta / (7 * interval)) - 1)
  }
  for (let step = 0; step < MAX_STEPS; step += 1) {
    const week = addDays(origin, weekIndex * 7 * interval)
    if (countCap == null && Date.UTC(week.year, week.month - 1, week.day) > range.end + 7 * DAY_MS) return
    for (const offset of offsets) {
      const parts = withClock(addDays(week, offset), start)
      if (civilCompare(parts, start) < 0) continue
      if (!consider(parts)) return
    }
    weekIndex += 1
  }
}

function walkMonthly(
  start: Parts,
  rule: Map<string, string>,
  interval: number,
  countCap: number | null,
  range: { start: number; end: number },
  consider: (parts: Parts) => boolean,
) {
  let index = 0
  if (countCap == null) {
    const win = partsFromMs(range.start)
    const delta = win.year * 12 + (win.month - 1) - (start.year * 12 + (start.month - 1))
    if (delta > interval * 2) index = Math.floor(delta / interval) - 1
  }
  for (let step = 0; step < MAX_STEPS; step += 1) {
    const total = start.year * 12 + (start.month - 1) + index * interval
    const year = Math.floor(total / 12)
    const month = (total % 12) + 1
    if (countCap == null && Date.UTC(year, month - 1, 1) > range.end + 32 * DAY_MS) return
    for (const parts of monthDates(year, month, start, rule)) {
      if (civilCompare(parts, start) < 0) continue
      if (!consider(parts)) return
    }
    index += 1
  }
}

function walkYearly(
  start: Parts,
  interval: number,
  countCap: number | null,
  range: { start: number; end: number },
  consider: (parts: Parts) => boolean,
) {
  let year = start.year
  if (countCap == null) {
    const winYear = partsFromMs(range.start).year
    if (winYear > year + 1) year = winYear - 1
  }
  for (let step = 0; step < MAX_STEPS; step += 1) {
    if (countCap == null && Date.UTC(year, start.month - 1, 1) > range.end + 370 * DAY_MS) return
    if (start.day <= daysInMonth(year, start.month)) {
      const parts = withClock({ ...start, year }, start)
      if (civilCompare(parts, start) >= 0 && !consider(parts)) return
    }
    year += interval
  }
}

function monthDates(year: number, month: number, start: Parts, rule: Map<string, string>): Parts[] {
  const byday = rule.get('BYDAY')
  if (byday) {
    const dates: number[] = []
    for (const token of byday.split(',')) {
      const match = /^([+-]?\d+)?(SU|MO|TU|WE|TH|FR|SA)$/.exec(token.trim().toUpperCase())
      if (!match) continue
      const weekday = WEEKDAYS.indexOf(match[2] as (typeof WEEKDAYS)[number])
      if (match[1]) {
        const day = nthWeekday(year, month, Number(match[1]), weekday)
        if (day) dates.push(day)
      } else {
        for (let day = 1; day <= daysInMonth(year, month); day += 1) {
          if (new Date(Date.UTC(year, month - 1, day)).getUTCDay() === weekday) dates.push(day)
        }
      }
    }
    return dates.map((day) => withClock({ year, month, day, hour: 0, minute: 0, second: 0 }, start))
  }

  const days = (rule.get('BYMONTHDAY') ?? String(start.day))
    .split(',')
    .map((day) => Number(day))
    .filter((day) => day >= 1 && day <= daysInMonth(year, month))
  return days.map((day) => withClock({ year, month, day, hour: 0, minute: 0, second: 0 }, start))
}

function bydays(value: string | undefined, start: Parts): number[] {
  if (!value) return [new Date(Date.UTC(start.year, start.month - 1, start.day)).getUTCDay()]
  const days: number[] = []
  for (const token of value.split(',')) {
    const code = token.trim().slice(-2).toUpperCase()
    const index = WEEKDAYS.indexOf(code as (typeof WEEKDAYS)[number])
    if (index >= 0 && !days.includes(index)) days.push(index)
  }
  return days.length ? days : [new Date(Date.UTC(start.year, start.month - 1, start.day)).getUTCDay()]
}

function nthWeekday(year: number, month: number, n: number, weekday: number): number | null {
  if (n > 0) {
    const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay()
    const day = 1 + ((weekday - first + 7) % 7) + (n - 1) * 7
    return day <= daysInMonth(year, month) ? day : null
  }
  const last = daysInMonth(year, month)
  const lastWeekday = new Date(Date.UTC(year, month - 1, last)).getUTCDay()
  const day = last - ((lastWeekday - weekday + 7) % 7) + (n + 1) * 7
  return day >= 1 ? day : null
}

function weekdayIndex(code: string): number {
  const index = WEEKDAYS.indexOf(code.slice(-2).toUpperCase() as (typeof WEEKDAYS)[number])
  return index >= 0 ? index : 1
}

function untilMs(rule: Map<string, string>, start: Stamp): number | null {
  const value = rule.get('UNTIL')
  if (!value) return null
  const params = new Map<string, string>()
  if (/^\d{8}$/.test(value)) params.set('VALUE', 'DATE')
  else if (!value.endsWith('Z') && start.timeZone) params.set('TZID', start.timeZone)
  const stamp = parseStamp(value, params)
  if (!stamp) return null
  return stamp.allDay ? stamp.ms + DAY_MS - 1 : stamp.ms
}

function extractEvents(text: string): string[][] {
  const blocks: string[][] = []
  let current: string[] | null = null
  let nested = 0
  for (const line of unfold(text).split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const upper = trimmed.toUpperCase()
    if (!current) {
      if (upper === 'BEGIN:VEVENT') current = []
      continue
    }
    if (upper.startsWith('BEGIN:')) {
      nested += 1
      continue
    }
    if (upper === 'END:VEVENT' && nested === 0) {
      blocks.push(current)
      current = null
      continue
    }
    if (upper.startsWith('END:')) {
      if (nested > 0) nested -= 1
      continue
    }
    if (nested === 0) current.push(trimmed)
  }
  return blocks
}

function readRaw(lines: string[]): RawEvent | null {
  let uid = ''
  let title = ''
  let start: Stamp | null = null
  let end: Stamp | null = null
  let durationMs: number | null = null
  let rrule: Map<string, string> | null = null
  const exdates: number[] = []
  let recurrenceId: number | null = null
  let status = ''
  let location = ''
  let url = ''
  let description = ''
  let conference = ''

  for (const line of lines) {
    const prop = parseProperty(line)
    if (!prop) continue
    if (prop.name === 'UID') uid = unescapeText(prop.value)
    else if (prop.name === 'SUMMARY') title = unescapeText(prop.value)
    else if (prop.name === 'DTSTART') start = parseStamp(prop.value, prop.params)
    else if (prop.name === 'DTEND') end = parseStamp(prop.value, prop.params)
    else if (prop.name === 'DURATION') durationMs = parseDuration(prop.value)
    else if (prop.name === 'RRULE') rrule = parseRule(prop.value)
    else if (prop.name === 'EXDATE') {
      for (const item of prop.value.split(',')) {
        const stamp = parseStamp(item.trim(), prop.params)
        if (stamp) exdates.push(stamp.ms)
      }
    } else if (prop.name === 'RECURRENCE-ID') {
      const stamp = parseStamp(prop.value, prop.params)
      if (stamp) recurrenceId = stamp.ms
    } else if (prop.name === 'STATUS') status = prop.value.trim().toUpperCase()
    else if (prop.name === 'LOCATION') location = unescapeText(prop.value)
    else if (prop.name === 'URL') url = prop.value.trim()
    else if (prop.name === 'DESCRIPTION') description = unescapeText(prop.value)
    else if (prop.name === 'X-GOOGLE-CONFERENCE' || prop.name === 'CONFERENCE') conference = prop.value.trim()
  }

  if (!start) return null
  return {
    uid: uid || `${title}-${start.ms}`,
    title: title || 'Untitled meeting',
    start,
    end,
    durationMs,
    rrule,
    exdates,
    recurrenceId,
    status,
    detail: detailFrom(location, url, description, conference),
  }
}

function parseProperty(line: string): { name: string; params: Map<string, string>; value: string } | null {
  let quoted = false
  let colon = -1
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (char === '"') quoted = !quoted
    else if (char === ':' && !quoted) {
      colon = index
      break
    }
  }
  if (colon < 1) return null
  const bits = splitParams(line.slice(0, colon))
  const name = bits[0]?.toUpperCase()
  if (!name) return null
  const params = new Map<string, string>()
  for (const bit of bits.slice(1)) {
    const eq = bit.indexOf('=')
    if (eq < 1) continue
    let value = bit.slice(eq + 1).trim()
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1)
    params.set(bit.slice(0, eq).trim().toUpperCase(), value)
  }
  return { name, params, value: line.slice(colon + 1) }
}

function splitParams(left: string): string[] {
  const bits: string[] = []
  let quoted = false
  let current = ''
  for (const char of left) {
    if (char === '"') quoted = !quoted
    if (char === ';' && !quoted) {
      bits.push(current)
      current = ''
      continue
    }
    current += char
  }
  bits.push(current)
  return bits
}

function parseRule(value: string): Map<string, string> {
  const rule = new Map<string, string>()
  for (const part of value.split(';')) {
    const eq = part.indexOf('=')
    if (eq < 1) continue
    const key = part.slice(0, eq).trim().toUpperCase()
    const raw = part.slice(eq + 1).trim()
    const upper = key === 'UNTIL' || key === 'BYDAY' || key === 'FREQ' || key === 'WKST' || key === 'BYMONTHDAY'
    rule.set(key, upper ? raw.toUpperCase() : raw)
  }
  return rule
}

function parseStamp(value: string, params: Map<string, string>): Stamp | null {
  const raw = value.trim()
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2}))?/.exec(raw)
  if (!match) return null
  const parts: Parts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: match[4] != null ? Number(match[4]) : 0,
    minute: match[5] != null ? Number(match[5]) : 0,
    second: match[6] != null ? Number(match[6]) : 0,
  }
  if (parts.month < 1 || parts.month > 12 || parts.day < 1 || parts.day > 31) return null
  const allDay = params.get('VALUE')?.toUpperCase() === 'DATE' || match[4] == null
  const tzid = params.get('TZID') || null
  let zone: Zone
  if (allDay) zone = 'local'
  else if (raw.endsWith('Z')) zone = 'utc'
  else if (tzid) zone = 'zoned'
  else zone = 'local'
  const ms = toMs(parts, zone, tzid, allDay)
  if (ms == null || Number.isNaN(ms)) return null
  return { parts, zone, timeZone: zone === 'zoned' ? tzid : null, allDay, ms }
}

function parseDuration(value: string): number | null {
  const match = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i.exec(value.trim())
  if (!match) return null
  const total =
    ((((Number(match[1] || 0) * 7 + Number(match[2] || 0)) * 24 + Number(match[3] || 0)) * 60 +
      Number(match[4] || 0)) *
      60 +
      Number(match[5] || 0)) *
    1000
  return total > 0 ? total : null
}

function toMs(parts: Parts, zone: Zone, timeZone: string | null, allDay: boolean): number | null {
  if (allDay || zone === 'local') {
    return new Date(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second).getTime()
  }
  if (zone === 'utc') {
    return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
  }
  if (!timeZone) return null
  return zonedTimeToUtc(parts, timeZone) ?? new Date(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second).getTime()
}

function zonedTimeToUtc(parts: Parts, timeZone: string): number | null {
  const desired = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
  let guess = desired
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const wall = wallClock(guess, timeZone)
    if (!wall) return null
    const next = desired - (Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second) - guess)
    if (next === guess) return next
    guess = next
  }
  return guess
}

function wallClock(ms: number, timeZone: string): Parts | null {
  try {
    const bag: Record<string, string> = {}
    for (const part of new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(new Date(ms))) {
      if (part.type !== 'literal') bag[part.type] = part.value
    }
    return {
      year: Number(bag.year),
      month: Number(bag.month),
      day: Number(bag.day),
      hour: bag.hour === '24' ? 0 : Number(bag.hour),
      minute: Number(bag.minute),
      second: Number(bag.second),
    }
  } catch {
    return null
  }
}

function detailFrom(location: string, url: string, description: string, conference: string): string | null {
  const blob = [conference, url, location, description].filter(Boolean).join(' ')
  if (/meet\.google\.com/i.test(blob)) return 'Google Meet'
  if (/zoom\.us|zoom\.com/i.test(blob)) return 'Zoom'
  if (/teams\.microsoft\.com|teams\.live\.com/i.test(blob)) return 'Teams'
  if (/webex\.com/i.test(blob)) return 'Webex'
  const place = location.trim()
  if (/^zoom$/i.test(place)) return 'Zoom'
  if (/teams/i.test(place) && place.length < 40) return 'Teams'
  if (place && !/^https?:/i.test(place)) return place.length > 80 ? `${place.slice(0, 77)}…` : place
  return null
}

function unescapeText(value: string): string {
  let out = ''
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === '\\' && index + 1 < value.length) {
      const next = value[index + 1]
      out += next === 'n' || next === 'N' ? ' ' : next
      index += 1
      continue
    }
    out += value[index]
  }
  return out.replace(/[ \t]{2,}/g, ' ').trim()
}

function unfold(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n[ \t]/g, '')
}

function addDays(parts: Parts, days: number): Parts {
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days))
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  }
}

function withClock(parts: Parts, clock: Parts): Parts {
  return { ...parts, hour: clock.hour, minute: clock.minute, second: clock.second }
}

function weekStartParts(parts: Parts, wkst: number): Parts {
  const current = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay()
  return addDays(parts, -((current - wkst + 7) % 7))
}

function civilCompare(a: Parts, b: Parts): number {
  return a.year - b.year || a.month - b.month || a.day - b.day || a.hour - b.hour || a.minute - b.minute || a.second - b.second
}

function civilDay(parts: Parts): number {
  return Math.floor(Date.UTC(parts.year, parts.month - 1, parts.day) / DAY_MS)
}

function partsFromMs(ms: number): Parts {
  const date = new Date(ms)
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
    hour: date.getHours(),
    minute: date.getMinutes(),
    second: date.getSeconds(),
  }
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}
