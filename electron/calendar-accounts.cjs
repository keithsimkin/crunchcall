/**
 * Google Calendar and Outlook sign-in for the desktop app.
 * Refresh tokens stay in the main process. On Windows, Electron safeStorage
 * encrypts them with DPAPI before they are written to disk. The renderer
 * receives account names, calendar names, and events only.
 */

const crypto = require('crypto')
const fs = require('fs')
const http = require('http')
const path = require('path')

const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly'
const MICROSOFT_SCOPE = 'offline_access https://graph.microsoft.com/Calendars.Read'
const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token'
const MICROSOFT_AUTH = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize'
const MICROSOFT_TOKEN = 'https://login.microsoftonline.com/common/oauth2/v2.0/token'
const SIGN_IN_MS = 5 * 60 * 1000
const DAY_MS = 86_400_000
const DEFAULT_GOOGLE_CLIENT_ID = '333278308187-f51jcakj57d2q3c2bi1v4u3bt2ku03lo.apps.googleusercontent.com'

function cleanId(value) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (text.length < 8 || /\s/.test(text)) return ''
  return text
}

function firstCredential(...values) {
  for (const value of values) {
    const text = cleanId(value)
    if (text) return text
  }
  return ''
}

function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

function readOAuthFile(file) {
  try {
    const parsed = JSON.parse(stripBom(fs.readFileSync(file, 'utf8')))
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function resolveOAuthConfig({ env = {}, local = {}, packaged = {} } = {}) {
  return {
    googleClientId: firstCredential(
      env.CRUNCHCALL_GOOGLE_CLIENT_ID,
      local.googleClientId,
      packaged.googleClientId,
      DEFAULT_GOOGLE_CLIENT_ID,
    ),
    googleClientSecret: firstCredential(
      env.CRUNCHCALL_GOOGLE_CLIENT_SECRET,
      local.googleClientSecret,
      packaged.googleClientSecret,
    ),
    microsoftClientId: firstCredential(
      env.CRUNCHCALL_MICROSOFT_CLIENT_ID,
      local.microsoftClientId,
      packaged.microsoftClientId,
    ),
  }
}

function loadClientIds(dir = __dirname, env = process.env) {
  const config = resolveOAuthConfig({
    env,
    local: readOAuthFile(path.join(dir, 'oauth.local.json')),
    packaged: readOAuthFile(path.join(dir, 'oauth.json')),
  })
  return {
    google: config.googleClientId,
    googleSecret: config.googleClientSecret,
    microsoft: config.microsoftClientId,
  }
}

function createPkce() {
  const verifier = crypto.randomBytes(32).toString('base64url')
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url')
  const state = crypto.randomBytes(16).toString('base64url')
  return { verifier, challenge, state }
}

function authUrl(provider, { clientId, redirectUri, state, challenge }) {
  const url = new URL(provider === 'google' ? GOOGLE_AUTH : MICROSOFT_AUTH)
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('state', state)
  url.searchParams.set('code_challenge', challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  if (provider === 'google') {
    url.searchParams.set('scope', GOOGLE_SCOPE)
    url.searchParams.set('access_type', 'offline')
    url.searchParams.set('prompt', 'consent')
    url.searchParams.set('include_granted_scopes', 'false')
  } else {
    url.searchParams.set('scope', MICROSOFT_SCOPE)
    url.searchParams.set('response_mode', 'query')
    url.searchParams.set('prompt', 'select_account')
  }
  return url.toString()
}

function mapGoogleEvents(items, calendar, range) {
  const events = []
  for (const item of items || []) {
    if (!item || item.status === 'cancelled' || !item.id) continue
    const when = googleWhen(item.start, item.end)
    if (!when || when.end <= range.start || when.start >= range.end) continue
    const links = [item.hangoutLink]
    const points = item.conferenceData && item.conferenceData.entryPoints
    if (Array.isArray(points)) {
      for (const point of points) {
        if (point && point.uri) links.push(point.uri)
      }
    }
    events.push(eventRow('google', calendar, String(item.id), item.summary, when, meetingDetail(item.location, links.filter(Boolean).join(' '))))
  }
  return events
}

function mapMicrosoftEvents(items, calendar, range) {
  const events = []
  for (const item of items || []) {
    if (!item || item.isCancelled || !item.id) continue
    const when = microsoftWhen(item)
    if (!when || when.end <= range.start || when.start >= range.end) continue
    const place = item.location && item.location.displayName
    events.push(eventRow('microsoft', calendar, String(item.id), item.subject, when, meetingDetail(place, item.onlineMeetingUrl || '')))
  }
  return events
}

function createCalendarAccounts(options) {
  const fetchImpl = options.fetch || globalThis.fetch
  const file = options.file
  const encrypt = options.encrypt
  const decrypt = options.decrypt
  const openExternal = options.openExternal
  const clientIds = {
    google: cleanId(options.clientIds && options.clientIds.google),
    googleSecret: cleanId(options.clientIds && options.clientIds.googleSecret),
    microsoft: cleanId(options.clientIds && options.clientIds.microsoft),
  }
  const accessCache = new Map()
  let pending = null

  function status() {
    const saved = readFile()
    return {
      configured: {
        google: Boolean(clientIds.google && clientIds.googleSecret),
        microsoft: Boolean(clientIds.microsoft),
      },
      connected: {
        google: accountName(saved.google),
        microsoft: accountName(saved.microsoft),
      },
    }
  }

  async function connect(provider) {
    const setupError = setupProblem(provider)
    if (setupError) return { ok: false, error: setupError }
    if (pending) return { ok: false, error: 'A sign-in is already open.' }

    const pkce = createPkce()
    let server
    try {
      server = await listenLoopback()
    } catch {
      return { ok: false, error: "Couldn't open a sign-in page on this PC." }
    }

    const redirectUri = `http://127.0.0.1:${server.port}/callback`
    let cancelWait
    const outcome = waitForCallback(server.server, pkce.state, (cancel) => {
      cancelWait = cancel
    }).then(
      (code) => ({ ok: true, code }),
      (error) => ({ ok: false, error }),
    )
    pending = { cancel: cancelWait }
    try {
      await openExternal(authUrl(provider, { clientId: clientIds[provider], redirectUri, state: pkce.state, challenge: pkce.challenge }))
      const result = await outcome
      if (!result.ok) return signInFailure(provider, result.error)
      const tokens = await exchange(provider, {
        code: result.code,
        redirectUri,
        verifier: pkce.verifier,
      })
      if (!tokens.ok) return tokens
      const listed = await fetchCalendars(provider, tokens.access)
      if (!listed.ok) return listed
      writeAccount(provider, listed.account, tokens.refresh)
      rememberAccess(provider, tokens.access, tokens.expiresIn)
      return { ok: true, provider, account: listed.account, calendars: listed.calendars }
    } catch (error) {
      if (cancelWait) cancelWait()
      await outcome
      return signInFailure(provider, error)
    } finally {
      pending = null
      server.close()
    }
  }

  function cancel() {
    if (!pending) return
    const current = pending
    pending = null
    current.cancel()
  }

  async function list(provider) {
    const setupError = setupProblem(provider)
    if (setupError) return { ok: false, error: setupError }
    const saved = openEntry(readFile()[provider])
    if (!saved) return { ok: false, error: reconnectMessage(provider) }
    const token = await accessToken(provider, saved.refresh)
    if (!token.ok) return token
    const listed = await fetchCalendars(provider, token.token)
    if (!listed.ok) return listed
    return { ...listed, provider }
  }

  async function sync(provider, calendars, range) {
    const setupError = setupProblem(provider)
    if (setupError) return { ok: false, error: setupError }
    const saved = openEntry(readFile()[provider])
    if (!saved) return { ok: false, error: reconnectMessage(provider) }
    const token = await accessToken(provider, saved.refresh)
    if (!token.ok) return token
    const events = []
    for (const calendar of calendars) {
      const batch = await fetchEvents(provider, token.token, calendar, range)
      if (!batch.ok && batch.unauthorized) {
        accessCache.delete(provider)
        const renewed = await accessToken(provider, openEntry(readFile()[provider])?.refresh || saved.refresh)
        if (!renewed.ok) return renewed
        const retry = await fetchEvents(provider, renewed.token, calendar, range)
        if (!retry.ok) return retry
        events.push(...retry.events)
        continue
      }
      if (!batch.ok) return batch
      events.push(...batch.events)
    }
    events.sort((a, b) => a.start - b.start || a.title.localeCompare(b.title))
    return { ok: true, events: events.slice(0, 200) }
  }

  function disconnect(provider) {
    accessCache.delete(provider)
    const saved = readFile()
    delete saved[provider]
    writeAll(saved)
  }

  function setupProblem(provider) {
    if (provider !== 'google' && provider !== 'microsoft') return 'Choose Google or Outlook.'
    if (provider === 'google' && (!clientIds.google || !clientIds.googleSecret)) return notSetUp(provider)
    if (provider === 'microsoft' && !clientIds.microsoft) return notSetUp(provider)
    if (!seals()) return 'This PC cannot store a sign-in securely.'
    return ''
  }

  function tokenFields(provider, fields) {
    if (provider === 'google' && clientIds.googleSecret) fields.client_secret = clientIds.googleSecret
    return fields
  }

  function seals() {
    try {
      const sealed = encrypt('crunchcall-calendar')
      return Boolean(sealed) && decrypt(sealed) === 'crunchcall-calendar'
    } catch {
      return false
    }
  }

  async function exchange(provider, { code, redirectUri, verifier }) {
    const fields = tokenFields(provider, {
      client_id: clientIds[provider],
      code,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      code_verifier: verifier,
    })
    const result = await postForm(provider === 'google' ? GOOGLE_TOKEN : MICROSOFT_TOKEN, fields)
    if (!result.ok || !result.json) return tokenFailure(provider, result)
    const access = result.json.access_token
    const refresh = result.json.refresh_token
    if (!access || !refresh) {
      return { ok: false, error: `${providerName(provider)} did not grant a lasting sign-in. Connect again and allow calendar access.` }
    }
    return { ok: true, access, refresh, expiresIn: Number(result.json.expires_in) || 3600 }
  }

  async function accessToken(provider, refresh) {
    const cached = accessCache.get(provider)
    if (cached && cached.expiresAt > Date.now() + 60_000) return { ok: true, token: cached.token }
    const fields = tokenFields(provider, {
      client_id: clientIds[provider],
      grant_type: 'refresh_token',
      refresh_token: refresh,
    })
    if (provider === 'microsoft') fields.scope = MICROSOFT_SCOPE
    const result = await postForm(provider === 'google' ? GOOGLE_TOKEN : MICROSOFT_TOKEN, fields)
    if (!result.ok || !result.json || !result.json.access_token) {
      if (result.json && result.json.error === 'invalid_grant') {
        disconnect(provider)
        return { ok: false, error: reconnectMessage(provider) }
      }
      if (clientRejected(result)) return { ok: false, error: notSetUp(provider) }
      return { ok: false, error: reachMessage(provider) }
    }
    if (result.json.refresh_token && result.json.refresh_token !== refresh) {
      const saved = openEntry(readFile()[provider])
      if (saved) writeAccount(provider, saved.account, result.json.refresh_token)
    }
    rememberAccess(provider, result.json.access_token, Number(result.json.expires_in) || 3600)
    return { ok: true, token: result.json.access_token }
  }

  function rememberAccess(provider, token, expiresIn) {
    accessCache.set(provider, { token, expiresAt: Date.now() + expiresIn * 1000 })
  }

  async function fetchCalendars(provider, token) {
    if (provider === 'google') return googleCalendars(token)
    return microsoftCalendars(token)
  }

  async function googleCalendars(token) {
    const items = []
    let page = 'https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=50'
    for (let step = 0; step < 4 && page; step += 1) {
      const result = await getJson(page, token)
      if (!result.ok) return providerHttpError('google', result)
      const batch = result.json && result.json.items
      if (Array.isArray(batch)) items.push(...batch)
      const next = result.json && result.json.nextPageToken
      page = next
        ? `https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=50&pageToken=${encodeURIComponent(next)}`
        : ''
    }
    const calendars = items
      .filter((item) => item && item.id && item.summary)
      .slice(0, 30)
      .map((item) => ({
        id: String(item.id),
        name: clip(item.summary, 120),
        checked: item.primary === true || item.selected !== false,
      }))
    if (calendars.length === 0) return { ok: false, error: 'Google did not return any calendars for that account.' }
    if (!calendars.some((item) => item.checked)) calendars[0].checked = true
    const primary = items.find((item) => item && item.primary && item.id) || items.find((item) => item && item.id)
    return { ok: true, account: String(primary.id), calendars }
  }

  async function microsoftCalendars(token) {
    const result = await getJson('https://graph.microsoft.com/v1.0/me/calendars?$top=30&$select=id,name,isDefaultCalendar,owner', token)
    if (!result.ok) return providerHttpError('microsoft', result)
    const items = result.json && Array.isArray(result.json.value) ? result.json.value : []
    const calendars = items
      .filter((item) => item && item.id && item.name)
      .slice(0, 30)
      .map((item) => ({
        id: String(item.id),
        name: clip(item.name, 120),
        checked: item.isDefaultCalendar === true,
      }))
    if (calendars.length === 0) return { ok: false, error: 'Outlook did not return any calendars for that account.' }
    if (!calendars.some((item) => item.checked)) calendars[0].checked = true
    const owner = items.find((item) => item && item.owner && item.owner.address)
    const account = owner ? String(owner.owner.address) : calendars[0].name
    return { ok: true, account, calendars }
  }

  async function fetchEvents(provider, token, calendar, range) {
    if (provider === 'google') return googleEvents(token, calendar, range)
    return microsoftEvents(token, calendar, range)
  }

  async function googleEvents(token, calendar, range) {
    const items = []
    let pageToken = ''
    for (let step = 0; step < 4; step += 1) {
      const page = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendar.id)}/events`)
      page.searchParams.set('singleEvents', 'true')
      page.searchParams.set('orderBy', 'startTime')
      page.searchParams.set('maxResults', '100')
      page.searchParams.set('timeMin', new Date(range.start).toISOString())
      page.searchParams.set('timeMax', new Date(range.end).toISOString())
      page.searchParams.set(
        'fields',
        'items(id,status,summary,start,end,location,hangoutLink,conferenceData/entryPoints/uri),nextPageToken',
      )
      if (pageToken) page.searchParams.set('pageToken', pageToken)
      const result = await getJson(page.toString(), token)
      if (!result.ok) return providerHttpError('google', result, calendar.name)
      const batch = result.json && result.json.items
      if (Array.isArray(batch)) items.push(...batch)
      pageToken = result.json && result.json.nextPageToken ? String(result.json.nextPageToken) : ''
      if (!pageToken) break
    }
    return { ok: true, events: mapGoogleEvents(items, calendar, range) }
  }

  async function microsoftEvents(token, calendar, range) {
    const items = []
    const first = new URL(`https://graph.microsoft.com/v1.0/me/calendars/${encodeURIComponent(calendar.id)}/calendarView`)
    first.searchParams.set('startDateTime', new Date(range.start).toISOString())
    first.searchParams.set('endDateTime', new Date(range.end).toISOString())
    first.searchParams.set('$top', '100')
    first.searchParams.set('$select', 'id,subject,isAllDay,isCancelled,start,end,location,onlineMeetingUrl')
    let page = first.toString()
    for (let step = 0; step < 4 && page; step += 1) {
      const result = await getJson(page, token, { Prefer: 'outlook.timezone="UTC"' })
      if (!result.ok) return providerHttpError('microsoft', result, calendar.name)
      const batch = result.json && result.json.value
      if (Array.isArray(batch)) items.push(...batch)
      page = graphNext(result.json && result.json['@odata.nextLink'])
    }
    return { ok: true, events: mapMicrosoftEvents(items, calendar, range) }
  }

  async function postForm(url, fields) {
    try {
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams(fields),
        signal: AbortSignal.timeout(20_000),
      })
      return readJsonResponse(response)
    } catch {
      return { ok: false, status: 0, json: null }
    }
  }

  async function getJson(url, token, extraHeaders) {
    try {
      const response = await fetchImpl(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          ...(extraHeaders || {}),
        },
        signal: AbortSignal.timeout(20_000),
      })
      return readJsonResponse(response)
    } catch {
      return { ok: false, status: 0, json: null }
    }
  }

  function readFile() {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
      return {
        google: fileEntry(parsed.google),
        microsoft: fileEntry(parsed.microsoft),
      }
    } catch {
      return {}
    }
  }

  function fileEntry(entry) {
    if (!entry || typeof entry.account !== 'string' || typeof entry.refresh !== 'string' || !entry.refresh) return null
    return { account: entry.account, refresh: entry.refresh }
  }

  function openEntry(entry) {
    if (!entry) return null
    try {
      const refresh = decrypt(entry.refresh)
      if (!refresh) return null
      return { account: entry.account, refresh }
    } catch {
      return null
    }
  }

  function accountName(entry) {
    return openEntry(entry)?.account || null
  }

  function writeAccount(provider, account, refresh) {
    const saved = readFile()
    const sealed = encrypt(refresh)
    if (!sealed) throw new Error('seal')
    saved[provider] = { account, refresh: sealed }
    writeAll(saved)
  }

  function writeAll(saved) {
    const body = {
      version: 1,
      google: saved.google ? { account: saved.google.account, refresh: saved.google.refresh } : null,
      microsoft: saved.microsoft ? { account: saved.microsoft.account, refresh: saved.microsoft.refresh } : null,
    }
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const temp = `${file}.${process.pid}.tmp`
    fs.writeFileSync(temp, JSON.stringify(body), { mode: 0o600 })
    fs.renameSync(temp, file)
  }

  return { status, connect, cancel, list, sync, disconnect }
}

function providerHttpError(provider, result, calendarName) {
  if (result.status === 401) return { ok: false, unauthorized: true, error: reconnectMessage(provider) }
  if (result.status === 404 && calendarName) {
    return { ok: false, error: `${calendarName} is no longer available. Choose calendars again.` }
  }
  return { ok: false, error: reachMessage(provider) }
}

function signInFailure(provider, error) {
  const failure = { ok: false, error: signInError(provider, error) }
  if (error && error.message === 'cancelled') failure.cancelled = true
  return failure
}

function signInError(provider, error) {
  const code = error && error.message
  if (code === 'timeout') return 'The sign-in window timed out. Try again.'
  if (code === 'cancelled') return 'Sign-in was cancelled.'
  if (code === 'denied') return 'Calendar access was not allowed.'
  if (code === 'state') return 'That sign-in did not match this app. Try again.'
  if (code === 'seal') return 'This PC cannot store a sign-in securely.'
  return reachMessage(provider)
}

function tokenFailure(provider, result) {
  if (clientRejected(result)) return { ok: false, error: notSetUp(provider) }
  return { ok: false, error: reachMessage(provider) }
}

function clientRejected(result) {
  const code = result && result.json && result.json.error
  if (code === 'invalid_client' || code === 'unauthorized_client') return true
  const description = result && result.json && typeof result.json.error_description === 'string' ? result.json.error_description : ''
  return code === 'invalid_request' && /client_secret/i.test(description)
}

function notSetUp(provider) {
  return `${providerName(provider)} sign-in is not set up in this copy of annotated yet.`
}

function reconnectMessage(provider) {
  return `${providerName(provider)} needs you to connect again.`
}

function reachMessage(provider) {
  return `Couldn't reach ${providerName(provider)}.`
}

function providerName(provider) {
  return provider === 'google' ? 'Google' : 'Outlook'
}

function listenLoopback() {
  return new Promise((resolve, reject) => {
    const server = http.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      resolve({
        server,
        port: address.port,
        close: () => {
          if (server.listening) server.close()
        },
      })
    })
  })
}

function waitForCallback(server, expectedState, onCancel) {
  return new Promise((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => finish(new Error('timeout')), SIGN_IN_MS)

    function finish(error, code) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) reject(error)
      else resolve(code)
    }

    onCancel(() => finish(new Error('cancelled')))

    server.on('request', (req, res) => {
      let url
      try {
        url = new URL(req.url || '/', 'http://127.0.0.1')
      } catch {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end('Bad request')
        return
      }
      if (url.pathname === '/favicon.ico') {
        res.writeHead(204)
        res.end()
        return
      }
      if (url.pathname !== '/callback') {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end('Not found')
        return
      }
      const state = url.searchParams.get('state') || ''
      const code = url.searchParams.get('code') || ''
      const oauthError = url.searchParams.get('error') || ''
      if (!safeEqual(state, expectedState)) {
        sendPage(res, 'That sign-in did not match this app.', 'Close this window and try again from annotated.')
        finish(new Error('state'))
        return
      }
      if (oauthError || !code) {
        sendPage(res, 'Sign-in was cancelled.', 'You can close this window.')
        finish(new Error(oauthError === 'access_denied' ? 'denied' : 'cancelled'))
        return
      }
      sendPage(res, 'annotated is connected.', 'You can close this window and return to the app.')
      finish(null, code)
    })
  })
}

function sendPage(res, title, body) {
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'close',
  })
  res.end(
    `<!doctype html><meta charset="utf-8"><title>annotated</title><body style="font-family:system-ui,sans-serif;padding:48px"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(body)}</p></body>`,
  )
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char])
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left))
  const b = Buffer.from(String(right))
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

function googleWhen(start, end) {
  if (!start) return null
  if (start.date && !start.dateTime) {
    const startMs = localDate(start.date)
    const endMs = end && end.date ? localDate(end.date) : startMs == null ? null : startMs + DAY_MS
    if (startMs == null || endMs == null || endMs <= startMs) return null
    return { start: startMs, end: endMs, allDay: true }
  }
  if (!start.dateTime) return null
  const startMs = Date.parse(start.dateTime)
  const endMs = end && end.dateTime ? Date.parse(end.dateTime) : startMs + 30 * 60 * 1000
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null
  return { start: startMs, end: endMs, allDay: false }
}

function microsoftWhen(item) {
  const allDay = item.isAllDay === true
  if (allDay) {
    const startMs = localDate(String(item.start && item.start.dateTime ? item.start.dateTime : '').slice(0, 10))
    const endMs = localDate(String(item.end && item.end.dateTime ? item.end.dateTime : '').slice(0, 10))
    if (startMs == null || endMs == null || endMs <= startMs) return null
    return { start: startMs, end: endMs, allDay: true }
  }
  const startMs = graphTime(item.start && item.start.dateTime)
  const endMs = graphTime(item.end && item.end.dateTime)
  if (startMs == null || endMs == null || endMs <= startMs) return null
  return { start: startMs, end: endMs, allDay: false }
}

function graphTime(value) {
  if (!value) return null
  let text = String(value).trim().replace(/(\.\d{3})\d+/, '$1')
  if (/^\d{4}-\d{2}-\d{2}T/.test(text) && !/(?:[zZ]|[+-]\d{2}:\d{2})$/.test(text)) text += 'Z'
  const ms = Date.parse(text)
  return Number.isFinite(ms) ? ms : null
}

function localDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value))
  if (!match) return null
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getTime()
}

function eventRow(provider, calendar, id, title, when, detail) {
  const uid = `${provider}:${calendar.id}:${id}`
  return {
    uid,
    instanceKey: `${uid}:${when.start}`,
    title: clip(title || 'Untitled meeting', 200),
    start: when.start,
    end: when.end,
    allDay: when.allDay,
    detail,
  }
}

function meetingDetail(location, url) {
  const blob = `${url || ''} ${location || ''}`
  if (/meet\.google\.com/i.test(blob)) return 'Google Meet'
  if (/zoom\.us|zoom\.com/i.test(blob)) return 'Zoom'
  if (/teams\.microsoft\.com|teams\.live\.com/i.test(blob)) return 'Teams'
  if (/webex\.com/i.test(blob)) return 'Webex'
  const place = String(location || '').trim()
  if (place && !/^https?:/i.test(place)) return place.length > 80 ? `${place.slice(0, 77)}…` : place
  return null
}

function clip(value, max) {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  if (!text) return 'Untitled meeting'
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

function graphNext(value) {
  if (!value) return ''
  try {
    const url = new URL(String(value))
    if (url.protocol !== 'https:' || url.hostname !== 'graph.microsoft.com') return ''
    return url.toString()
  } catch {
    return ''
  }
}

async function readJsonResponse(response) {
  const text = await response.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    json = null
  }
  return { ok: response.ok, status: response.status, json }
}

module.exports = {
  loadClientIds,
  resolveOAuthConfig,
  createPkce,
  authUrl,
  mapGoogleEvents,
  mapMicrosoftEvents,
  createCalendarAccounts,
  GOOGLE_SCOPE,
  MICROSOFT_SCOPE,
  DEFAULT_GOOGLE_CLIENT_ID,
}
