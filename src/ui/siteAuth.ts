const STORAGE_KEY = 'annotated-auth'
const ERROR_KEY = 'annotated-auth-error'
const SUPABASE_URL = 'https://nnanwekmhkxcwxrbhtld.supabase.co'

export type AuthSession = {
  access_token: string
  refresh_token: string
  expires_at: number
}

export type AuthLinkError = {
  code: string
  message: string
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

function paramsFromUrl(hash = window.location.hash, search = window.location.search) {
  const fromHash = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash)
  const fromQuery = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  return { fromHash, fromQuery }
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

function sessionFromVerifyPayload(payload: Record<string, unknown> | null): AuthSession | null {
  if (!payload || typeof payload.access_token !== 'string' || !payload.access_token) return null
  const expiresIn = Number(payload.expires_in || 3600)
  return {
    access_token: payload.access_token,
    refresh_token: typeof payload.refresh_token === 'string' ? payload.refresh_token : '',
    expires_at: Math.floor(Date.now() / 1000) + (Number.isFinite(expiresIn) ? expiresIn : 3600),
  }
}

function clearAuthParamsFromUrl() {
  history.replaceState({}, '', `${window.location.pathname}`)
}

/** Map Supabase/auth callback codes into a clear message for the form. */
export function friendlyAuthError(code: string, description = ''): string {
  const c = code.toLowerCase()
  const d = description.toLowerCase().replace(/\+/g, ' ')
  if (c.includes('otp_expired') || d.includes('expired')) {
    return 'That sign-in link has expired. Request a new one below.'
  }
  if (
    d.includes('already been used') ||
    d.includes('already used') ||
    d.includes('can only be used once') ||
    c.includes('otp_expired')
  ) {
    return 'That sign-in link was already used. Request a new one below.'
  }
  if (c.includes('otp_disabled') || c.includes('flow_state') || d.includes('invalid') || d.includes('not found')) {
    return 'That sign-in link is invalid. Request a new one below.'
  }
  if (c.includes('access_denied')) {
    return 'Sign-in was denied. Request a new link below.'
  }
  if (description.trim()) {
    return description.replace(/\+/g, ' ').trim()
  }
  return 'Sign-in failed. Request a new link below.'
}

/** Read and clear a pending auth error saved across a redirect to /account. */
export function takeAuthError(): string | null {
  try {
    const message = sessionStorage.getItem(ERROR_KEY)
    if (!message) return null
    sessionStorage.removeItem(ERROR_KEY)
    return message
  } catch {
    return null
  }
}

function stashAuthError(message: string) {
  try {
    sessionStorage.setItem(ERROR_KEY, message)
  } catch {
    /* ignore quota / private mode */
  }
}

/**
 * Pull error= / error_code= / error_description= out of the callback URL,
 * clear the address bar, and return a user-facing message.
 */
export function captureAuthError(hash = window.location.hash, search = window.location.search): AuthLinkError | null {
  const { fromHash, fromQuery } = paramsFromUrl(hash, search)
  const code = fromHash.get('error_code') || fromQuery.get('error_code') || fromHash.get('error') || fromQuery.get('error') || ''
  const description =
    fromHash.get('error_description') || fromQuery.get('error_description') || fromHash.get('error_description') || ''
  if (!code && !description) return null
  const message = friendlyAuthError(code || 'auth_error', description)
  clearAuthParamsFromUrl()
  return { code: code || 'auth_error', message }
}

/** True when the URL has an auth callback (tokens, token_hash, or error). */
export function hasAuthCallback(hash = window.location.hash, search = window.location.search) {
  const { fromHash, fromQuery } = paramsFromUrl(hash, search)
  return Boolean(
    fromHash.get('access_token') ||
      fromQuery.get('access_token') ||
      fromHash.get('token_hash') ||
      fromQuery.get('token_hash') ||
      fromHash.get('error') ||
      fromQuery.get('error') ||
      fromHash.get('error_code') ||
      fromQuery.get('error_code'),
  )
}

/** Pick up a magic-link session from the URL hash or query, then clean the address bar. */
export function captureAuthHash(hash = window.location.hash, search = window.location.search) {
  const { fromHash, fromQuery } = paramsFromUrl(hash, search)
  const session = sessionFromParams(fromHash) || sessionFromParams(fromQuery)
  if (!session) return null
  writeSession(session)
  clearAuthParamsFromUrl()
  return session
}

/**
 * Finish sign-in for links we email ourselves: /account?token_hash=…&type=magiclink.
 * Avoids Supabase verify → Site URL (landing) and stops Gmail prefetch from burning the one-time link.
 */
export async function consumeAuthToken(
  hash = window.location.hash,
  search = window.location.search,
): Promise<{ session: AuthSession | null; error: string | null }> {
  const { fromHash, fromQuery } = paramsFromUrl(hash, search)
  const tokenHash = fromQuery.get('token_hash') || fromHash.get('token_hash')
  if (!tokenHash) return { session: null, error: null }
  const type = fromQuery.get('type') || fromHash.get('type') || 'magiclink'
  clearAuthParamsFromUrl()

  const { url, anonKey } = authConfig()
  if (!url || !anonKey) {
    return { session: null, error: 'Sign-in is not set up on this site yet.' }
  }

  const response = await fetch(`${url}/auth/v1/verify`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ type, token_hash: tokenHash }),
  }).catch(() => null)

  if (!response) {
    return { session: null, error: 'Sign-in could not reach the server. Try again in a moment.' }
  }

  const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null
  if (!response.ok) {
    const code = String(payload?.error_code || payload?.error || 'auth_error')
    const description = String(payload?.msg || payload?.error_description || payload?.message || '')
    return { session: null, error: friendlyAuthError(code, description) }
  }

  const session = sessionFromVerifyPayload(payload)
  if (!session) {
    return { session: null, error: 'Sign-in failed. Request a new link below.' }
  }
  writeSession(session)
  return { session, error: null }
}

/**
 * After a magic link, open the account dashboard unless the callback was for /buy.
 * Failed links (expired / already used) are turned into a clear UI message on /account.
 */
export function routeSignedInUser(pathname = window.location.pathname) {
  const authError = captureAuthError()
  if (authError) {
    stashAuthError(authError.message)
    if (pathname === '/buy' || pathname.startsWith('/buy/')) return null
    if (pathname !== '/account' && !pathname.startsWith('/account/')) {
      window.location.replace('/account')
    }
    return null
  }

  // token_hash links are finished on /account or /buy (async verify). Keep query intact.
  const { fromHash, fromQuery } = paramsFromUrl()
  if (fromHash.get('token_hash') || fromQuery.get('token_hash')) {
    if (pathname === '/buy' || pathname.startsWith('/buy/')) return null
    if (pathname === '/account' || pathname.startsWith('/account/')) return null
    const next = new URL('/account', window.location.origin)
    next.search = window.location.search
    if (window.location.hash) next.hash = window.location.hash
    window.location.replace(`${next.pathname}${next.search}${next.hash}`)
    return null
  }

  const arrived = captureAuthHash()
  const session = arrived || readSession()
  if (!session) return null
  if (pathname === '/buy' || pathname.startsWith('/buy/')) return session
  if (pathname === '/account' || pathname.startsWith('/account/')) return session
  if (pathname === '/privacy' || pathname === '/terms') return session
  window.location.replace('/account')
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
