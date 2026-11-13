import { generateKeyPairSync } from 'node:crypto'
import { expect, test } from 'bun:test'
import { issueLicense, verifyLicense } from '../../../electron/license.cjs'
import { issueLicenseToken, verifyLicenseToken } from './sign.mjs'

const NOW = 1_780_000_000
const FIELDS = { email: 'Buyer@Example.com', order: 'appsumo_ANN-TEST-CODE-0001', issued: NOW }

function pemPair() {
  const keys = generateKeyPairSync('ed25519')
  return {
    privateKey: keys.privateKey.export({ type: 'pkcs8', format: 'pem' }),
    publicKey: keys.publicKey.export({ type: 'spki', format: 'pem' }),
  }
}

test('a token signed in the worker matches the app signer and verifies there', async () => {
  const keys = pemPair()
  const token = await issueLicenseToken(keys.privateKey, FIELDS)
  const nodeToken = issueLicense(keys.privateKey, FIELDS)
  expect(token).toBe(nodeToken)
  const verified = verifyLicense(token, keys.publicKey, NOW)
  expect(verified.ok).toBe(true)
  if (!verified.ok) return
  expect(verified.email).toBe('buyer@example.com')
  expect(verified.order).toBe(FIELDS.order)
  const roundTrip = await verifyLicenseToken(keys.privateKey, nodeToken, NOW)
  expect(roundTrip.ok).toBe(true)
  if (!roundTrip.ok) return
  expect(roundTrip.email).toBe('buyer@example.com')
})

test('the worker verifier rejects a flipped signature', async () => {
  const keys = pemPair()
  const token = await issueLicenseToken(keys.privateKey, FIELDS)
  const [prefix, payload, signature] = token.split('.')
  const flipped = `${signature[0] === 'A' ? 'B' : 'A'}${signature.slice(1)}`
  const verified = await verifyLicenseToken(keys.privateKey, `${prefix}.${payload}.${flipped}`, NOW)
  expect(verified.ok).toBe(false)
  if (!verified.ok) expect(verified.reason).toBe('signature')
  expect(verifyLicense(`${prefix}.${payload}.${flipped}`, keys.publicKey, NOW).reason).toBe('signature')
})
