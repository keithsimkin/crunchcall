export const PURCHASE_URL = 'https://annotated.click/buy'
export const REDEEM_URL = 'https://annotated.click/redeem'

export function sitePage(pathname: string): 'buy' | 'account' | 'privacy' | 'terms' | null {
  if (pathname === '/buy') return 'buy'
  if (pathname === '/account' || pathname.startsWith('/account/')) return 'account'
  if (pathname === '/privacy') return 'privacy'
  if (pathname === '/terms') return 'terms'
  return null
}

/** Paid Unlock features (cues, markdown export). Trial counts as unlocked. */
export function isUnlocked(status: { tier?: string } | null | undefined) {
  return status?.tier === 'unlock' || status?.tier === 'trial'
}

/**
 * Soft wall: never block the whole desktop shell. Users can browse and take a tour;
 * paid actions ask for a license via the license sheet instead.
 */
export function needsLicensePrompt(_desktop: boolean, _status: { tier?: string } | null) {
  return false
}

export function shouldAskForLicense(desktop: boolean, status: { tier?: string } | null) {
  if (!desktop || !status) return false
  return !isUnlocked(status)
}
