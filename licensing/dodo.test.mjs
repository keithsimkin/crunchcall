import crypto from 'node:crypto'
import { expect, test } from 'bun:test'
import { verifyDodoSignature as verifyNode } from './server.mjs'
import {
  dodoCheckoutBody,
  emailFromDodoPayment,
  paymentMatchesProduct,
  planDodoLicense,
  readDodoEvent,
  verifyDodoSignature,
} from './dodo.mjs'

const NOW = 1_780_000_000
const SECRET = `whsec_${Buffer.from('dodo-webhook-secret').toString('base64')}`

function signed(body, secret = SECRET, timestamp = String(NOW)) {
  const id = 'msg_test'
  const raw = secret.startsWith('whsec_') ? secret.slice(6) : secret
  const key = Buffer.from(raw, 'base64')
  const mac = crypto.createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64')
  return { id, timestamp, signature: `v1,${mac}`, body }
}

test('webcrypto accepts the same dodo signature the node verifier accepts', async () => {
  const body = JSON.stringify({ type: 'payment.succeeded', data: { payment_id: 'pay_order1234' } })
  const headers = signed(body)
  const nodeOk = verifyNode(body, headers, SECRET, NOW)
  const webOk = await verifyDodoSignature(body, headers, SECRET, NOW)
  expect(nodeOk).toBe(true)
  expect(webOk).toBe(true)
  const stale = signed(body, SECRET, String(NOW - 400))
  expect(await verifyDodoSignature(body, stale, SECRET, NOW)).toBe(false)
  const event = await readDodoEvent(body, headers, SECRET, NOW)
  expect(event.ok).toBe(true)
  if (event.ok && !event.ignore) expect(event.payment.payment_id).toBe('pay_order1234')
})

test('a dodo account keeps one key and an appsumo key does not block it', () => {
  const owned = { order: 'pay_existing1', license: 'annotated1.old', email: 'buyer@example.com' }
  expect(planDodoLicense({ paymentId: 'pay_existing1', email: owned.email, existingPayment: owned, owned: null })).toEqual({
    action: 'replay',
    record: owned,
  })
  expect(planDodoLicense({ paymentId: 'pay_second12', email: owned.email, existingPayment: null, owned })).toEqual({
    action: 'already',
    record: owned,
  })
  const appsumo = { order: 'appsumo_ANN-TEST-CODE-0001', license: 'annotated1.code', email: owned.email }
  expect(planDodoLicense({ paymentId: 'pay_second12', email: owned.email, existingPayment: null, owned: appsumo })).toMatchObject({
    action: 'issue',
    orderId: 'pay_second12',
    maxDevices: 1,
  })
})

test('checkout metadata carries the signed-in email and user id', () => {
  expect(emailFromDodoPayment({ customer: { email: 'Buyer@Example.com' } })).toBe('buyer@example.com')
  const body = dodoCheckoutBody({
    productId: 'pdt_unlock1',
    email: 'buyer@example.com',
    userId: 'user_1',
    returnUrl: 'https://annotated.click/account',
    cancelUrl: 'https://annotated.click/buy',
  })
  expect(body.customer.email).toBe('buyer@example.com')
  expect(body.metadata).toEqual({ product: 'annotated', email: 'buyer@example.com', user_id: 'user_1' })
  expect(paymentMatchesProduct({ metadata: { product: 'annotated' }, product_cart: [{ product_id: 'pdt_unlock1' }] }, 'pdt_unlock1')).toBe(true)
  expect(paymentMatchesProduct({ metadata: { product: 'other' }, product_cart: [{ product_id: 'pdt_unlock1' }] }, 'pdt_unlock1')).toBe(false)
})
