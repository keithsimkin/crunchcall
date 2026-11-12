import { useEffect, useState, useSyncExternalStore } from 'react'
import { getState, listUpcoming, pickDue, subscribe } from '../features/calendar/store'

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
