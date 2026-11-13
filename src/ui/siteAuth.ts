const STORAGE_KEY = 'annotated-auth'

export type AuthSession = {
  access_token: string
  refresh_token: string
  expires_at: number
}

export function authConfig() {
  const url = (import.meta.env?.VITE_SUPABASE_URL || '').replace(/\/$/, '')
  const anonKey = import.meta.env?.VITE_SUPABASE_ANON_KEY || ''
  return { url, anonKey, ready: Boolean(url && anonKey) }
}

export function readSession(): AuthSession | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '')
    if (!parsed || typeof parsed.access_token !== 'string' || !parsed.access_token) return null
    if (typeof parsed.expires_at === 'number' && parsed.expires_at * 1000 < Date.now() + 5000) return null
    return {
      access_token: parsed.access_token,
      refresh_token: typeof parsed.refresh_token === 'string' ? parsed.refresh_token : '',
      expires_at: Number(parsed.expires_at) || 0,
    }
  } catch {
    return null
  }
}

export function writeSession(session: AuthSession) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session))
}

export function clearSession() {
  localStorage.removeItem(STORAGE_KEY)
}

export function captureAuthHash(hash = window.location.hash) {
  const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash)
  const access = params.get('access_token')
  if (!access) return null
  const expiresIn = Number(params.get('expires_in') || 3600)
  const session = {
    access_token: access,
    refresh_token: params.get('refresh_token') || '',
    expires_at: Math.floor(Date.now() / 1000) + (Number.isFinite(expiresIn) ? expiresIn : 3600),
  }
  writeSession(session)
  const next = `${window.location.pathname}${window.location.search}`
  history.replaceState({}, '', next)
  return session
}

export async function sendMagicLink(email: string, redirectTo: string) {
  const { url, anonKey, ready } = authConfig()
  if (!ready) return { ok: false as const, reason: 'config' }
  const response = await fetch(`${url}/auth/v1/otp?redirect_to=${encodeURIComponent(redirectTo)}`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, create_user: true }),
  })
  if (!response.ok) return { ok: false as const, reason: 'mail' }
  return { ok: true as const }
}

export async function accountRequest(path: string, session: AuthSession, init?: RequestInit) {
  const headers = new Headers(init?.headers)
  headers.set('authorization', `Bearer ${session.access_token}`)
  if (init?.body && !headers.has('content-type')) headers.set('content-type', 'application/json')
  const response = await fetch(path, { ...init, headers })
  const payload = await response.json().catch(() => null)
  return { response, payload }
}
