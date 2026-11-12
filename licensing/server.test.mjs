import fs from 'node:fs'
import crypto from 'node:crypto'
import { generateKeyPairSync } from 'node:crypto'
import { afterEach, expect, test } from 'bun:test'
import { createRequire } from 'node:module'
import { createMemoryStore, createSupabaseStore } from './store.mjs'
import {
  buyPage,
  createServer,
  donePage,
  downloadTarget,
  fulfillSession,
  ipAllowed,
  verifyPaddleSignature,
  verifyStripeSignature,
} from './server.mjs'

const require = createRequire(import.meta.url)
const { verifyLicense } = require('../electron/license.cjs')

const NOW = 1_780_000_000
const temps = []
const servers = []

afterEach(async () => {
  for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))))
})

function keys() {
  const pair = generateKeyPairSync('ed25519')
  return {
    privateKey: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }),
    publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }),
  }
}

function session(id, email, status = 'paid') {
  return {
    id,
    object: 'checkout.session',
    payment_status: status,
    customer_details: { email },
    metadata: { product: 'annotated' },
  }
}

test('stripe signatures must match the raw body and stay recent', () => {
  const secret = 'whsec_test'
  const body = '{"id":"evt_1"}'
  const timestamp = NOW
  const digest = crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')
  const header = `t=${timestamp},v1=${digest}`
  expect(verifyStripeSignature(body, header, secret, NOW)).toBe(true)
  expect(verifyStripeSignature(`${body} `, header, secret, NOW)).toBe(false)
  expect(verifyStripeSignature(body, header, secret, NOW + 1000)).toBe(false)
  expect(verifyStripeSignature(body, `t=${timestamp},v1=${digest.slice(0, -1)}0`, secret, NOW)).toBe(false)
})

test('a paid checkout issues one license and a later event does not replace it', () => {
  const material = keys()
  const orders = {}
  const first = fulfillSession(session('cs_test_order1234', 'Buyer@Example.com'), material.privateKey, orders, NOW)
  const second = fulfillSession(session('cs_test_order1234', 'Buyer@Example.com'), material.privateKey, orders, NOW + 10)
  expect(first.ok).toBe(true)
  expect(second.record.license).toBe(first.record.license)
  const verified = verifyLicense(first.record.license, material.publicKey, NOW)
  expect(verified.ok).toBe(true)
  if (verified.ok) expect(verified.email).toBe('buyer@example.com')
  expect(fulfillSession(session('cs_test_order1234', 'Buyer@Example.com', 'unpaid'), material.privateKey, {}, NOW).pending).toBe(true)
  const html = donePage(first.record, false)
  expect(html).toContain(first.record.license)
  expect(html).not.toContain('<script')
})

test('the installer download requires a valid license and an https file', () => {
  const material = keys()
  const orders = {}
  const issued = fulfillSession(session('cs_test_order1234', 'buyer@example.com'), material.privateKey, orders, NOW)
  const good = downloadTarget(issued.record.license, material.publicKey, 'https://github.com/keithsimkin/crunchcall/releases/download/v1/annotated.exe', NOW)
  expect(good).toEqual({
    status: 302,
    location: 'https://github.com/keithsimkin/crunchcall/releases/download/v1/annotated.exe',
  })
  expect(downloadTarget('annotated1.bad.sig', material.publicKey, 'https://example.com/app.exe', NOW).status).toBe(403)
  expect(downloadTarget(issued.record.license, material.publicKey, 'http://example.com/app.exe', NOW).status).toBe(503)
})

test('license text is escaped on the receipt page', () => {
  const html = donePage({ license: 'annotated1.<script>.abc', email: 'a@b.c', order: 'cs_test_order1234' }, false)
  expect(html).toContain('annotated1.&lt;script&gt;.abc')
  expect(html).not.toContain('<script>')
})

test('paddle signatures accept a second h1 and reject a stale or altered body', () => {
  const secret = 'pdl_ntfset_test'
  const body = '{"event_id":"evt_1"}'
  const digest = crypto.createHmac('sha256', secret).update(`${NOW}:${body}`).digest('hex')
  const header = `ts=${NOW};h1=${digest}`
  expect(verifyPaddleSignature(body, header, secret, NOW)).toBe(true)
  expect(verifyPaddleSignature(body, `ts=${NOW};h1=${'0'.repeat(64)};h1=${digest}`, secret, NOW)).toBe(true)
  expect(verifyPaddleSignature(`${body} `, header, secret, NOW)).toBe(false)
  expect(verifyPaddleSignature(body, header, secret, NOW + 6)).toBe(false)
  expect(verifyPaddleSignature(body, `ts=${NOW};h1=${digest.slice(0, -1)}0`, secret, NOW)).toBe(false)
})

test('paddle source addresses have to sit inside a fetched cidr', () => {
  expect(ipAllowed('203.0.113.5', ['203.0.113.5/32'])).toBe(true)
  expect(ipAllowed('203.0.113.6', ['203.0.113.5/32'])).toBe(false)
  expect(ipAllowed('203.0.113.20', ['203.0.113.0/24'])).toBe(true)
  expect(ipAllowed('203.0.114.20', ['203.0.113.0/24'])).toBe(false)
  expect(ipAllowed('127.0.0.1', [])).toBe(false)
})

test('the buy page uses a live paddle token unless sandbox is selected', () => {
  const live = buyPage({
    ready: false,
    priceLabel: '$35',
    paddle: {
      token: 'live_clienttoken',
      priceId: 'pri_priceid1',
      sandbox: false,
      successUrl: 'https://annotated.click/buy/done',
      customerId: '',
    },
  })
  expect(live).toContain('live_clienttoken')
  expect(live).toContain('pri_priceid1')
  expect(live).not.toContain('Paddle.Environment.set')
  expect(live).not.toContain('pwCustomer')
  expect(live).toContain('href="/account"')
  const returning = buyPage({
    ready: false,
    priceLabel: '$35',
    paddle: {
      token: 'test_clienttoken',
      priceId: 'pri_priceid1',
      sandbox: true,
      successUrl: 'http://127.0.0.1/buy/done',
      customerId: 'ctm_01abcdefgh',
    },
  })
  expect(returning).toContain('Paddle.Environment.set("sandbox")')
  expect(returning).toContain('pwCustomer: { id: "ctm_01abcdefgh" }')
})

test('supabase orders use the service role and signup uses the anon key', async () => {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init })
    const target = String(url)
    if (target.endsWith('/auth/v1/signup')) {
      return Response.json({ user: { id: 'user_1', email: 'Buyer@Example.com' } })
    }
    if (target.endsWith('/auth/v1/token?grant_type=password')) {
      return Response.json({ user: { id: 'user_1', email: 'buyer@example.com', email_confirmed_at: null } })
    }
    if (target.includes('/auth/v1/admin/users/')) {
      return Response.json({ id: 'user_1', email: 'buyer@example.com', email_confirmed_at: '2026-01-02T00:00:00.000Z' })
    }
    if (target.endsWith('/auth/v1/resend')) return Response.json({})
    if (target.includes('/rest/v1/license_orders') && init && init.method === 'POST') {
      return new Response(null, { status: 201 })
    }
    if (target.includes('/rest/v1/license_orders')) {
      return Response.json([{
        order_id: 'txn_01abcdef',
        email: 'buyer@example.com',
        license: 'annotated1.payload.sig',
        claimed: false,
        customer_id: 'ctm_01abcdefgh',
        issued: NOW,
      }])
    }
    return Response.json({ message: 'missing' }, { status: 404 })
  }
  const store = createSupabaseStore({
    url: 'https://example.supabase.co/',
    anonKey: 'anon-key',
    serviceKey: 'service-key',
    fetchImpl,
    emailRedirectTo: 'https://annotated.click/account',
  })
  expect(store.ready).toBe(true)
  expect(createSupabaseStore({ url: '', anonKey: 'anon-key', serviceKey: 'service-key' }).ready).toBe(false)

  const created = await store.signUp({ email: 'buyer@example.com', password: 'long-password' })
  expect(created.ok).toBe(true)
  expect(created.user.email).toBe('buyer@example.com')
  const signup = calls[0]
  expect(signup.url).toBe('https://example.supabase.co/auth/v1/signup')
  expect(signup.init.headers.apikey).toBe('anon-key')
  expect(signup.init.headers.Authorization).toBe('Bearer anon-key')
  expect(JSON.parse(signup.init.body).options.emailRedirectTo).toBe('https://annotated.click/account')

  const signedIn = await store.signIn({ email: 'buyer@example.com', password: 'long-password' })
  expect(signedIn.ok).toBe(true)
  expect(calls[1].init.headers.Authorization).toBe('Bearer anon-key')

  await store.saveOrder({
    email: 'buyer@example.com',
    order: 'txn_01abcdef',
    license: 'annotated1.payload.sig',
    claimed: false,
    customerId: 'ctm_01abcdefgh',
    issued: NOW,
  })
  const save = calls.find((call) => call.url.includes('on_conflict=order_id'))
  expect(save.init.method).toBe('POST')
  expect(save.init.headers.apikey).toBe('service-key')
  expect(save.init.headers.Authorization).toBe('Bearer service-key')
  expect(save.init.headers.Prefer).toBe('resolution=merge-duplicates,return=minimal')
  expect(save.url).not.toContain('anon-key')

  const order = await store.getOrder('txn_01abcdef')
  expect(order.customerId).toBe('ctm_01abcdefgh')
  expect(order.email).toBe('buyer@example.com')
  const listed = await store.listOrders('buyer@example.com')
  expect(listed).toHaveLength(1)
  expect(calls.some((call) => call.url.includes('email=eq.buyer%40example.com'))).toBe(true)

  const sessionUser = await store.userFromSession({ email: 'buyer@example.com', userId: 'user_1' })
  expect(sessionUser.verifiedAt).toBe(Math.floor(Date.parse('2026-01-02T00:00:00.000Z') / 1000))
  expect(await store.userFromSession({ email: 'other@example.com', userId: 'user_1' })).toBe(null)
  const admin = calls.find((call) => call.url.includes('/auth/v1/admin/users/user_1'))
  expect(admin.init.headers.Authorization).toBe('Bearer service-key')

  const confirm = await store.requestConfirm(created.user)
  expect(confirm.ok).toBe(true)
  expect(confirm.token).toBeUndefined()
  expect(await store.confirmEmail({ email: 'buyer@example.com', token: 'x', now: NOW })).toEqual({ ok: false })
  expect(calls.some((call) => JSON.stringify(call.init && call.init.headers).includes('service-key') && call.url.includes('/auth/v1/signup'))).toBe(false)
})

test('supabase signup recognizes an existing account', async () => {
  const store = createSupabaseStore({
    url: 'https://example.supabase.co',
    anonKey: 'anon-key',
    serviceKey: 'service-key',
    fetchImpl: async () => Response.json({ msg: 'User already registered' }, { status: 400 }),
  })
  expect(await store.signUp({ email: 'buyer@example.com', password: 'long-password' })).toEqual({ ok: false, reason: 'exists' })
})

test('a paid order shows up for the buyer and not for anyone else', async () => {
  const mail = []
  const { base, store, material } = await boot({ webhookSecret: 'whsec_test', mail })
  const created = await submitAuth(base, cookieJar(), 'signup', 'new@example.com', 'long-password')
  expect(created.response.status).toBe(200)
  expect(created.html).toContain('No paid license')
  expect(created.html).not.toContain('annotated1.')
  expect(await store.listOrders('new@example.com')).toEqual([])

  const wrong = await submitAuth(base, cookieJar(), 'login', 'new@example.com', 'wrong-password')
  expect(wrong.response.status).toBe(400)
  expect(wrong.html).toContain('Email or password is wrong.')

  const first = await postStripe(base, 'cs_test_order1234', 'Buyer@Example.com')
  expect(first.status).toBe(200)
  const again = await postStripe(base, 'cs_test_order1234', 'Buyer@Example.com')
  expect(again.status).toBe(200)
  const bought = await store.getOrder('cs_test_order1234')
  expect(bought.email).toBe('buyer@example.com')
  expect(verifyLicense(bought.license, material.publicKey).ok).toBe(true)
  expect((await store.listOrders('buyer@example.com'))).toHaveLength(1)

  const buyer = await submitAuth(base, cookieJar(), 'signup', 'Buyer@Example.com', 'long-password')
  expect(buyer.html).not.toContain(bought.license)
  expect(buyer.html).toContain('No paid license')
  const relogin = await submitAuth(base, cookieJar(), 'login', 'buyer@example.com', 'long-password')
  expect(relogin.html).not.toContain(bought.license)

  const duplicate = await submitAuth(base, cookieJar(), 'signup', 'buyer@example.com', 'long-password')
  expect(duplicate.html).toContain('That email already has an account.')

  const message = mail.find((item) => item.to === 'buyer@example.com')
  const link = new URL(message.text.match(/http:\/\/127\.0\.0\.1\/account\/verify\?\S+/)[0])
  const confirmed = await fetch(`${base}/account/verify?email=${encodeURIComponent(link.searchParams.get('email'))}&token=${encodeURIComponent(link.searchParams.get('token'))}`, { redirect: 'manual' })
  expect(confirmed.status).toBe(303)
  const verified = await submitAuth(base, cookieJar(), 'login', 'buyer@example.com', 'long-password')
  expect(verified.html).toContain(bought.license)

  const payerHook = await postStripe(base, 'cs_test_payer1234', 'payer@example.com')
  expect(payerHook.status).toBe(200)
  const payerOrder = await store.getOrder('cs_test_payer1234')
  const receipt = cookieJar()
  const done = await fetch(`${base}/buy/done?session_id=cs_test_payer1234`)
  receipt.absorb(done)
  expect(done.status).toBe(200)
  expect(await done.text()).toContain(payerOrder.license)
  expect(receipt.get('annotated_receipt')).not.toBe('')

  const payerJar = cookieJar()
  payerJar.set('annotated_receipt', receipt.get('annotated_receipt'))
  const payer = await submitAuth(base, payerJar, 'signup', 'payer@example.com', 'long-password')
  expect(payer.html).toContain(payerOrder.license)
  expect(payer.html).not.toContain(bought.license)

  const thiefJar = cookieJar()
  thiefJar.set('annotated_receipt', receipt.get('annotated_receipt'))
  const thief = await submitAuth(base, thiefJar, 'signup', 'thief@example.com', 'long-password')
  expect(thief.html).not.toContain(payerOrder.license)
  expect(thief.html).not.toContain(bought.license)
  expect(await store.listOrders('thief@example.com')).toEqual([])

  const pending = await fetch(`${base}/buy/done?session_id=cs_test_missing1`)
  expect(pending.status).toBe(200)
  expect(await pending.text()).toContain('still settling')
}, 20000)

test('paddle checkout and webhooks record a paid transaction', async () => {
  const allowed = await boot({
    paddleApiKey: 'pdl_live_secretvalue',
    paddleClientToken: 'live_clienttoken',
    paddlePriceId: 'pri_priceid1',
    paddleWebhookSecret: 'pdl_ntfset_test',
    fetchImpl: paddleFetch(['127.0.0.1/32']),
  })
  const checkout = await fetch(`${allowed.base}/checkout`, { method: 'POST', redirect: 'manual' })
  expect(checkout.status).toBe(303)
  expect(checkout.headers.get('location')).toBe('http://127.0.0.1/buy?_ptxn=txn_01abcdef')

  const paid = await postPaddle(allowed.base, {
    id: 'txn_01abcdef',
    status: 'completed',
    customer_id: 'ctm_01abcdefgh',
    items: [{ price: { id: 'pri_priceid1' } }],
    custom_data: { product: 'annotated' },
  })
  expect(paid.status).toBe(200)
  const order = await allowed.store.getOrder('txn_01abcdef')
  expect(order.email).toBe('buyer@example.com')
  expect(order.customerId).toBe('ctm_01abcdefgh')
  expect(verifyLicense(order.license, allowed.material.publicKey).ok).toBe(true)

  const buyer = await submitAuth(allowed.base, cookieJar(), 'signup', 'buyer@example.com', 'long-password')
  expect(buyer.html).not.toContain(order.license)
  const page = await fetch(`${allowed.base}/buy`, { headers: { Cookie: buyer.cookies.header() } })
  const html = await page.text()
  expect(html).toContain('pwCustomer: { id: "ctm_01abcdefgh" }')
  expect(html).not.toContain('Paddle.Environment.set')
  expect(html).not.toContain('pdl_live_secretvalue')
  expect(html).not.toContain(order.license)

  const blocked = await boot({
    paddleApiKey: 'pdl_live_secretvalue',
    paddlePriceId: 'pri_priceid1',
    paddleWebhookSecret: 'pdl_ntfset_test',
    fetchImpl: paddleFetch(['203.0.113.5/32']),
  })
  const rejected = await postPaddle(blocked.base, {
    id: 'txn_01abcdef',
    status: 'completed',
    customer_id: 'ctm_01abcdefgh',
    customer: { email: 'buyer@example.com' },
    items: [{ price: { id: 'pri_priceid1' } }],
  })
  expect(rejected.status).toBe(403)
  expect(await blocked.store.getOrder('txn_01abcdef')).toBe(null)

  const hosted = await boot({
    paddleApiKey: 'pdl_live_secretvalue',
    paddlePriceId: 'pri_priceid1',
    fetchImpl: paddleFetch(['127.0.0.1/32']),
  })
  const redirect = await fetch(`${hosted.base}/checkout`, { method: 'POST', redirect: 'manual' })
  expect(redirect.status).toBe(303)
  expect(redirect.headers.get('location')).toBe('https://checkout.paddle.com/pay/txn_01abcdef')
}, 20000)

test('a webhook is not acknowledged when the store is down', async () => {
  const store = createMemoryStore()
  store.ready = false
  const stripe = await boot({ store, webhookSecret: 'whsec_test' })
  const stripeResponse = await postStripe(stripe.base, 'cs_test_order1234', 'buyer@example.com')
  expect(stripeResponse.status).toBe(503)
  expect(await stripeResponse.text()).toBe('retry')
  expect(await store.getOrder('cs_test_order1234')).toBe(null)

  const paddleStore = createMemoryStore()
  paddleStore.ready = false
  const paddle = await boot({
    store: paddleStore,
    paddleApiKey: 'pdl_live_secretvalue',
    paddlePriceId: 'pri_priceid1',
    paddleWebhookSecret: 'pdl_ntfset_test',
    fetchImpl: paddleFetch(['127.0.0.1/32']),
  })
  const paddleResponse = await postPaddle(paddle.base, {
    id: 'txn_01abcdef',
    status: 'completed',
    customer_id: 'ctm_01abcdefgh',
    customer: { email: 'buyer@example.com' },
    items: [{ price: { id: 'pri_priceid1' } }],
  })
  expect(paddleResponse.status).toBe(503)
  expect(await paddleStore.getOrder('txn_01abcdef')).toBe(null)

  const offline = await boot({
    paddleWebhookSecret: 'pdl_ntfset_test',
    fetchImpl: async () => {
      throw new Error('down')
    },
  })
  const unavailable = await postPaddle(offline.base, {
    id: 'txn_01abcdef',
    status: 'completed',
    customer: { email: 'buyer@example.com' },
    items: [{ price: { id: 'pri_priceid1' } }],
  })
  expect(unavailable.status).toBe(503)
}, 20000)

test('account pages stay closed until sign-in is configured', async () => {
  const closed = await boot({ sessionSecret: '' })
  const response = await fetch(`${closed.base}/account`)
  expect(response.status).toBe(503)
  const store = createMemoryStore()
  store.ready = false
  const unready = await boot({ store })
  expect((await fetch(`${unready.base}/account`)).status).toBe(503)
})

function cookieJar() {
  const values = new Map()
  return {
    absorb(response) {
      const listed = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : []
      for (const line of listed) {
        const pair = line.split(';')[0]
        const eq = pair.indexOf('=')
        if (eq < 1) continue
        const name = pair.slice(0, eq).trim()
        if (/Max-Age=0/i.test(line)) values.delete(name)
        else values.set(name, pair.slice(eq + 1).trim())
      }
    },
    header() {
      return [...values.entries()].map(([name, value]) => `${name}=${value}`).join('; ')
    },
    get(name) {
      return values.get(name) || ''
    },
    set(name, value) {
      values.set(name, value)
    },
  }
}

async function boot(extra = {}) {
  const material = keys()
  const store = extra.store || createMemoryStore()
  const mail = extra.mail || []
  const server = createServer({
    publicKey: material.publicKey,
    privateKey: material.privateKey,
    origin: 'http://127.0.0.1',
    sessionSecret: extra.sessionSecret == null ? 'test-session-secret' : extra.sessionSecret,
    priceLabel: '$35',
    webhookSecret: extra.webhookSecret || '',
    paddleApiKey: extra.paddleApiKey || '',
    paddleClientToken: extra.paddleClientToken || '',
    paddlePriceId: extra.paddlePriceId || '',
    paddleWebhookSecret: extra.paddleWebhookSecret || '',
    paddleEnv: extra.paddleEnv || '',
    fetchImpl: extra.fetchImpl,
    sendMail: async (message) => {
      mail.push(message)
      return { ok: true }
    },
    store,
  })
  servers.push(server)
  const base = await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`))
  })
  return { base, store, material, mail }
}

async function submitAuth(base, cookies, mode, email, password) {
  const form = await fetch(`${base}/account/${mode}`, { headers: { Cookie: cookies.header() } })
  cookies.absorb(form)
  const formHtml = await form.text()
  const csrf = formHtml.match(/name="csrf" value="([^"]+)"/)[1]
  const response = await fetch(`${base}/account/${mode}`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: cookies.header(),
    },
    body: new URLSearchParams({ email, password, csrf }),
  })
  cookies.absorb(response)
  if (response.status >= 300 && response.status < 400) {
    const next = await fetch(new URL(response.headers.get('location'), base), {
      headers: { Cookie: cookies.header() },
    })
    cookies.absorb(next)
    return { response: next, html: await next.text(), cookies }
  }
  return { response, html: await response.text(), cookies }
}

function signedStripe(sessionId, email) {
  const raw = JSON.stringify({
    id: 'evt_1',
    type: 'checkout.session.completed',
    data: { object: session(sessionId, email) },
  })
  const timestamp = Math.floor(Date.now() / 1000)
  const digest = crypto.createHmac('sha256', 'whsec_test').update(`${timestamp}.${raw}`).digest('hex')
  return { raw, header: `t=${timestamp},v1=${digest}` }
}

async function postStripe(base, sessionId, email) {
  const signed = signedStripe(sessionId, email)
  return fetch(`${base}/stripe/webhook`, {
    method: 'POST',
    headers: { 'stripe-signature': signed.header },
    body: signed.raw,
  })
}

function paddleFetch(cidrs) {
  return async (url, init) => {
    const target = String(url)
    if (target === 'https://api.paddle.com/ips') return Response.json({ data: { ipv4_cidrs: cidrs } })
    if (target.endsWith('/customers/ctm_01abcdefgh')) return Response.json({ data: { email: 'Buyer@Example.com' } })
    if (target.endsWith('/transactions') && init && init.method === 'POST') {
      return Response.json({
        data: { id: 'txn_01abcdef', checkout: { url: 'https://checkout.paddle.com/pay/txn_01abcdef' } },
      })
    }
    throw new Error(`unexpected fetch ${target}`)
  }
}

function signedPaddle(transaction) {
  const raw = JSON.stringify({ event_type: 'transaction.completed', data: transaction })
  const timestamp = Math.floor(Date.now() / 1000)
  const digest = crypto.createHmac('sha256', 'pdl_ntfset_test').update(`${timestamp}:${raw}`).digest('hex')
  return { raw, header: `ts=${timestamp};h1=${digest}` }
}

async function postPaddle(base, transaction) {
  const signed = signedPaddle(transaction)
  return fetch(`${base}/paddle/webhook`, {
    method: 'POST',
    headers: { 'paddle-signature': signed.header },
    body: signed.raw,
  })
}
