import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { generateKeyPairSync } from 'node:crypto'
import { afterEach, expect, test } from 'bun:test'
import { createRequire } from 'node:module'
import { donePage, downloadTarget, fulfillSession, verifyStripeSignature } from './server.mjs'

const require = createRequire(import.meta.url)
const { verifyLicense } = require('../electron/license.cjs')

const NOW = 1_780_000_000
const temps = []

afterEach(() => {
  for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
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
