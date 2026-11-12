export function formatWhen(start: number, end: number, allDay: boolean, now = Date.now()): string {
  if (!allDay && now >= start && now < end) return 'Now'
  const when = new Date(start)
  const today = new Date(now)
  const time = when.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  let day: string | null = null
  if (!sameDay(when, today)) {
    const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1)
    if (sameDay(when, tomorrow)) day = 'Tomorrow'
    else {
      const diff = Math.round(
        (new Date(when.getFullYear(), when.getMonth(), when.getDate()).getTime() -
          new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) /
          86_400_000,
      )
      day =
        diff > 1 && diff < 7
          ? when.toLocaleDateString(undefined, { weekday: 'short' })
          : when.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    }
  }
  if (allDay) return day ?? 'Today'
  if (!day) return time
  return `${day} · ${time}`
}

export function duePhrase(start: number, now = Date.now()): string {
  if (now + 30_000 >= start) return 'Starting now'
  const mins = Math.max(1, Math.round((start - now) / 60_000))
  return mins === 1 ? 'Starts in 1 min' : `Starts in ${mins} min`
}

export function formatSynced(at: number): string {
  return new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}
