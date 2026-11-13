import { expect, test } from 'bun:test'
import {
  CAPTURE_SCREENS,
  RECORD_FILES,
  captureDirectory,
  chapterStamp,
  demoLicenseStatus,
  demoRequested,
  demoUserDataPath,
  recordDirectory,
  surfaceHash,
} from './demo-mode.cjs'

test('demo mode is requested by the flag, the env var, or a capture', () => {
  expect(demoRequested(['electron', '.'], {})).toBe(false)
  expect(demoRequested(['electron', '.', '--demo'], {})).toBe(true)
  expect(demoRequested(['electron', '.'], { ANNOTATED_DEMO: '1' })).toBe(true)
  expect(demoRequested(['electron', '.', '--capture', '/tmp/shots'], {})).toBe(true)
  expect(demoRequested(['electron', '.', '--capture=/tmp/shots'], {})).toBe(true)
  expect(demoRequested(['electron', '.', '--record', '/tmp/tour'], {})).toBe(true)
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

test('a recording directory and chapter times stay stable for captions', () => {
  expect(recordDirectory(['electron', '.', '--demo'])).toBe(null)
  expect(recordDirectory(['electron', '.', '--record', 'tour'])).toMatch(/tour$/)
  expect(chapterStamp(1_000, 1_000)).toBe(0)
  expect(chapterStamp(1_000, 8_540)).toBe(7.5)
  expect(RECORD_FILES).toEqual(['walkthrough.webm', 'walkthrough.json', 'overlay.webm', 'overlay.json'])
})
