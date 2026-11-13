import { expect, test } from 'bun:test'
import { normalizeUrl } from './store'
import { parseCalendar } from './ics'

test('a private ics file imports without any oauth client', () => {
  const text = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'BEGIN:VEVENT',
    'UID:standup@example.com',
    'SUMMARY:Standup',
    'DTSTART:20261112T150000Z',
    'DTEND:20261112T153000Z',
    'URL:https://meet.google.com/abc-defg-hij',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:skip@example.com',
    'SUMMARY:Cancelled',
    'STATUS:CANCELLED',
    'DTSTART:20261112T160000Z',
    'DTEND:20261112T170000Z',
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\n')
  const start = Date.parse('2026-11-12T00:00:00Z')
  const events = parseCalendar(text, { start, end: start + 2 * 86_400_000 })
  expect(events.map((event) => event.title)).toEqual(['Standup'])
  expect(events[0]).toMatchObject({
    allDay: false,
    start: Date.parse('2026-11-12T15:00:00Z'),
    end: Date.parse('2026-11-12T15:30:00Z'),
    detail: 'Google Meet',
  })
})

test('webcal links become https links before fetch', () => {
  expect(normalizeUrl('webcal://calendar.example/basic.ics')).toBe('https://calendar.example/basic.ics')
  expect(normalizeUrl('webcals://calendar.example/secret.ics')).toBe('https://calendar.example/secret.ics')
  expect(normalizeUrl('  https://calendar.example/basic.ics  ')).toBe('https://calendar.example/basic.ics')
})
