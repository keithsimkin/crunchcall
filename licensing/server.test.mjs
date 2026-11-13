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
  fulfillDodoPayment,
  verifyDodoSignature,
} from './server.mjs'

const require = createRequire(import.meta.url)
const { verifyLicense } = require('../electron/license.cjs')

const NOW = 1_780_000_000
const DODO_WEBHOOK_SECRET = `whsec_${Buffer.from('dodo-webhook-secret').toString('base64')}`
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

function payment(id, email, status = 'succeeded') {
  return {
    payment_id: id,
    status,
    customer: { customer_id: 'cus_01abcdefgh', email },
    product_cart: [{ product_id: 'pdt_unlock1', quantity: 1 }],
    metadata: { product: 'annotated' },
  }
}

test('a paid checkout issues one license and a later event does not replace it', () => {
  const material = keys()
  const orders = {}
  const first = fulfillDodoPayment(payment('pay_order1234', 'Buyer@Example.com'), 'pdt_unlock1', material.privateKey, orders, NOW)
  const second = fulfillDodoPayment(payment('pay_order1234', 'Buyer@Example.com'), 'pdt_unlock1', material.privateKey, orders, NOW + 10)
  expect(first.ok).toBe(true)
  expect(second.record.license).toBe(first.record.license)
  const verified = verifyLicense(first.record.license, material.publicKey, NOW)
  expect(verified.ok).toBe(true)
  if (verified.ok) expect(verified.email).toBe('buyer@example.com')
  expect(fulfillDodoPayment(payment('pay_order1234', 'Buyer@Example.com', 'processing'), 'pdt_unlock1', material.privateKey, {}, NOW).pending).toBe(true)
  const html = donePage(first.record, false)
  expect(html).toContain(first.record.license)
  expect(html).not.toContain('<script')
})

test('the installer download requires a valid license and an https file', () => {
  const material = keys()
  const orders = {}
  const issued = fulfillDodoPayment(payment('pay_order1234', 'buyer@example.com'), 'pdt_unlock1', material.privateKey, orders, NOW)
  const good = downloadTarget(issued.record.license, material.publicKey, 'https://github.com/keithsimkin/crunchcall/releases/download/v1/annotated.exe', NOW)
  expect(good).toEqual({
    status: 302,
    location: 'https://github.com/keithsimkin/crunchcall/releases/download/v1/annotated.exe',
  })
  expect(downloadTarget('annotated1.bad.sig', material.publicKey, 'https://example.com/app.exe', NOW).status).toBe(403)
  expect(downloadTarget(issued.record.license, material.publicKey, 'http://example.com/app.exe', NOW).status).toBe(503)
})

test('license text is escaped on the receipt page', () => {
  const html = donePage({ license: 'annotated1.<script>.abc', email: 'a@b.c', order: 'pay_order1234' }, false)
  expect(html).toContain('annotated1.&lt;script&gt;.abc')
  expect(html).not.toContain('<script>')
})

test('dodo signatures accept a second v1 and reject a stale or altered body', () => {
  const secret = `whsec_${Buffer.from('dodo-webhook-secret').toString('base64')}`
  const body = '{"type":"payment.succeeded"}'
  const id = 'msg_test1'
  const digest = crypto.createHmac('sha256', Buffer.from('dodo-webhook-secret')).update(`${id}.${NOW}.${body}`).digest('base64')
  const headers = { id, timestamp: String(NOW), signature: `v1,${digest}` }
  expect(verifyDodoSignature(body, headers, secret, NOW)).toBe(true)
  expect(verifyDodoSignature(body, { ...headers, signature: `v1,${Buffer.from('bad').toString('base64')} v1,${digest}` }, secret, NOW)).toBe(true)
  expect(verifyDodoSignature(`${body} `, headers, secret, NOW)).toBe(false)
  expect(verifyDodoSignature(body, headers, secret, NOW + 301)).toBe(false)
  expect(verifyDodoSignature(body, { ...headers, signature: `v1,${digest.slice(0, -1)}0` }, secret, NOW)).toBe(false)
})

test('the buy page posts to checkout when payment is ready', () => {
  const ready = buyPage({ ready: true, priceLabel: '$35' })
  expect(ready).toContain('action="/checkout"')
  expect(ready).toContain('$35')
  expect(ready).toContain('href="/account"')
  expect(ready).not.toContain('paddle')
  expect(buyPage({ ready: false, priceLabel: '$35' })).toContain('Payment is not set up')
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
  const { base, store, material } = await boot({
    dodoProductId: 'pdt_unlock1',
    dodoWebhookSecret: DODO_WEBHOOK_SECRET,
    mail,
  })
  const created = await submitAuth(base, cookieJar(), 'signup', 'new@example.com', 'long-password')
  expect(created.response.status).toBe(200)
  expect(created.html).toContain('No paid license')
  expect(created.html).not.toContain('annotated1.')
  expect(await store.listOrders('new@example.com')).toEqual([])

  const wrong = await submitAuth(base, cookieJar(), 'login', 'new@example.com', 'wrong-password')
  expect(wrong.response.status).toBe(400)
  expect(wrong.html).toContain('Email or password is wrong.')

  const first = await postDodo(base, payment('pay_order1234', 'Buyer@Example.com'))
  expect(first.status).toBe(200)
  const again = await postDodo(base, payment('pay_order1234', 'Buyer@Example.com'))
  expect(again.status).toBe(200)
  const bought = await store.getOrder('pay_order1234')
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

  const payerHook = await postDodo(base, payment('pay_payer1234', 'payer@example.com'))
  expect(payerHook.status).toBe(200)
  const payerOrder = await store.getOrder('pay_payer1234')
  const receipt = cookieJar()
  const done = await fetch(`${base}/buy/done?payment_id=pay_payer1234`)
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

  const pending = await fetch(`${base}/buy/done?payment_id=pay_missing1`)
  expect(pending.status).toBe(200)
  expect(await pending.text()).toContain('still settling')
}, 20000)

test('dodo checkout and webhooks record a paid payment', async () => {
  const live = await boot({
    dodoApiKey: 'dodo_live_secretvalue',
    dodoProductId: 'pdt_unlock1',
    dodoWebhookSecret: DODO_WEBHOOK_SECRET,
    fetchImpl: dodoFetch(),
  })
  const checkout = await fetch(`${live.base}/checkout`, { method: 'POST', redirect: 'manual' })
  expect(checkout.status).toBe(303)
  expect(checkout.headers.get('location')).toBe('https://checkout.dodopayments.com/session/cks_01abcdef')

  const paid = await postDodo(live.base, {
    payment_id: 'pay_01abcdef',
    status: 'succeeded',
    customer: { customer_id: 'cus_01abcdefgh', email: 'Buyer@Example.com' },
    product_cart: [{ product_id: 'pdt_unlock1', quantity: 1 }],
    metadata: { product: 'annotated' },
  })
  expect(paid.status).toBe(200)
  const order = await live.store.getOrder('pay_01abcdef')
  expect(order.email).toBe('buyer@example.com')
  expect(order.customerId).toBe('cus_01abcdefgh')
  expect(verifyLicense(order.license, live.material.publicKey).ok).toBe(true)

  const buyer = await submitAuth(live.base, cookieJar(), 'signup', 'buyer@example.com', 'long-password')
  expect(buyer.html).not.toContain(order.license)
  const page = await fetch(`${live.base}/buy`, { headers: { Cookie: buyer.cookies.header() } })
  const html = await page.text()
  expect(html).toContain('action="/checkout"')
  expect(html).not.toContain('dodo_live_secretvalue')
  expect(html).not.toContain(order.license)

  const material = keys()
  const issued = fulfillDodoPayment({
    payment_id: 'pay_pending1',
    status: 'processing',
    customer: { customer_id: 'cus_01abcdefgh', email: 'buyer@example.com' },
    product_cart: [{ product_id: 'pdt_unlock1', quantity: 1 }],
  }, 'pdt_unlock1', material.privateKey, {}, NOW)
  expect(issued.pending).toBe(true)

  const testMode = await boot({
    dodoApiKey: 'dodo_test_secretvalue',
    dodoProductId: 'pdt_unlock1',
    dodoEnv: 'test',
    fetchImpl: dodoFetch({ test: true }),
  })
  const redirect = await fetch(`${testMode.base}/checkout`, { method: 'POST', redirect: 'manual' })
  expect(redirect.status).toBe(303)
  expect(redirect.headers.get('location')).toBe('https://test.checkout.dodopayments.com/session/cks_01abcdef')
}, 20000)

test('a webhook is not acknowledged when the store is down', async () => {
  const dodoStore = createMemoryStore()
  dodoStore.ready = false
  const dodo = await boot({
    store: dodoStore,
    dodoApiKey: 'dodo_live_secretvalue',
    dodoProductId: 'pdt_unlock1',
    dodoWebhookSecret: DODO_WEBHOOK_SECRET,
  })
  const dodoResponse = await postDodo(dodo.base, payment('pay_01abcdef', 'buyer@example.com'))
  expect(dodoResponse.status).toBe(503)
  expect(await dodoStore.getOrder('pay_01abcdef')).toBe(null)
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
    dodoApiKey: extra.dodoApiKey || '',
    dodoProductId: extra.dodoProductId || '',
    dodoWebhookSecret: extra.dodoWebhookSecret || '',
    dodoEnv: extra.dodoEnv || '',
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

function dodoFetch(options = {}) {
  return async (url, init) => {
    const target = String(url)
    const test = Boolean(options.test)
    const apiHost = test ? 'https://test.dodopayments.com' : 'https://live.dodopayments.com'
    const checkoutHost = test ? 'https://test.checkout.dodopayments.com' : 'https://checkout.dodopayments.com'
    if (target === `${apiHost}/checkouts` && init && init.method === 'POST') {
      return Response.json({
        session_id: 'cks_01abcdef',
        checkout_url: `${checkoutHost}/session/cks_01abcdef`,
      })
    }
    if (target === `${apiHost}/payments/pay_01abcdef`) {
      return Response.json({
        payment_id: 'pay_01abcdef',
        status: 'succeeded',
        customer: { customer_id: 'cus_01abcdefgh', email: 'Buyer@Example.com' },
        product_cart: [{ product_id: 'pdt_unlock1', quantity: 1 }],
        metadata: { product: 'annotated' },
      })
    }
    throw new Error(`unexpected fetch ${target}`)
  }
}

function signedDodo(payment) {
  const raw = JSON.stringify({ type: 'payment.succeeded', data: payment })
  const id = 'msg_test1'
  const timestamp = String(Math.floor(Date.now() / 1000))
  const digest = crypto.createHmac('sha256', Buffer.from('dodo-webhook-secret')).update(`${id}.${timestamp}.${raw}`).digest('base64')
  return {
    raw,
    headers: {
      'webhook-id': id,
      'webhook-timestamp': timestamp,
      'webhook-signature': `v1,${digest}`,
    },
  }
}

async function postDodo(base, payment) {
  const signed = signedDodo(payment)
  return fetch(`${base}/dodo/webhook`, {
    method: 'POST',
    headers: signed.headers,
    body: signed.raw,
  })
}
