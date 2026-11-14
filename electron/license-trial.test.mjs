import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, test } from 'bun:test'
import {
  decorateStatus,
  ensureTrial,
  isUnlocked,
  readLocal,
  resetTrialRuntime,
  TRIAL_SECONDS,
  viewTrial,
  writeLocal,
} from './license-trial.cjs'

const NOW = 1_780_000_000
const DEVICE = 'ab'.repeat(32)
const temps = []

afterEach(() => {
  resetTrialRuntime()
  for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'annotated-trial-'))
  temps.push(dir)
  return dir
}

test('a seven-day window stays active until it ends', () => {
  const open = viewTrial(NOW, NOW + 3 * 86400)
  expect(open).toMatchObject({ applicable: true, active: true, daysLeft: 4 })
  const closed = viewTrial(NOW, NOW + TRIAL_SECONDS)
  expect(closed.active).toBe(false)
  expect(closed.daysLeft).toBe(0)
})

test('trial unlocks free status but never overrides a paid unlock', () => {
  const free = { tier: 'free', license: 'none' }
  const active = viewTrial(NOW, NOW + 86400)
  expect(decorateStatus(free, active).tier).toBe('trial')
  expect(isUnlocked(decorateStatus(free, active))).toBe(true)
  expect(decorateStatus({ tier: 'unlock', license: 'valid' }, active).tier).toBe('unlock')
  expect(decorateStatus(free, viewTrial(NOW, NOW + TRIAL_SECONDS)).tier).toBe('free')
})

test('a cloud claim is cached so a wipe of other files still matches after sync', async () => {
  const dir = tempDir()
  const startedAt = NOW - 2 * 86400
  const status = await ensureTrial({
    dir,
    deviceId: DEVICE,
    now: NOW,
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          ok: true,
          startedAt,
          endsAt: startedAt + TRIAL_SECONDS,
          active: true,
          daysLeft: 5,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
  })
  expect(status.active).toBe(true)
  expect(readLocal(dir)).toMatchObject({ startedAt, deviceId: DEVICE, synced: true })
})

test('offline first launch starts a provisional trial and keeps it after a later sync of an older start', async () => {
  const dir = tempDir()
  const first = await ensureTrial({
    dir,
    deviceId: DEVICE,
    now: NOW,
    fetchImpl: async () => {
      throw new Error('offline')
    },
  })
  expect(first.active).toBe(true)
  expect(readLocal(dir)?.synced).toBe(false)

  resetTrialRuntime()
  const older = NOW - 4 * 86400
  const synced = await ensureTrial({
    dir,
    deviceId: DEVICE,
    now: NOW,
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          ok: true,
          startedAt: older,
          endsAt: older + TRIAL_SECONDS,
          active: true,
          daysLeft: 3,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
  })
  expect(synced.startedAt).toBe(older)
  expect(readLocal(dir)?.synced).toBe(true)
})

test('writeLocal round-trips', () => {
  const dir = tempDir()
  writeLocal(dir, { startedAt: NOW, deviceId: DEVICE, synced: true })
  expect(readLocal(dir)).toEqual({ startedAt: NOW, deviceId: DEVICE, synced: true })
})
