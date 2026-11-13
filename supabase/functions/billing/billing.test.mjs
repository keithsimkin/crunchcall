import crypto from 'node:crypto'
import { generateKeyPairSync } from 'node:crypto'
import { expect, test } from 'bun:test'
import { verifyLicense } from '../../../electron/license.cjs'
import { createMemoryBilling, handleBilling } from './worker.mjs'

const NOW = 1_780_000_000
const SECRET = `whsec_${Buffer.from('dodo-webhook-secret').toString('base64')}`

function keys() {
  const pair = generateKeyPairSync('ed25519')
  return {
    privateKey: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }),
    publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }),
  }
}

function env(material) {
  return {
    ANNOTATED_LICENSE_PRIVATE_KEY: material.privateKey,
    DODO_PAYMENTS_API_KEY: 'dodo_test_key',
    DODO_PAYMENTS_PRODUCT_ID: 'pdt_unlock1',
    DODO_PAYMENTS_WEBHOOK_KEY: SECRET,
    DODO_PAYMENTS_ENV: 'test',
    RESEND_API_KEY: '',
    ANNOTATED_MAIL_FROM: '',
  }
}

function sign(body) {
  const id = 'msg_bill'
  const raw = Buffer.from('dodo-webhook-secret')
  const mac = crypto.createHmac('sha256', raw).update(`${id}.${NOW}.${body}`).digest('base64')
  return { 'webhook-id': id, 'webhook-timestamp': String(NOW), 'webhook-signature': `v1,${mac}` }
}

function payment(id, email, userId = 'user_1') {
  return {
    payment_id: id,
    status: 'succeeded',
    customer: { customer_id: 'cus_01abcdefgh', email },
    product_cart: [{ product_id: 'pdt_unlock1', quantity: 1 }],
    metadata: { product: 'annotated', email, user_id: userId },
  }
}

test('checkout sends the signed-in buyer to dodo once, then to the account', async () => {
  const material = keys()
  const store = createMemoryBilling()
  let checkout
  const fetchImpl = async (url, init) => {
    checkout = { url, body: JSON.parse(init.body) }
    return Response.json({ checkout_url: 'https://test.checkout.dodopayments.com/session/cks_1' })
  }
  const first = await handleBilling(
    new Request('https://nnanwekmhkxcwxrbhtld.supabase.co/functions/v1/billing/api/checkout', {
      method: 'POST',
      headers: { authorization: 'Bearer buyer-token' },
    }),
    env(material),
    { store, fetchImpl, now: () => NOW },
  )
  expect(await first.json()).toEqual({ ok: true, next: 'checkout', url: 'https://test.checkout.dodopayments.com/session/cks_1' })
  expect(checkout.body.customer.email).toBe('buyer@example.com')
  expect(checkout.body.metadata.user_id).toBe('user_1')
  expect(JSON.stringify(checkout.body)).not.toContain('dodo_test_key')

  const body = JSON.stringify({ type: 'payment.succeeded', data: payment('pay_order1234', 'buyer@example.com') })
  const headers = sign(body)
  const mailed = []
  const hooked = await handleBilling(
    new Request('https://nnanwekmhkxcwxrbhtld.supabase.co/functions/v1/billing/dodo/webhook', {
      method: 'POST',
      headers,
      body,
    }),
    env(material),
    {
      store,
      now: () => NOW,
      fetchImpl: async (url, init) => {
        mailed.push(JSON.parse(init.body))
        return new Response('{}', { status: 200 })
      },
    },
  )
  expect(await hooked.text()).toBe('ok')
  const saved = await store.getOrder('pay_order1234')
  expect(saved.maxDevices).toBe(1)
  expect(saved.userId).toBe('user_1')
  expect(verifyLicense(saved.license, material.publicKey, NOW).ok).toBe(true)
  expect(mailed).toEqual([])

  const again = JSON.stringify({ type: 'payment.succeeded', data: payment('pay_second123', 'buyer@example.com') })
  const second = await handleBilling(
    new Request('https://project.supabase.co/functions/v1/billing/dodo/webhook', {
      method: 'POST',
      headers: sign(again),
      body: again,
    }),
    env(material),
    { store, now: () => NOW },
  )
  expect(second.status).toBe(200)
  expect(await store.getOrder('pay_second123')).toBeNull()

  const next = await handleBilling(
    new Request('https://annotated.click/api/checkout', {
      method: 'POST',
      headers: { authorization: 'Bearer buyer-token' },
    }),
    env(material),
    { store, fetchImpl, now: () => NOW },
  )
  expect(await next.json()).toEqual({ ok: true, next: 'account' })
})

test('an appsumo key stays on the account beside one dodo key', async () => {
  const material = keys()
  const store = createMemoryBilling([
    { order: 'appsumo_ANN-TEST-CODE-0001', email: 'buyer@example.com', license: 'annotated1.code', maxDevices: 1 },
  ])
  const body = JSON.stringify({ type: 'payment.succeeded', data: payment('pay_order1234', 'buyer@example.com') })
  const response = await handleBilling(
    new Request('https://project.supabase.co/functions/v1/billing/dodo/webhook', {
      method: 'POST',
      headers: sign(body),
      body,
    }),
    env(material),
    { store, now: () => NOW },
  )
  expect(response.status).toBe(200)
  const account = await handleBilling(
    new Request('https://annotated.click/api/account', { headers: { authorization: 'Bearer buyer-token' } }),
    env(material),
    { store, now: () => NOW },
  )
  const payload = await account.json()
  expect(payload.orders.map((row) => row.order).sort()).toEqual(['appsumo_ANN-TEST-CODE-0001', 'pay_order1234'])
})

test('the account can free a seat on its own key only', async () => {
  const material = keys()
  const store = createMemoryBilling([
    { order: 'pay_order1234', email: 'buyer@example.com', license: 'annotated1.key', maxDevices: 1 },
  ])
  store.seedActivation({ order: 'pay_order1234', deviceId: 'ab'.repeat(32), label: 'Desk' })
  const denied = await handleBilling(
    new Request('https://annotated.click/api/account/deactivate', {
      method: 'POST',
      headers: { authorization: 'Bearer buyer-token', 'content-type': 'application/json' },
      body: JSON.stringify({ orderId: 'pay_other123', deviceId: 'ab'.repeat(32) }),
    }),
    env(material),
    { store, now: () => NOW },
  )
  expect(denied.status).toBe(404)
  const removed = await handleBilling(
    new Request('https://annotated.click/api/account/deactivate', {
      method: 'POST',
      headers: { authorization: 'Bearer buyer-token', 'content-type': 'application/json' },
      body: JSON.stringify({ orderId: 'pay_order1234', deviceId: 'ab'.repeat(32) }),
    }),
    env(material),
    { store, now: () => NOW },
  )
  expect(await removed.json()).toEqual({ ok: true })
  expect((await store.account('buyer@example.com')).activations).toEqual([])
})
