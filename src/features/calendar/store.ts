import { duePhrase } from './format'
import { parseCalendar, type CalendarEvent } from './ics'

const KEY = 'crunchcall.calendar'
const LOOKAHEAD_MS = 14 * 24 * 60 * 60 * 1000
const REFRESH_MS = 15 * 60 * 1000
const TICK_MS = 10_000
export const PROMPT_BEFORE_MS = 2 * 60 * 1000
export const PROMPT_AFTER_MS = 10 * 60 * 1000

export type CalendarProvider = 'google' | 'microsoft'

export type AccountCalendar = { id: string; name: string }

export type CalendarSource =
  | { kind: 'url'; url: string }
  | { kind: 'file'; name: string }
  | { kind: 'account'; provider: CalendarProvider; account: string; calendars: AccountCalendar[] }

export type CalendarConnectResult =
  | { ok: true; provider: CalendarProvider; account: string; calendars: Array<AccountCalendar & { checked?: boolean }> }
  | { ok: false; error: string; cancelled?: boolean }

export type CalendarSignIn = {
  configured: { google: boolean; microsoft: boolean }
  connected: { google: string | null; microsoft: string | null }
}

export type CalendarState = {
  enabled: boolean
  askToStart: boolean
  source: CalendarSource | null
  events: CalendarEvent[]
  syncedAt: number | null
  error: string | null
  prompted: string[]
  dismissed: string[]
}

const initial: CalendarState = {
  enabled: false,
  askToStart: true,
  source: null,
  events: [],
  syncedAt: null,
  error: null,
  prompted: [],
  dismissed: [],
}

let state: CalendarState = load()
let fetchedAt = state.syncedAt ?? 0
let refreshGen = 0
let watchingSent: boolean | null = null
let activeKey: string | null = null
let pendingStart: string | null = null
const listeners = new Set<() => void>()
const startListeners = new Set<(instanceKey: string) => void>()

export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getState(): CalendarState {
  return state
}

export function onCalendarStart(listener: (instanceKey: string) => void): () => void {
  startListeners.add(listener)
  if (pendingStart) {
    const instanceKey = pendingStart
    pendingStart = null
    listener(instanceKey)
  }
  return () => startListeners.delete(listener)
}

export function setActiveMeeting(instanceKey: string | null) {
  activeKey = instanceKey
}

export function setEnabled(on: boolean) {
  update({ enabled: on })
  if (on) ensureNotifyPermission()
  if (on && refreshes(state.source)) void refresh()
}

export function setAskToStart(on: boolean) {
  update({ askToStart: on })
  if (on) ensureNotifyPermission()
}

export function setCalendarError(error: string) {
  update({ error })
}

export function resetCalendar() {
  // Drop a refresh that is already in flight so it cannot write events back.
  refreshGen += 1
  fetchedAt = 0
  void desktop()?.disconnectCalendar?.('google')
  void desktop()?.disconnectCalendar?.('microsoft')
  state = {
    enabled: false,
    askToStart: true,
    source: null,
    events: [],
    syncedAt: null,
    error: null,
    prompted: [],
    dismissed: [],
  }
  persist()
  emit()
  syncWatching()
}

/** Local screenshot / walkthrough seed. Does not hit Google or Outlook. */
export function seedDemoCalendar(events: CalendarEvent[]) {
  refreshGen += 1
  fetchedAt = Date.now()
  update({
    enabled: true,
    askToStart: true,
    source: { kind: 'file', name: 'demo calendar' },
    events: events.filter(validEvent),
    syncedAt: Date.now(),
    error: null,
    prompted: [],
    dismissed: [],
  })
}

export function dismiss(instanceKey: string) {
  if (state.dismissed.includes(instanceKey) && state.prompted.includes(instanceKey)) return
  update({
    dismissed: pushCapped(state.dismissed, instanceKey),
    prompted: pushCapped(state.prompted, instanceKey),
  })
}

export async function connectUrl(raw: string): Promise<void> {
  const url = normalizeUrl(raw)
  if (!url) {
    update({ error: 'Paste a calendar link first.' })
    return
  }
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    update({ error: 'That link is not a valid address.' })
    return
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    update({ error: 'Use an https calendar link.' })
    return
  }
  update({ enabled: true, source: { kind: 'url', url }, error: null })
  ensureNotifyPermission()
  await refresh()
}

export function importCalendarText(name: string, text: string) {
  if (text.length > 5_000_000) {
    update({ error: 'That file is too large to import.' })
    return
  }
  try {
    const events = parseCalendar(text, syncRange())
    update({
      enabled: true,
      source: { kind: 'file', name: name || 'calendar.ics' },
      events,
      syncedAt: Date.now(),
      error: null,
    })
    ensureNotifyPermission()
  } catch {
    update({ error: "That file isn't a calendar." })
  }
}

export async function beginAccountConnect(provider: CalendarProvider): Promise<CalendarConnectResult> {
  const bridge = desktop()
  if (!bridge?.connectCalendar) return { ok: false, error: 'Connect Google or Outlook in the desktop app.' }
  update({ error: null })
  const result = await bridge.connectCalendar(provider)
  if (!result.ok && !result.cancelled) update({ error: result.error })
  return result
}

export async function accountChoices(provider: CalendarProvider): Promise<CalendarConnectResult> {
  const bridge = desktop()
  if (!bridge?.calendarChoices) return { ok: false, error: 'Connect Google or Outlook in the desktop app.' }
  const result = await bridge.calendarChoices(provider)
  if (!result.ok) update({ error: result.error })
  return result
}

export async function watchAccount(
  provider: CalendarProvider,
  account: string,
  calendars: AccountCalendar[],
): Promise<void> {
  const chosen = calendars
    .filter((calendar) => calendar.id.trim() && calendar.name.trim())
    .slice(0, 20)
    .map((calendar) => ({ id: calendar.id.trim(), name: calendar.name.trim() }))
  if (!account.trim() || chosen.length === 0) {
    update({ error: 'Choose at least one calendar.' })
    return
  }
  update({
    enabled: true,
    source: { kind: 'account', provider, account: account.trim(), calendars: chosen },
    error: null,
  })
  ensureNotifyPermission()
  await refresh()
}

export async function disconnectAccount(provider: CalendarProvider): Promise<void> {
  await desktop()?.disconnectCalendar?.(provider)
  if (state.source?.kind === 'account' && state.source.provider === provider) {
    update({ source: null, events: [], syncedAt: null, error: null })
  }
}

export async function cancelAccountConnect(): Promise<void> {
  await desktop()?.cancelCalendarSignIn?.()
}

export async function readCalendarSignIn(): Promise<CalendarSignIn | null> {
  const bridge = desktop()
  if (!bridge?.calendarSignIn) return null
  try {
    return await bridge.calendarSignIn()
  } catch {
    return null
  }
}

export async function refresh(): Promise<void> {
  const source = state.source
  if (!state.enabled || !refreshes(source)) return
  const gen = ++refreshGen
  if (source?.kind === 'account') {
    await refreshAccount(source, gen)
    return
  }
  if (source?.kind !== 'url') return
  const result = await fetchCalendarText(source.url)
  if (gen !== refreshGen) return
  fetchedAt = Date.now()
  if (!result.ok) {
    update({ error: result.error })
    return
  }
  try {
    const events = parseCalendar(result.text, syncRange())
    update({ events, syncedAt: Date.now(), error: null })
    maybeNotify()
  } catch {
    update({ error: "That link didn't return a calendar. Use a secret .ics address." })
  }
}

export function listUpcoming(events: CalendarEvent[], now: number): CalendarEvent[] {
  return events
    .filter((event) => event.end > now)
    .sort((a, b) => a.start - b.start)
    .slice(0, 6)
}

export function pickDue(events: CalendarEvent[], now: number, dismissed: readonly string[]): CalendarEvent | null {
  let best: CalendarEvent | null = null
  for (const event of events) {
    if (event.allDay || dismissed.includes(event.instanceKey)) continue
    if (now < event.start - PROMPT_BEFORE_MS || now > event.start + PROMPT_AFTER_MS) continue
    if (now >= event.end) continue
    if (!best || event.start < best.start) best = event
  }
  return best
}

export function normalizeUrl(raw: string): string {
  const trimmed = raw.trim()
  if (/^webcals:\/\//i.test(trimmed)) return `https://${trimmed.slice('webcals://'.length)}`
  if (/^webcal:\/\//i.test(trimmed)) return `https://${trimmed.slice('webcal://'.length)}`
  return trimmed
}

function refreshes(source: CalendarSource | null): source is Extract<CalendarSource, { kind: 'url' | 'account' }> {
  return source?.kind === 'url' || source?.kind === 'account'
}

async function refreshAccount(source: Extract<CalendarSource, { kind: 'account' }>, gen: number) {
  const bridge = desktop()
  if (!bridge?.syncCalendar) {
    update({ error: 'Connect Google or Outlook in the desktop app.' })
    return
  }
  const result = await bridge.syncCalendar(source.provider, source.calendars, syncRange())
  if (gen !== refreshGen) return
  fetchedAt = Date.now()
  if (!result.ok) {
    update({ error: result.error })
    return
  }
  update({ events: result.events.filter(validEvent), syncedAt: Date.now(), error: null })
  maybeNotify()
}

function syncRange(now = Date.now()) {
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  return { start: start.getTime(), end: now + LOOKAHEAD_MS }
}

function update(patch: Partial<CalendarState>) {
  state = { ...state, ...patch }
  persist()
  emit()
  syncWatching()
}

function emit() {
  for (const listener of listeners) listener()
}

function maybeNotify() {
  if (!state.enabled || !state.askToStart) return
  const due = pickDue(state.events, Date.now(), state.dismissed)
  if (!due || due.instanceKey === activeKey || state.prompted.includes(due.instanceKey)) return
  update({ prompted: pushCapped(state.prompted, due.instanceKey) })
  void notify(due)
}

async function maybeRefresh() {
  if (!state.enabled || !refreshes(state.source)) return
  if (Date.now() - fetchedAt < REFRESH_MS) return
  await refresh()
}

async function notify(event: CalendarEvent) {
  const payload = {
    instanceKey: event.instanceKey,
    title: event.title,
    body: `${duePhrase(event.start)}. Turn annotated on for this meeting?`,
  }
  try {
    const bridge = desktop()
    if (bridge) {
      await bridge.notify(payload)
      return
    }
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
    const note = new Notification(payload.title, { body: payload.body })
    note.onclick = () => {
      window.focus()
    }
  } catch {
    // The in-app prompt still asks.
  }
}

function emitStart(instanceKey: string) {
  if (startListeners.size === 0) {
    pendingStart = instanceKey
    return
  }
  pendingStart = null
  for (const listener of startListeners) listener(instanceKey)
}

function ensureNotifyPermission() {
  if (desktop()) return
  if (typeof Notification === 'undefined' || Notification.permission !== 'default') return
  void Notification.requestPermission()
}

function syncWatching() {
  const watch = state.enabled && state.askToStart && state.source != null
  if (watch === watchingSent) return
  watchingSent = watch
  void desktop()?.setWatching(watch)
}

function desktop() {
  if (typeof window === 'undefined') return undefined
  return window.crunchcall
}

async function fetchCalendarText(url: string): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const bridge = desktop()
  if (bridge) return bridge.fetchCalendar(url)
  try {
    const response = await fetch(url)
    if (!response.ok) return { ok: false, error: `The calendar site returned ${response.status}.` }
    const text = await response.text()
    if (text.length > 5_000_000) return { ok: false, error: 'That calendar is too large to sync.' }
    return { ok: true, text }
  } catch {
    return { ok: false, error: 'The browser blocked that link. Use the desktop app, or import an .ics file.' }
  }
}

function pushCapped(list: string[], value: string): string[] {
  if (list.includes(value)) return list
  return [...list, value].slice(-400)
}

function load(): CalendarState {
  if (typeof localStorage === 'undefined') return initial
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return initial
    const parsed = JSON.parse(raw) as Partial<CalendarState>
    return {
      enabled: parsed.enabled === true,
      askToStart: parsed.askToStart !== false,
      source: validSource(parsed.source),
      events: Array.isArray(parsed.events) ? parsed.events.filter(validEvent) : [],
      syncedAt: typeof parsed.syncedAt === 'number' ? parsed.syncedAt : null,
      error: typeof parsed.error === 'string' ? parsed.error : null,
      prompted: stringList(parsed.prompted),
      dismissed: stringList(parsed.dismissed),
    }
  } catch {
    return initial
  }
}

function validSource(source: CalendarSource | null | undefined): CalendarSource | null {
  if (!source || typeof source !== 'object') return null
  if (source.kind === 'url' && typeof source.url === 'string' && source.url) return { kind: 'url', url: source.url }
  if (source.kind === 'file' && typeof source.name === 'string' && source.name) return { kind: 'file', name: source.name }
  if (source.kind === 'account' && (source.provider === 'google' || source.provider === 'microsoft')) {
    if (typeof source.account !== 'string' || !source.account.trim()) return null
    if (!Array.isArray(source.calendars)) return null
    const calendars = source.calendars
      .filter((calendar) => calendar && typeof calendar.id === 'string' && typeof calendar.name === 'string')
      .map((calendar) => ({ id: calendar.id, name: calendar.name }))
      .filter((calendar) => calendar.id && calendar.name)
      .slice(0, 20)
    if (calendars.length === 0) return null
    return { kind: 'account', provider: source.provider, account: source.account, calendars }
  }
  return null
}

function validEvent(event: CalendarEvent): event is CalendarEvent {
  return (
    !!event &&
    typeof event.uid === 'string' &&
    typeof event.instanceKey === 'string' &&
    typeof event.title === 'string' &&
    typeof event.start === 'number' &&
    typeof event.end === 'number' &&
    typeof event.allDay === 'boolean'
  )
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string').slice(-400)
}

function persist() {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    // The calendar still works for this session if the disk quota is full.
  }
}

function boot() {
  if (typeof window === 'undefined') return
  desktop()?.onStart((instanceKey) => emitStart(instanceKey))
  window.setInterval(() => {
    void maybeRefresh()
    maybeNotify()
  }, TICK_MS)
  syncWatching()
  if (state.enabled && refreshes(state.source)) void refresh()
  else maybeNotify()
}

const bootKey = Symbol.for('crunchcall.calendar.boot')
const root = globalThis as typeof globalThis & { [bootKey]?: boolean }
if (!root[bootKey]) {
  root[bootKey] = true
  boot()
}
