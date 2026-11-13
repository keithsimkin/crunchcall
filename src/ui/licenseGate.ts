export const PURCHASE_URL = 'https://annotated.click/buy'
export const REDEEM_URL = 'https://annotated.click/redeem'

export function sitePage(pathname: string): 'buy' | 'account' | null {
  if (pathname === '/buy') return 'buy'
  if (pathname === '/account' || pathname.startsWith('/account/')) return 'account'
  return null
}

export function needsLicensePrompt(desktop: boolean, status: { tier?: string } | null) {
  if (!desktop || !status) return false
  return status.tier !== 'unlock'
}
