import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, test } from 'bun:test'
import {
  DEFAULT_GOOGLE_CLIENT_ID,
  GOOGLE_SCOPE,
  MICROSOFT_SCOPE,
  authUrl,
  createCalendarAccounts,
  createPkce,
  loadClientIds,
  mapGoogleEvents,
  mapMicrosoftEvents,
  resolveOAuthConfig,
} from './calendar-accounts.cjs'

const DAY = 86_400_000
const temps = []

afterEach(() => {
  for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

test('pkce challenge is the sha256 of the verifier', () => {
  const pkce = createPkce()
  expect(pkce.challenge).toBe(createHash('sha256').update(pkce.verifier).digest('base64url'))
  expect(pkce.state).not.toBe(pkce.verifier)
})

test('google and outlook sign-in urls ask for read-only calendar access', () => {
  const google = new URL(
    authUrl('google', {
      clientId: 'google-client',
      redirectUri: 'http://127.0.0.1:9/callback',
      state: 'state-1',
      challenge: 'chal',
    }),
  )
  expect(google.origin + google.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
  expect(google.searchParams.get('scope')).toBe(GOOGLE_SCOPE)
  expect(google.searchParams.get('code_challenge_method')).toBe('S256')
  expect(google.searchParams.get('access_type')).toBe('offline')
  expect(google.searchParams.get('response_type')).toBe('code')
  expect(google.searchParams.has('client_secret')).toBe(false)

  const microsoft = new URL(
    authUrl('microsoft', {
      clientId: 'ms-client',
      redirectUri: 'http://127.0.0.1:9/callback',
      state: 'state-1',
      challenge: 'chal',
    }),
  )
  expect(microsoft.origin + microsoft.pathname).toBe('https://login.microsoftonline.com/common/oauth2/v2.0/authorize')
  expect(microsoft.searchParams.get('scope')).toBe(MICROSOFT_SCOPE)
  expect(microsoft.searchParams.get('code_challenge_method')).toBe('S256')
  expect(microsoft.searchParams.has('client_secret')).toBe(false)
})

test('google events keep meet links and all-day dates, and drop cancelled ones', () => {
  const start = new Date(2026, 10, 12).getTime()
  const end = new Date(2026, 10, 13).getTime()
  const events = mapGoogleEvents(
    [
      {
        id: 'all',
        status: 'confirmed',
        summary: 'Offsite',
        start: { date: '2026-11-12' },
        end: { date: '2026-11-13' },
      },
      {
        id: 'meet',
        status: 'confirmed',
        summary: 'Standup',
        start: { dateTime: '2026-11-12T15:00:00Z' },
        end: { dateTime: '2026-11-12T15:30:00Z' },
        hangoutLink: 'https://meet.google.com/abc-defg-hij',
      },
      { id: 'gone', status: 'cancelled', summary: 'Skip', start: { dateTime: '2026-11-12T16:00:00Z' }, end: { dateTime: '2026-11-12T17:00:00Z' } },
    ],
    { id: 'ada@gmail.com', name: 'Ada' },
    { start: start - 1000, end: end + DAY },
  )
  expect(events.map((event) => event.title)).toEqual(['Offsite', 'Standup'])
  expect(events[0]).toMatchObject({ allDay: true, start, end, detail: null })
  expect(events[1]).toMatchObject({
    allDay: false,
    start: Date.parse('2026-11-12T15:00:00Z'),
    end: Date.parse('2026-11-12T15:30:00Z'),
    detail: 'Google Meet',
  })
})

test('outlook events treat timezone-less times as UTC', () => {
  const range = { start: Date.parse('2026-11-01T00:00:00Z'), end: Date.parse('2026-11-30T00:00:00Z') }
  const events = mapMicrosoftEvents(
    [
      {
        id: 'call',
        subject: 'Review',
        isAllDay: false,
        isCancelled: false,
        start: { dateTime: '2026-11-12T15:00:00.0000000' },
        end: { dateTime: '2026-11-12T15:45:00.0000000' },
        location: { displayName: 'Board room' },
      },
      {
        id: 'day',
        subject: 'Holiday',
        isAllDay: true,
        start: { dateTime: '2026-11-20T00:00:00.0000000' },
        end: { dateTime: '2026-11-21T00:00:00.0000000' },
      },
    ],
    { id: 'cal-1', name: 'Calendar' },
    range,
  )
  expect(events[0]).toMatchObject({
    title: 'Review',
    start: Date.parse('2026-11-12T15:00:00.000Z'),
    end: Date.parse('2026-11-12T15:45:00.000Z'),
    allDay: false,
    detail: 'Board room',
  })
  expect(events[1]).toMatchObject({
    allDay: true,
    start: new Date(2026, 10, 20).getTime(),
    end: new Date(2026, 10, 21).getTime(),
  })
})

test('google connect stores the refresh token sealed and can sync events', async () => {
  const { accounts, file } = createTestAccounts({
    async openExternal(url) {
      expect(new URL(url).searchParams.has('client_secret')).toBe(false)
      await hitCallback(url, { code: 'auth-code' })
    },
    async fetch(url, init) {
      const target = String(url)
      if (target === 'https://oauth2.googleapis.com/token') {
        const body = String(init.body)
        expect(body).toContain('code=auth-code')
        expect(body).toContain('code_verifier=')
        expect(body).toContain('client_secret=google-secret-value')
        return json({ access_token: 'access-token', refresh_token: 'refresh-secret-value', expires_in: 3600 })
      }
      if (target.startsWith('https://www.googleapis.com/calendar/v3/users/me/calendarList')) {
        expect(init.headers.Authorization).toBe('Bearer access-token')
        return json({
          items: [
            { id: 'ada@gmail.com', summary: 'Ada', primary: true, selected: true },
            { id: 'team', summary: 'Team', selected: false },
          ],
        })
      }
      if (target.startsWith('https://www.googleapis.com/calendar/v3/calendars/')) {
        expect(init.headers.Authorization).toBe('Bearer access-token')
        const page = new URL(target).searchParams.get('pageToken')
        if (!page) {
          return json({
            items: [
              {
                id: 'evt-1',
                status: 'confirmed',
                summary: 'Standup',
                start: { dateTime: '2026-11-12T15:00:00Z' },
                end: { dateTime: '2026-11-12T15:30:00Z' },
                hangoutLink: 'https://meet.google.com/abc-defg-hij',
              },
            ],
            nextPageToken: 'page-2',
          })
        }
        expect(page).toBe('page-2')
        expect(target.split('pageToken=').length).toBe(2)
        return json({ items: [] })
      }
      throw new Error(`unexpected ${target}`)
    },
  })

  const connected = await accounts.connect('google')
  expect(connected.ok).toBe(true)
  if (!connected.ok) return
  expect(connected.account).toBe('ada@gmail.com')
  expect(connected.calendars.map((calendar) => [calendar.name, calendar.checked])).toEqual([
    ['Ada', true],
    ['Team', false],
  ])

  const raw = fs.readFileSync(file, 'utf8')
  expect(raw).toContain('ada@gmail.com')
  expect(raw).not.toContain('refresh-secret-value')
  expect(raw).not.toContain('access-token')

  const synced = await accounts.sync('google', [{ id: 'ada@gmail.com', name: 'Ada' }], {
    start: Date.parse('2026-11-12T00:00:00Z'),
    end: Date.parse('2026-11-13T00:00:00Z'),
  })
  expect(synced.ok).toBe(true)
  if (!synced.ok) return
  expect(synced.events.map((event) => event.title)).toEqual(['Standup'])
  expect(synced.events[0].detail).toBe('Google Meet')

  accounts.disconnect('google')
  const again = await accounts.sync('google', [{ id: 'ada@gmail.com', name: 'Ada' }], {
    start: Date.parse('2026-11-12T00:00:00Z'),
    end: Date.parse('2026-11-13T00:00:00Z'),
  })
  expect(again).toEqual({ ok: false, error: 'Google needs you to connect again.' })
})

test('a denied sign-in does not save a token', async () => {
  const { accounts, file } = createTestAccounts({
    async openExternal(url) {
      await hitCallback(url, { error: 'access_denied' })
    },
    async fetch() {
      throw new Error('no token request expected')
    },
  })
  const result = await accounts.connect('microsoft')
  expect(result).toEqual({ ok: false, error: 'Calendar access was not allowed.' })
  expect(fs.existsSync(file)).toBe(false)
  expect(accounts.status().connected.microsoft).toBe(null)
})

test('a sign-in answer with the wrong state is refused', async () => {
  const { accounts } = createTestAccounts({
    async openExternal(url) {
      await hitCallback(url, { code: 'auth-code', state: 'not-the-state' })
    },
    async fetch() {
      throw new Error('no token request expected')
    },
  })
  const result = await accounts.connect('google')
  expect(result).toEqual({ ok: false, error: 'That sign-in did not match this app. Try again.' })
})

test('cancel closes the sign-in without saving a token', async () => {
  const { accounts } = createTestAccounts({
    async openExternal() {
      accounts.cancel()
    },
    async fetch() {
      throw new Error('no token request expected')
    },
  })
  expect(await accounts.connect('google')).toEqual({
    ok: false,
    error: 'Sign-in was cancelled.',
    cancelled: true,
  })
})

test('google refresh sends the client secret and keeps it off the browser url', async () => {
  const { accounts } = createTestAccounts({
    async openExternal(url) {
      expect(new URL(url).searchParams.has('client_secret')).toBe(false)
      await hitCallback(url, { code: 'auth-code' })
    },
    async fetch(url, init) {
      const target = String(url)
      if (target === 'https://oauth2.googleapis.com/token') {
        const body = String(init.body)
        expect(body).toContain('client_secret=google-secret-value')
        if (body.includes('grant_type=refresh_token')) {
          expect(body).toContain('refresh_token=refresh-secret-value')
          expect(body).not.toContain('code=')
          return json({ access_token: 'access-2', expires_in: 3600 })
        }
        return json({ access_token: 'access-token', refresh_token: 'refresh-secret-value', expires_in: 1 })
      }
      if (target.startsWith('https://www.googleapis.com/calendar/v3/users/me/calendarList')) {
        return json({ items: [{ id: 'ada@gmail.com', summary: 'Ada', primary: true, selected: true }] })
      }
      if (target.startsWith('https://www.googleapis.com/calendar/v3/calendars/')) {
        expect(init.headers.Authorization).toBe('Bearer access-2')
        return json({ items: [] })
      }
      throw new Error(`unexpected ${target}`)
    },
  })
  expect((await accounts.connect('google')).ok).toBe(true)
  const synced = await accounts.sync('google', [{ id: 'ada@gmail.com', name: 'Ada' }], {
    start: Date.parse('2026-11-12T00:00:00Z'),
    end: Date.parse('2026-11-13T00:00:00Z'),
  })
  expect(synced).toEqual({ ok: true, events: [] })
})

test('a missing google client secret is reported as not set up', async () => {
  const { accounts, file } = createTestAccounts({
    clientIds: { google: 'google-client', googleSecret: '', microsoft: '' },
    async openExternal() {
      throw new Error('browser should stay closed')
    },
    async fetch() {
      return json({ error: 'invalid_client', error_description: 'The client secret is missing.' }, 401)
    },
  })
  expect(accounts.status().configured).toEqual({ google: false, microsoft: false })
  expect(await accounts.connect('google')).toEqual({
    ok: false,
    error: 'Google sign-in is not set up in this copy of annotated yet.',
  })
  expect(fs.existsSync(file)).toBe(false)
})

test('google reports a rejected client secret without saving a token', async () => {
  const { accounts, file } = createTestAccounts({
    async openExternal(url) {
      await hitCallback(url, { code: 'auth-code' })
    },
    async fetch() {
      return json({ error: 'invalid_request', error_description: 'client_secret is missing.' }, 400)
    },
  })
  expect(await accounts.connect('google')).toEqual({
    ok: false,
    error: 'Google sign-in is not set up in this copy of annotated yet.',
  })
  expect(fs.existsSync(file)).toBe(false)
})

test('outlook token requests omit the google client secret', async () => {
  const { accounts } = createTestAccounts({
    async openExternal(url) {
      expect(new URL(url).searchParams.has('client_secret')).toBe(false)
      await hitCallback(url, { code: 'auth-code' })
    },
    async fetch(url, init) {
      const target = String(url)
      if (target === 'https://login.microsoftonline.com/common/oauth2/v2.0/token') {
        const body = String(init.body)
        expect(body).not.toContain('client_secret')
        if (body.includes('grant_type=refresh_token')) {
          expect(body).toContain('scope=')
          return json({ access_token: 'ms-access-2', expires_in: 3600 })
        }
        return json({ access_token: 'ms-access', refresh_token: 'ms-refresh', expires_in: 1 })
      }
      if (target.startsWith('https://graph.microsoft.com/v1.0/me/calendars?')) {
        expect(init.headers.Authorization).toBe('Bearer ms-access')
        return json({
          value: [{ id: 'cal-1', name: 'Calendar', isDefaultCalendar: true, owner: { address: 'ada@outlook.com' } }],
        })
      }
      if (target.includes('/calendarView')) {
        expect(init.headers.Authorization).toBe('Bearer ms-access-2')
        return json({ value: [] })
      }
      throw new Error(`unexpected ${target}`)
    },
  })
  const connected = await accounts.connect('microsoft')
  expect(connected.ok).toBe(true)
  const synced = await accounts.sync('microsoft', [{ id: 'cal-1', name: 'Calendar' }], {
    start: Date.parse('2026-11-12T00:00:00Z'),
    end: Date.parse('2026-11-13T00:00:00Z'),
  })
  expect(synced).toEqual({ ok: true, events: [] })
})

test('oauth config prefers env, then the local file, then the packaged file', () => {
  const resolved = resolveOAuthConfig({
    env: {
      CRUNCHCALL_GOOGLE_CLIENT_ID: '',
      CRUNCHCALL_GOOGLE_CLIENT_SECRET: 'env-secret-value',
      CRUNCHCALL_MICROSOFT_CLIENT_ID: '   ',
    },
    local: {
      googleClientId: 'local-google-client',
      googleClientSecret: 'local-secret-value',
      microsoftClientId: 'local-ms-client',
    },
    packaged: {
      googleClientId: 'pack-google-client',
      googleClientSecret: 'pack-secret-value',
      microsoftClientId: 'pack-ms-client',
    },
  })
  expect(resolved).toEqual({
    googleClientId: 'local-google-client',
    googleClientSecret: 'env-secret-value',
    microsoftClientId: 'local-ms-client',
  })

  expect(resolveOAuthConfig()).toEqual({
    googleClientId: DEFAULT_GOOGLE_CLIENT_ID,
    googleClientSecret: '',
    microsoftClientId: '',
  })
  expect(
    resolveOAuthConfig({
      env: { CRUNCHCALL_GOOGLE_CLIENT_SECRET: 'bad secret' },
      packaged: { googleClientSecret: 'pack-secret-value' },
    }).googleClientSecret,
  ).toBe('pack-secret-value')
})

test('packaged oauth.json is used when env and the local file are empty', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crunchcall-oauth-'))
  temps.push(dir)
  fs.writeFileSync(
    path.join(dir, 'oauth.example.json'),
    JSON.stringify({ googleClientId: 'example-client-should-not-load', googleClientSecret: 'example-secret-value' }),
  )
  fs.writeFileSync(
    path.join(dir, 'oauth.json'),
    JSON.stringify({
      googleClientId: 'pack-google-client',
      googleClientSecret: 'pack-secret-value',
      microsoftClientId: '',
    }),
  )
  expect(loadClientIds(dir, {})).toEqual({
    google: 'pack-google-client',
    googleSecret: 'pack-secret-value',
    microsoft: '',
  })
  fs.writeFileSync(
    path.join(dir, 'oauth.local.json'),
    JSON.stringify({ googleClientSecret: 'local-secret-value', microsoftClientId: 'local-ms-client' }),
  )
  expect(loadClientIds(dir, { CRUNCHCALL_GOOGLE_CLIENT_ID: 'env-google-client' })).toEqual({
    google: 'env-google-client',
    googleSecret: 'local-secret-value',
    microsoft: 'local-ms-client',
  })
})

test('the example oauth file publishes the google client id and leaves the secret empty', () => {
  const example = JSON.parse(fs.readFileSync(new URL('./oauth.example.json', import.meta.url), 'utf8'))
  expect(example.googleClientId).toBe(DEFAULT_GOOGLE_CLIENT_ID)
  expect(example.googleClientSecret).toBe('')
  expect(example.microsoftClientId).toBe('')
})

test('sign-in without a client id explains that this copy is not set up', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crunchcall-cal-'))
  temps.push(dir)
  const accounts = createCalendarAccounts({
    file: path.join(dir, 'accounts.json'),
    encrypt: seal,
    decrypt: open,
    openExternal: async () => {},
    fetch: async () => {
      throw new Error('no network')
    },
    clientIds: { google: '', microsoft: '' },
  })
  expect(await accounts.connect('google')).toEqual({
    ok: false,
    error: 'Google sign-in is not set up in this copy of annotated yet.',
  })
})

function createTestAccounts({ openExternal, fetch, clientIds }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crunchcall-cal-'))
  temps.push(dir)
  const file = path.join(dir, 'accounts.json')
  const accounts = createCalendarAccounts({
    file,
    encrypt: seal,
    decrypt: open,
    openExternal,
    fetch,
    clientIds: clientIds || { google: 'google-client', googleSecret: 'google-secret-value', microsoft: 'ms-client' },
  })
  return { accounts, file }
}

function seal(text) {
  return Buffer.from(`v1:${text}`).toString('base64')
}

function open(encoded) {
  const text = Buffer.from(encoded, 'base64').toString('utf8')
  if (!text.startsWith('v1:')) throw new Error('bad seal')
  return text.slice(3)
}

function json(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {},
    async text() {
      return JSON.stringify(body)
    },
  }
}

async function hitCallback(auth, extra) {
  const url = new URL(auth)
  const redirect = new URL(url.searchParams.get('redirect_uri'))
  redirect.searchParams.set('state', extra.state || url.searchParams.get('state'))
  if (extra.code) redirect.searchParams.set('code', extra.code)
  if (extra.error) redirect.searchParams.set('error', extra.error)
  const response = await fetch(redirect)
  expect(response.status).toBe(200)
  const page = await response.text()
  expect(page).not.toContain(extra.code || 'auth-code-should-not-leak')
}
