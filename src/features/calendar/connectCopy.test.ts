import { expect, test } from 'bun:test'
import {
  accountConnectCopy,
  calendarEmptyHint,
  calendarIntro,
  calendarLinkHelp,
  meetingsCalendarEmpty,
} from './connectCopy'
import type { CalendarSignIn } from './store'

const googleOnly: CalendarSignIn = {
  configured: { google: true, microsoft: false },
  connected: { google: null, microsoft: null },
}

const neither: CalendarSignIn = {
  configured: { google: false, microsoft: false },
  connected: { google: null, microsoft: null },
}

test('outlook connect stays hidden while microsoft is not configured', () => {
  const copy = accountConnectCopy(googleOnly)
  expect(copy.showGoogle).toBe(true)
  expect(copy.showMicrosoft).toBe(false)
  expect(copy.title).toBe('Google')
  expect(copy.help.toLowerCase()).not.toContain('outlook')
  expect(copy.help.toLowerCase()).not.toContain('not set up')
  expect(calendarIntro(true, googleOnly)).not.toContain('Sign in with Google or Outlook')
  expect(calendarEmptyHint(true, googleOnly)).toBe('Connect Google, or add a calendar link.')
  expect(meetingsCalendarEmpty(true, googleOnly)).toBe('Connect Google under Calendar, or add a private link.')
})

test('a copy with no oauth client still offers a private calendar link', () => {
  const copy = accountConnectCopy(neither)
  expect(copy.showGoogle).toBe(false)
  expect(copy.showMicrosoft).toBe(false)
  expect(copy.help).toBe('Sign-in is not set up in this copy yet. A private calendar link still works.')
  expect(copy.help.toLowerCase()).not.toContain('outlook')
  expect(calendarIntro(true, neither)).toContain('import an .ics file')
  expect(calendarLinkHelp(false)).toContain('import an .ics file')
  expect(calendarEmptyHint(false, null)).toBe('Add a calendar link, or import an .ics file.')
})

test('both providers stay available when both client ids are configured', () => {
  const copy = accountConnectCopy({
    configured: { google: true, microsoft: true },
    connected: { google: null, microsoft: null },
  })
  expect(copy.showGoogle).toBe(true)
  expect(copy.showMicrosoft).toBe(true)
  expect(copy.title).toBe('Google or Outlook')
})
