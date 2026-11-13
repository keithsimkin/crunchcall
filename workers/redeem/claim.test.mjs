import { generateKeyPairSync } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { expect, test } from 'bun:test'
import { verifyLicense } from '../../electron/license.cjs'
import { createMemoryCodes, createSupabaseCodes, redeemCode } from './src/codes.mjs'
import { decideActivation, mapSeat } from './src/seats.mjs'
import { handleRequest } from './src/worker.mjs'

const ISSUED = 1_780_000_000
const CODE = 'ANN-TEST-CODE-0001'
const EMAIL = 'buyer@example.com'

function memory() {
  return createMemoryCodes([CODE])
}

test('the first redeem stores one seat and a second email is rejected', async () => {
  const db = memory()
  const first = await redeemCode(db, {
    code: 'ann-test-code-0001',
    email: 'Buyer@Example.com',
    license: 'annotated1.first-token',
    issued: ISSUED,
  })
  expect(first).toMatchObject({ ok: true, order: `appsumo_${CODE}`, replay: false, license: 'annotated1.first-token' })
  const again = await redeemCode(db, {
    code: CODE,
    email: EMAIL,
    license: 'annotated1.second-token',
    issued: ISSUED + 10,
  })
  expect(again).toMatchObject({ ok: true, replay: true, license: 'annotated1.first-token' })
  const other = await redeemCode(db, {
    code: CODE,
    email: 'other@example.com',
    license: 'annotated1.third-token',
    issued: ISSUED,
  })
  expect(other).toMatchObject({ ok: false, reason: 'email_mismatch' })
  expect(await db.getOrder(`appsumo_${CODE}`)).toMatchObject({ license: 'annotated1.first-token', maxDevices: 1 })
})

test('unknown codes and malformed codes are not claimed', async () => {
  const db = memory()
  expect((await redeemCode(db, { code: 'NOPE', email: EMAIL, license: 'annotated1.x', issued: ISSUED })).reason).toBe('unknown')
  expect((await redeemCode(db, { code: 'bad code', email: EMAIL, license: 'annotated1.x', issued: ISSUED })).reason).toBe('invalid')
  expect((await redeemCode(db, { code: CODE, email: 'not-an-email', license: 'annotated1.x', issued: ISSUED })).reason).toBe('invalid')
  expect(await db.getOrder(`appsumo_${CODE}`)).toBeNull()
})

test('two redeems of a free code keep a single license', async () => {
  const db = memory()
  const [left, right] = await Promise.all([
    redeemCode(db, { code: CODE, email: EMAIL, license: 'annotated1.left', issued: ISSUED }),
    redeemCode(db, { code: CODE, email: EMAIL, license: 'annotated1.right', issued: ISSUED }),
  ])
  expect(left.ok && right.ok).toBe(true)
  expect(left.license).toBe(right.license)
  expect(left.license.startsWith('annotated1.')).toBe(true)
})

test('the supabase claim updates only an unredeemed code', async () => {
  const rows = new Map([[CODE, { code: CODE, email: null, redeemed_at: null, license_order_id: null }]])
  const orders = new Map()
  const calls = []
  const eq = (params, name) => {
    const value = params.get(name) || ''
    return value.startsWith('eq.') ? value.slice(3) : value
  }
  const fetchImpl = async (url, init) => {
    const target = new URL(url)
    calls.push(`${init && init.method ? init.method : 'GET'} ${target.pathname}${target.search}`)
    if (target.pathname.endsWith('/appsumo_codes') && init && init.method === 'PATCH' && target.searchParams.get('redeemed_at') === 'is.null') {
      const row = rows.get(eq(target.searchParams, 'code'))
      if (!row || row.redeemed_at) return json([])
      const body = JSON.parse(init.body)
      row.redeemed_at = body.redeemed_at
      row.email = body.email
      return json([row])
    }
    if (target.pathname.endsWith('/appsumo_codes') && (!init || !init.method || init.method === 'GET')) {
      const row = rows.get(eq(target.searchParams, 'code'))
      return json(row ? [row] : [])
    }
    if (target.pathname.endsWith('/appsumo_codes') && init && init.method === 'PATCH') {
      const row = rows.get(eq(target.searchParams, 'code'))
      Object.assign(row, JSON.parse(init.body))
      return json([])
    }
    if (target.pathname.endsWith('/license_orders') && init && init.method === 'POST') {
      const body = JSON.parse(init.body)
      if (!orders.has(body.order_id)) orders.set(body.order_id, body)
      return json([])
    }
    if (target.pathname.endsWith('/license_orders')) {
      const row = orders.get(eq(target.searchParams, 'order_id'))
      return json(row ? [{ order_id: row.order_id, email: row.email, license: row.license, max_devices: row.max_devices, issued: row.issued }] : [])
    }
    return json({ message: 'nope' }, 404)
  }
  const db = createSupabaseCodes({ url: 'https://example.supabase.co', serviceKey: 'service-role-test', fetchImpl })
  const saved = await redeemCode(db, { code: CODE, email: EMAIL, license: 'annotated1.remote', issued: ISSUED })
  expect(saved.ok).toBe(true)
  expect(calls.some((call) => call.includes('redeemed_at=is.null'))).toBe(true)
  expect(orders.get(`appsumo_${CODE}`).max_devices).toBe(1)
  const replay = await redeemCode(db, { code: CODE, email: EMAIL, license: 'annotated1.other', issued: ISSUED + 5 })
  expect(replay).toMatchObject({ ok: true, replay: true, license: 'annotated1.remote' })
})

test('a seat is idempotent for the same device and blocks the next one', () => {
  const first = decideActivation({ maxDevices: 1, deviceIds: [], deviceId: 'a' })
  expect(first).toMatchObject({ ok: true, action: 'insert', maxDevices: 1 })
  const same = decideActivation({ maxDevices: 1, deviceIds: ['a'], deviceId: 'a' })
  expect(same).toMatchObject({ ok: true, action: 'touch' })
  const next = decideActivation({ maxDevices: 1, deviceIds: ['a'], deviceId: 'b' })
  expect(next).toMatchObject({ ok: false, reason: 'limit_reached' })
  expect(decideActivation({ maxDevices: null, deviceIds: [], deviceId: 'a' })).toMatchObject({ ok: true, limited: false })
})

test('seat rpc payloads map without echoing extra fields', () => {
  expect(mapSeat({ ok: true, limited: true, maxDevices: 1, email: 'hidden@example.com' })).toEqual({
    ok: true,
    limited: true,
    maxDevices: 1,
  })
  expect(mapSeat({ ok: false, reason: 'limit_reached', maxDevices: 1 }).reason).toBe('limit_reached')
  expect(mapSeat(null).reason).toBe('unavailable')
})

test('the migration keeps codes and activations off the public roles', () => {
  const sql = fs.readFileSync(
    path.join(import.meta.dir, '../../supabase/migrations/20261113110000_appsumo_licensing.sql'),
    'utf8',
  )
  const lower = sql.toLowerCase()
  expect(lower.match(/enable row level security/g)).toHaveLength(3)
  expect(lower).not.toContain('security definer')
  expect(lower).toContain('security invoker')
  expect(lower).toContain("set search_path = ''")
  expect(lower).toContain('for update')
  expect(sql).toContain('limit_reached')
  expect(lower).toContain('revoke all on function public.activate_license_device(text, text, text, text) from public, anon, authenticated')
  expect(lower).toContain('revoke all on table public.appsumo_codes from public, anon, authenticated')
  expect(lower).toContain('revoke all on table public.license_activations from public, anon, authenticated')
})

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

test('redeem and activate hide secrets and repeat the same key', async () => {
  const keys = generateKeyPairSync('ed25519')
  const privateKey = keys.privateKey.export({ type: 'pkcs8', format: 'pem' })
  const publicKey = keys.publicKey.export({ type: 'spki', format: 'pem' })
  const db = memory()
  const seats = {
    async activate(input) {
      return decideActivation({ maxDevices: 1, deviceIds: [], deviceId: input.deviceId })
    },
    async deactivate() {
      return { ok: true }
    },
  }
  const env = {
    ANNOTATED_LICENSE_PRIVATE_KEY: privateKey,
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-secret',
  }
  const form = await handleRequest(new Request('https://annotated.click/redeem'), env, { codes: db, seats, now: () => ISSUED })
  expect(form.status).toBe(200)
  expect(await form.text()).toContain('AppSumo code')

  const redeem = async (email) =>
    handleRequest(
      new Request('https://annotated.click/redeem', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ code: CODE, email }),
      }),
      env,
      { codes: db, seats, now: () => ISSUED },
    )
  const first = await redeem(EMAIL)
  const firstBody = await first.json()
  expect(firstBody.ok).toBe(true)
  expect(verifyLicense(firstBody.license, publicKey, ISSUED).ok).toBe(true)
  expect(JSON.stringify(firstBody)).not.toContain('service-role-secret')
  expect(JSON.stringify(firstBody)).not.toContain('BEGIN PRIVATE KEY')
  const second = await redeem(EMAIL)
  expect(await second.json()).toMatchObject({ ok: true, license: firstBody.license })
  const page = await handleRequest(
    new Request('https://annotated.click/redeem', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: `code=${CODE}&email=${encodeURIComponent(EMAIL)}`,
    }),
    env,
    { codes: db, seats, now: () => ISSUED },
  )
  const html = await page.text()
  expect(page.status).toBe(200)
  expect(html).toContain(firstBody.license)
  expect(html).toContain('Copy key')
  expect(html).toContain('https://annotated.click')
  expect(html).toContain('Deactivate this PC')
  expect(html).not.toContain('service-role-secret')
  expect(html).not.toContain('BEGIN PRIVATE KEY')
  const mismatch = await redeem('other@example.com')
  const mismatchBody = await mismatch.json()
  expect(mismatchBody).toEqual({ ok: false, reason: 'email_mismatch' })
  expect(JSON.stringify(mismatchBody)).not.toContain('annotated1')

  const deviceId = 'a'.repeat(64)
  const activated = await handleRequest(
    new Request('https://annotated.click/api/license/activate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ license: firstBody.license, deviceId, deviceLabel: 'Desk' }),
    }),
    env,
    { codes: db, seats, now: () => ISSUED },
  )
  expect(await activated.json()).toEqual({ ok: true, limited: true, maxDevices: 1 })
})
