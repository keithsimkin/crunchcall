import { createSupabaseCodes, normalizeCode, orderIdForCode, redeemCode } from './codes.mjs'
import { renderForm, renderSuccess, securityHeaders } from './page.mjs'
import { createSupabaseSeats, normalizeDeviceId, normalizeLabel } from './seats.mjs'
import { issueLicenseToken, normalizeEmail, verifyLicenseToken } from './sign.mjs'

const MESSAGES = {
  invalid: 'Enter the code from AppSumo and the email you want on this license.',
  unknown: 'That code could not be redeemed.',
  email_mismatch: 'This code was already redeemed with a different email.',
  unavailable: 'License redemption is unavailable right now. Try again in a moment.',
}

function log(event, fields) {
  console.log(JSON.stringify({ event, ...fields }))
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    },
  })
}

function html(page, status = 200) {
  return new Response(page.html, { status, headers: securityHeaders(page.csp) })
}

function wantsJson(request) {
  const type = request.headers.get('content-type') || ''
  const accept = request.headers.get('accept') || ''
  return type.includes('application/json') || accept.includes('application/json')
}

async function readPayload(request) {
  const declared = Number(request.headers.get('content-length') || 0)
  if (Number.isFinite(declared) && declared > 16_384) return { error: 'invalid' }
  const text = await request.text()
  if (text.length > 16_384) return { error: 'invalid' }
  const type = request.headers.get('content-type') || ''
  if (type.includes('application/json')) {
    try {
      const value = JSON.parse(text)
      return { value: value && typeof value === 'object' ? value : {} }
    } catch {
      return { error: 'invalid' }
    }
  }
  const params = new URLSearchParams(text)
  return { value: Object.fromEntries(params) }
}

function field(value) {
  return typeof value === 'string' ? value : ''
}

function signingKey(env) {
  const key = env && env.ANNOTATED_LICENSE_PRIVATE_KEY
  return typeof key === 'string' && key.includes('PRIVATE KEY') ? key : ''
}

export function createDeps(env, overrides = {}) {
  return {
    codes:
      overrides.codes ||
      createSupabaseCodes({
        url: env && env.SUPABASE_URL,
        serviceKey: env && env.SUPABASE_SERVICE_ROLE_KEY,
      }),
    seats:
      overrides.seats ||
      createSupabaseSeats({
        url: env && env.SUPABASE_URL,
        serviceKey: env && env.SUPABASE_SERVICE_ROLE_KEY,
      }),
    now: overrides.now || (() => Math.floor(Date.now() / 1000)),
  }
}

function seatBody(result) {
  if (result.ok) {
    return { status: 200, body: { ok: true, limited: result.limited === true, maxDevices: result.maxDevices ?? null } }
  }
  const reason = result.reason || 'unavailable'
  const status = reason === 'limit_reached' ? 409 : reason === 'unavailable' ? 503 : 400
  return { status, body: { ok: false, reason } }
}

async function redeem(request, env, deps) {
  const payload = await readPayload(request)
  const code = field(payload.value && payload.value.code)
  const email = field(payload.value && payload.value.email)
  const asJson = wantsJson(request)
  if (payload.error || !normalizeCode(code) || !normalizeEmail(email)) {
    log('redeem', { ok: false, reason: 'invalid' })
    if (asJson) return json({ ok: false, reason: 'invalid' }, 400)
    return html(renderForm({ code, email, error: MESSAGES.invalid }), 400)
  }
  const order = orderIdForCode(normalizeCode(code))
  const issued = deps.now()
  let token = ''
  try {
    token = await issueLicenseToken(signingKey(env), { email, order, issued })
  } catch {
    log('redeem', { ok: false, reason: 'sign' })
    if (asJson) return json({ ok: false, reason: 'unavailable' }, 503)
    return html(renderForm({ code, email, error: MESSAGES.unavailable }), 503)
  }
  let result
  try {
    result = await redeemCode(deps.codes, { code, email, license: token, issued })
  } catch {
    log('redeem', { ok: false, reason: 'unavailable' })
    if (asJson) return json({ ok: false, reason: 'unavailable' }, 503)
    return html(renderForm({ code, email, error: MESSAGES.unavailable }), 503)
  }
  if (!result.ok) {
    log('redeem', { ok: false, reason: result.reason })
    const message = MESSAGES[result.reason] || MESSAGES.unknown
    if (asJson) return json({ ok: false, reason: result.reason }, result.status || 400)
    return html(renderForm({ code, email, error: message }), result.status || 400)
  }
  log('redeem', { ok: true, replay: Boolean(result.replay) })
  if (asJson) return json({ ok: true, license: result.license, order: result.order })
  return html(renderSuccess(result.license))
}

async function changeSeat(request, env, deps, action) {
  const payload = await readPayload(request)
  if (payload.error) return json({ ok: false, reason: 'malformed' }, 400)
  const license = field(payload.value && payload.value.license).trim()
  const deviceId = normalizeDeviceId(payload.value && payload.value.deviceId)
  if (!deviceId) return json({ ok: false, reason: 'device' }, 400)
  let verified
  try {
    verified = await verifyLicenseToken(signingKey(env), license, deps.now())
  } catch {
    log(action, { ok: false, reason: 'sign' })
    return json({ ok: false, reason: 'unavailable' }, 503)
  }
  if (!verified.ok) {
    log(action, { ok: false, reason: verified.reason })
    return json({ ok: false, reason: verified.reason }, 400)
  }
  let result
  try {
    const input = {
      orderId: verified.order,
      email: verified.email,
      deviceId,
      deviceLabel: normalizeLabel(payload.value && payload.value.deviceLabel),
    }
    result = action === 'deactivate' ? await deps.seats.deactivate(input) : await deps.seats.activate(input)
  } catch {
    log(action, { ok: false, reason: 'unavailable' })
    return json({ ok: false, reason: 'unavailable' }, 503)
  }
  const response = seatBody(result || { ok: false, reason: 'unavailable' })
  log(action, { ok: response.body.ok === true, reason: response.body.reason || '', limited: response.body.limited === true })
  return json(response.body, response.status)
}

export async function handleRequest(request, env, overrides) {
  const url = new URL(request.url)
  const path = url.pathname.replace(/\/+$/, '') || '/'
  if (path === '/redeem' && request.method === 'GET') return html(renderForm())
  const deps = createDeps(env, overrides)
  if (!signingKey(env)) {
    log('config', { ok: false, reason: 'unavailable' })
    if (path === '/redeem' && request.method === 'POST') return html(renderForm({ error: MESSAGES.unavailable }), 503)
    return json({ ok: false, reason: 'unavailable' }, 503)
  }

  if (path === '/redeem' && request.method === 'POST') return redeem(request, env, deps)
  if (path === '/api/license/activate' && request.method === 'POST') return changeSeat(request, env, deps, 'activate')
  if (path === '/api/license/deactivate' && request.method === 'POST') return changeSeat(request, env, deps, 'deactivate')
  if (path === '/redeem' || path === '/api/license/activate' || path === '/api/license/deactivate') {
    return json({ ok: false, reason: 'method' }, 405)
  }
  return json({ ok: false, reason: 'not_found' }, 404)
}
