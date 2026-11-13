import { useEffect, useState, useSyncExternalStore } from 'react'
import { getState, listUpcoming, pickDue, readCalendarSignIn, subscribe, type CalendarSignIn } from '../features/calendar/store'

export function useCalendarClock() {
  const calendar = useSyncExternalStore(subscribe, getState, getState)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const tick = () => setNow(Date.now())
    const id = window.setInterval(tick, 10_000)
    window.addEventListener('focus', tick)
    return () => {
      window.clearInterval(id)
      window.removeEventListener('focus', tick)
    }
  }, [])

  return {
    calendar,
    now,
    upcoming: calendar.enabled ? listUpcoming(calendar.events, now) : [],
    due: calendar.enabled && calendar.askToStart ? pickDue(calendar.events, now, calendar.dismissed) : null,
  }
}

export function useCalendarSignIn() {
  const desktop = typeof window !== 'undefined' && Boolean(window.crunchcall?.calendarSignIn)
  const [signIn, setSignIn] = useState<CalendarSignIn | null>(null)

  useEffect(() => {
    if (!desktop) return
    let live = true
    void readCalendarSignIn().then((next) => {
      if (live) setSignIn(next)
    })
    return () => {
      live = false
    }
  }, [desktop])

  return { desktop, signIn }
}
