import { expect, test } from 'bun:test'
import {
  CAPTURE_SCREENS,
  captureDirectory,
  demoLicenseStatus,
  demoRequested,
  demoUserDataPath,
  surfaceHash,
} from './demo-mode.cjs'

test('demo mode is requested by the flag, the env var, or a capture', () => {
  expect(demoRequested(['electron', '.'], {})).toBe(false)
  expect(demoRequested(['electron', '.', '--demo'], {})).toBe(true)
  expect(demoRequested(['electron', '.'], { ANNOTATED_DEMO: '1' })).toBe(true)
  expect(demoRequested(['electron', '.', '--capture', '/tmp/shots'], {})).toBe(true)
  expect(demoRequested(['electron', '.', '--capture=/tmp/shots'], {})).toBe(true)
})

test('the demo profile is a separate directory and looks licensed', () => {
  expect(demoUserDataPath('/home/alex/AppData/Roaming')).toBe('/home/alex/AppData/Roaming/annotated-demo')
  const status = demoLicenseStatus()
  expect(status.tier).toBe('unlock')
  expect(status.license).toBe('valid')
  expect(status.email).toContain('@')
  expect(status.email).not.toContain('keith')
})

test('capture writes into the given directory and the screen list is complete', () => {
  expect(captureDirectory(['electron', '.', '--demo'])).toBe(null)
  expect(captureDirectory(['electron', '.', '--capture', 'shots'])).toMatch(/shots$/)
  expect(CAPTURE_SCREENS).toEqual([
    'home',
    'notes',
    'live',
    'dictate',
    'calendar',
    'projects',
    'shortcuts',
    'ask',
    'connect',
    'settings',
  ])
  expect(surfaceHash('app', true)).toBe('app?demo=1')
  expect(surfaceHash('overlay?demo=1', true)).toBe('overlay?demo=1')
  expect(surfaceHash('app', false)).toBe('app')
})
