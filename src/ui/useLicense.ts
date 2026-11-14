import { useCallback, useEffect, useState } from 'react'
import type { LicenseStatus } from '../desktop'
import { isUnlocked, shouldAskForLicense } from './licenseGate'

export const SITE_URL = 'https://annotated.click'
export const BUY_URL = 'https://annotated.click/buy'
export const ACCOUNT_URL = 'https://annotated.click/account'

export function useLicense() {
  const desktop = typeof window !== 'undefined' && Boolean(window.crunchcall?.licenseStatus)
  const [status, setStatus] = useState<LicenseStatus | null>(null)

  const refresh = useCallback(async () => {
    const read = window.crunchcall?.licenseStatus
    if (!read) return null
    const next = await read()
    setStatus(next)
    return next
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return {
    desktop,
    status,
    unlocked: !desktop || isUnlocked(status),
    needsKey: shouldAskForLicense(desktop, status),
    refresh,
  }
}

export type LicenseDesk = ReturnType<typeof useLicense>
