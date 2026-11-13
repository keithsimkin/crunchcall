import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, test } from 'bun:test'
import {
  FAIL_BACKOFF_SECONDS,
  RECHECK_SECONDS,
  SEAT_DEACTIVATE_NETWORK,
  SEAT_NETWORK,
  SEAT_OFFLINE,
  SEAT_TAKEN,
  claimSeat,
  decorateStatus,
  hashDeviceId,
  installSeed,
  parseWindowsMachineGuid,
  readCache,
  recheckIfDue,
  releaseSeat,
  resetSeatRuntime,
  seatRequired,
  viewSeat,
} from './license-seat.cjs'

const NOW = 1_780_000_000
const ORDER = 'appsumo_ANN-TEST-CODE-0001'
const DEVICE = hashDeviceId('machine-guid-1')
const temps = []

afterEach(() => {
  resetSeatRuntime()
  for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

function dir() {
  const next = fs.mkdtempSync(path.join(os.tmpdir(), 'annotated-seat-'))
  temps.push(next)
  return next
}

function base(order = ORDER, tier = 'unlock') {
  return {
    tier,
    email: 'buyer@example.com',
    order,
    license: 'valid',
    authenticity: 'genuine',
    signer: '',
    detail: '',
  }
}

test('the device hash is stable and is not the raw machine id', () => {
  expect(hashDeviceId('machine-guid-1')).toBe(hashDeviceId('machine-guid-1'))
  expect(hashDeviceId('machine-guid-1')).not.toBe(hashDeviceId('machine-guid-2'))
  expect(hashDeviceId('machine-guid-1')).toMatch(/^[a-f0-9]{64}$/)
  expect(hashDeviceId('machine-guid-1')).not.toContain('machine-guid-1')
  expect(parseWindowsMachineGuid('    MachineGuid    REG_SZ    12345678-90ab-cdef-1234-567890abcdef\r\n')).toBe(
    '12345678-90ab-cdef-1234-567890abcdef',
  )
  const folder = dir()
  expect(installSeed(folder)).toBe(installSeed(folder))
  expect(seatRequired(ORDER)).toBe(true)
  expect(seatRequired('cs_test_order1234')).toBe(false)
})

test('a dodo key stays unlimited and an appsumo key needs a cached seat', () => {
  const folder = dir()
  expect(decorateStatus(base('cs_test_order1234'), { applicable: false, ok: true }).tier).toBe('unlock')
  const missing = viewSeat(folder, ORDER, DEVICE, NOW)
  expect(missing.ok).toBe(false)
  expect(missing.detail).toBe(SEAT_OFFLINE)
  expect(decorateStatus(base(), missing).tier).toBe('free')
  expect(decorateStatus(base(), missing).seatDetail).toContain('Connect once')
})

test('a successful activation stays unlocked when the recheck cannot connect', async () => {
  const folder = dir()
  const fetchImpl = async () => new Response(JSON.stringify({ ok: true, limited: true, maxDevices: 1 }), { status: 200 })
  const claimed = await claimSeat({
    dir: folder,
    token: 'annotated1.key',
    order: ORDER,
    deviceId: DEVICE,
    deviceLabel: 'Desk',
    now: NOW,
    baseUrl: 'https://license.test',
    fetchImpl,
  })
  expect(claimed.ok).toBe(true)
  expect(viewSeat(folder, ORDER, DEVICE, NOW).ok).toBe(true)
  expect(viewSeat(folder, ORDER, DEVICE, NOW + RECHECK_SECONDS).stale).toBe(true)
  const offline = await recheckIfDue({
    dir: folder,
    token: 'annotated1.key',
    order: ORDER,
    deviceId: DEVICE,
    now: NOW + RECHECK_SECONDS,
    baseUrl: 'https://license.test',
    fetchImpl: async () => {
      throw new Error('offline')
    },
  })
  expect(offline.ok).toBe(true)
  expect(readCache(folder).ok).toBe(true)
  expect(decorateStatus(base(), offline).tier).toBe('unlock')
  const blocked = await recheckIfDue({
    dir: folder,
    token: 'annotated1.key',
    order: ORDER,
    deviceId: DEVICE,
    now: NOW + RECHECK_SECONDS + FAIL_BACKOFF_SECONDS,
    baseUrl: 'https://license.test',
    fetchImpl: async () => new Response(JSON.stringify({ ok: false, reason: 'limit_reached' }), { status: 409 }),
  })
  expect(blocked.ok).toBe(false)
  expect(blocked.detail).toBe(SEAT_TAKEN)
  expect(decorateStatus(base(), blocked).tier).toBe('free')
  expect(decorateStatus(base(), blocked).seatDetail).toContain('already active on another PC')
})

test('the first activation does not unlock when the server cannot be reached', async () => {
  const folder = dir()
  const claimed = await claimSeat({
    dir: folder,
    token: 'annotated1.key',
    order: ORDER,
    deviceId: DEVICE,
    now: NOW,
    baseUrl: 'https://license.test',
    fetchImpl: async () => {
      throw new Error('offline')
    },
  })
  expect(claimed.ok).toBe(false)
  expect(claimed.message).toBe(SEAT_NETWORK)
  expect(readCache(folder)).toBeNull()
})

test('deactivate frees the local seat only after the server accepts it', async () => {
  const folder = dir()
  await claimSeat({
    dir: folder,
    token: 'annotated1.key',
    order: ORDER,
    deviceId: DEVICE,
    now: NOW,
    baseUrl: 'https://license.test',
    fetchImpl: async () => new Response(JSON.stringify({ ok: true, limited: true, maxDevices: 1 }), { status: 200 }),
  })
  const offline = await releaseSeat({
    dir: folder,
    token: 'annotated1.key',
    deviceId: DEVICE,
    baseUrl: 'https://license.test',
    fetchImpl: async () => {
      throw new Error('offline')
    },
  })
  expect(offline.ok).toBe(false)
  expect(offline.message).toBe(SEAT_DEACTIVATE_NETWORK)
  expect(readCache(folder).ok).toBe(true)
  const released = await releaseSeat({
    dir: folder,
    token: 'annotated1.key',
    deviceId: DEVICE,
    baseUrl: 'https://license.test',
    fetchImpl: async (url, init) => {
      expect(url).toBe('https://license.test/api/license/deactivate')
      expect(JSON.parse(init.body).deviceId).toBe(DEVICE)
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    },
  })
  expect(released.ok).toBe(true)
  expect(readCache(folder)).toBeNull()
})
