const STORAGE_KEY = 'annotated-auth'
const SUPABASE_URL = 'https://nnanwekmhkxcwxrbhtld.supabase.co'

export type AuthSession = {
  access_token: string
  refresh_token: string
  expires_at: number
}

export function authConfig() {
  const url = (import.meta.env?.VITE_SUPABASE_URL || SUPABASE_URL).replace(/\/$/, '')
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

function sessionFromParams(params: URLSearchParams): AuthSession | null {
  const access = params.get('access_token')
  if (!access) return null
  const expiresIn = Number(params.get('expires_in') || 3600)
  return {
    access_token: access,
    refresh_token: params.get('refresh_token') || '',
    expires_at: Math.floor(Date.now() / 1000) + (Number.isFinite(expiresIn) ? expiresIn : 3600),
  }
}

/** Pick up a magic-link session from the URL hash or query, then clean the address bar. */
export function captureAuthHash(hash = window.location.hash, search = window.location.search) {
  const fromHash = sessionFromParams(new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash))
  const fromQuery = sessionFromParams(new URLSearchParams(search.startsWith('?') ? search.slice(1) : search))
  const session = fromHash || fromQuery
  if (!session) return null
  writeSession(session)
  history.replaceState({}, '', `${window.location.pathname}`)
  return session
}

/** Always send via Resend (branded annotated mail). Never fall back to Supabase Auth mail. */
export async function sendMagicLink(email: string, redirectTo: string) {
  const response = await fetch('/api/auth/magic-link', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, redirectTo }),
  }).catch(() => null)

  if (!response) return { ok: false as const, reason: 'mail' as const }
  const payload = await response.json().catch(() => null)
  if (response.ok && payload && payload.ok === true) return { ok: true as const }
  return { ok: false as const, reason: (payload && payload.reason) || 'mail' }
}

export async function accountRequest(path: string, session: AuthSession, init?: RequestInit) {
  const { anonKey } = authConfig()
  const headers = new Headers(init?.headers)
  headers.set('authorization', `Bearer ${session.access_token}`)
  if (anonKey) headers.set('apikey', anonKey)
  if (init?.body && !headers.has('content-type')) headers.set('content-type', 'application/json')
  const response = await fetch(path, { ...init, headers })
  const payload = await response.json().catch(() => null)
  return { response, payload }
}
