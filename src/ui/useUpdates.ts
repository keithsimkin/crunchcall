import { useCallback, useEffect, useRef, useState } from 'react'
import { appVersion, loadLatest, releasesPage, type UpdateResult } from './updates'

const dismissKey = 'crunchcall.update.dismissed'

export type UpdateController = UpdateResult & {
  check: () => void
  open: () => void
  dismiss: () => void
  showPrompt: boolean
}

export function useUpdates(): UpdateController {
  const [result, setResult] = useState<UpdateResult>({ phase: 'checking', current: appVersion })
  const [dismissed, setDismissed] = useState(readDismissed)
  const ticket = useRef(0)

  const check = useCallback(() => {
    const id = ticket.current + 1
    ticket.current = id
    setResult((current) => ({ phase: 'checking', current: current.current || appVersion }))
    loadLatest(appVersion)
      .then((next) => {
        if (ticket.current !== id) return
        setResult(next)
      })
      .catch(() => {
        if (ticket.current !== id) return
        setResult({ phase: 'error', current: appVersion, message: "Couldn't reach GitHub." })
      })
  }, [])

  useEffect(() => {
    const id = ticket.current + 1
    ticket.current = id
    let cancelled = false
    loadLatest(appVersion)
      .then((next) => {
        if (cancelled || ticket.current !== id) return
        setResult(next)
      })
      .catch(() => {
        if (cancelled || ticket.current !== id) return
        setResult({ phase: 'error', current: appVersion, message: "Couldn't reach GitHub." })
      })
    return () => {
      cancelled = true
    }
  }, [])

  const dismiss = useCallback(() => {
    if (result.phase !== 'available') return
    try {
      localStorage.setItem(dismissKey, result.latest)
    } catch {
      /* private mode keeps the prompt until the page closes */
    }
    setDismissed(result.latest)
  }, [result])

  const open = useCallback(() => {
    openRelease(result.phase === 'available' ? result.url : releasesPage)
  }, [result])

  const showPrompt = result.phase === 'available' && dismissed !== result.latest

  return { ...result, check, open, dismiss, showPrompt }
}

export function openRelease(url: string) {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return
  }
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'github.com') return
  if (!parsed.pathname.startsWith('/keithsimkin/crunchcall')) return
  const href = parsed.toString()
  if (window.crunchcall?.openExternal) {
    void window.crunchcall.openExternal(href)
    return
  }
  window.open(href, '_blank', 'noopener,noreferrer')
}

function readDismissed(): string {
  try {
    return localStorage.getItem(dismissKey) ?? ''
  } catch {
    return ''
  }
}
