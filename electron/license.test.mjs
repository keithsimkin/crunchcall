import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { generateKeyPairSync } from 'node:crypto'
import { afterEach, expect, test } from 'bun:test'
import {
  clearStored,
  describeAuthenticity,
  explainReason,
  issueLicense,
  publicStatus,
  readAuthenticode,
  readStored,
  verifyLicense,
  writeStored,
} from './license.cjs'

const NOW = 1_780_000_000
const temps = []

afterEach(() => {
  for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

function pair() {
  return generateKeyPairSync('ed25519')
}

function pem(keys) {
  return {
    privateKey: keys.privateKey.export({ type: 'pkcs8', format: 'pem' }),
    publicKey: keys.publicKey.export({ type: 'spki', format: 'pem' }),
  }
}

function tokenFor(keys, fields = {}) {
  const material = pem(keys)
  return {
    ...material,
    token: issueLicense(material.privateKey, {
      email: 'Buyer@Example.com',
      order: 'cs_test_order1234',
      issued: NOW,
      ...fields,
    }),
  }
}

test('a signed license verifies and keeps the email lowercase', () => {
  const issued = tokenFor(pair())
  const result = verifyLicense(issued.token, issued.publicKey, NOW)
  expect(result.ok).toBe(true)
  if (!result.ok) return
  expect(result.email).toBe('buyer@example.com')
  expect(result.order).toBe('cs_test_order1234')
  expect(result.tier).toBe('unlock')
})

test('a changed payload or signature does not verify', () => {
  const issued = tokenFor(pair())
  const other = pem(pair())
  const [prefix, payload, signature] = issued.token.split('.')
  const flipped = `${payload.slice(0, -1)}${payload.endsWith('a') ? 'b' : 'a'}`
  expect(verifyLicense(`${prefix}.${flipped}.${signature}`, issued.publicKey, NOW).ok).toBe(false)
  expect(verifyLicense(`${prefix}.${payload}.${signature.slice(0, -1)}A`, issued.publicKey, NOW).reason).toBe('signature')
  expect(verifyLicense(issued.token, other.publicKey, NOW).reason).toBe('signature')
})

test('extra fields, a future date, and a bad email are rejected', () => {
  const keys = pem(pair())
  expect(() => issueLicense(keys.privateKey, { email: 'not-an-email', order: 'cs_test_order1234', issued: NOW })).toThrow()
  const issued = tokenFor(pair())
  const early = verifyLicense(issued.token, issued.publicKey, NOW - 90000)
  expect(early.ok).toBe(false)
  if (!early.ok) expect(early.reason).toBe('clock')
  expect(explainReason('signature')).toBe('That license was altered.')
})

test('the license file is read back only when the signature still matches', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'annotated-license-'))
  temps.push(dir)
  const issued = tokenFor(pair())
  expect(readStored(dir, issued.publicKey, NOW).reason).toBe('missing')
  const saved = writeStored(dir, issued.token, issued.publicKey, NOW)
  expect(saved.ok).toBe(true)
  expect(readStored(dir, issued.publicKey, NOW).ok).toBe(true)
  fs.writeFileSync(path.join(dir, 'license'), `${issued.token}tampered\n`)
  expect(readStored(dir, issued.publicKey, NOW).ok).toBe(false)
  expect(writeStored(dir, 'annotated1.nope.nope', issued.publicKey, NOW).ok).toBe(false)
  clearStored(dir)
  expect(readStored(dir, issued.publicKey, NOW).reason).toBe('missing')
})

test('a valid license stays free when the installed copy was altered', () => {
  const issued = tokenFor(pair())
  const stored = verifyLicense(issued.token, issued.publicKey, NOW)
  const tampered = describeAuthenticity({ packaged: true, signature: { status: 'HashMismatch', signer: 'CN=annotated' } })
  const status = publicStatus(stored, tampered)
  expect(status.license).toBe('valid')
  expect(status.tier).toBe('free')
  expect(status.authenticity).toBe('tampered')
  const genuine = describeAuthenticity({
    packaged: true,
    signature: { status: 'Valid', signer: 'CN=Annotated, O=Example' },
  })
  expect(publicStatus(stored, genuine)).toMatchObject({ tier: 'unlock', signer: 'Annotated', authenticity: 'genuine' })
  expect(describeAuthenticity({ packaged: false, signature: null }).state).toBe('development')
  expect(describeAuthenticity({ packaged: true, signature: { status: 'NotSigned', signer: '' } }).state).toBe('unsigned')
})

test('the bundled public key matches the local private key', () => {
  const privatePath = path.join(import.meta.dir, '..', 'licensing', 'private.pem')
  if (!fs.existsSync(privatePath)) return
  const token = issueLicense(fs.readFileSync(privatePath, 'utf8'), {
    email: 'owner@annotated.click',
    order: 'cs_test_localkey1',
    issued: NOW,
  })
  const publicKey = fs.readFileSync(path.join(import.meta.dir, 'license-public.pem'), 'utf8')
  expect(verifyLicense(token, publicKey, NOW).ok).toBe(true)
})

test('Windows reports a trusted signature for notepad', async () => {
  if (process.platform !== 'win32') return
  const signature = await readAuthenticode('C:\\Windows\\System32\\notepad.exe')
  expect(signature.status).toBe('Valid')
  expect(signature.signer.length).toBeGreaterThan(3)
  const copy = describeAuthenticity({ packaged: true, signature })
  expect(copy.state).toBe('genuine')
})
