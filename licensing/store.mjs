import crypto from 'node:crypto'

const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }
const VERIFY_SECONDS = 24 * 60 * 60

function hashPassword(password) {
  const salt = crypto.randomBytes(16)
  const hash = crypto.scryptSync(password, salt, 32, SCRYPT)
  return `scrypt$${salt.toString('base64url')}$${hash.toString('base64url')}`
}

function verifyPassword(password, stored) {
  const parts = typeof stored === 'string' ? stored.split('$') : []
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false
  let salt
  let expected
  try {
    salt = Buffer.from(parts[1], 'base64url')
    expected = Buffer.from(parts[2], 'base64url')
  } catch {
    return false
  }
  if (salt.length < 16 || expected.length !== 32) return false
  const actual = crypto.scryptSync(password, salt, expected.length, SCRYPT)
  return crypto.timingSafeEqual(actual, expected)
}

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    verifiedAt: user.verifiedAt || null,
  }
}

function orderCopy(record) {
  return {
    email: record.email,
    order: record.order,
    license: record.license,
    claimed: Boolean(record.claimed),
    customerId: record.customerId || '',
    issued: record.issued || 0,
  }
}

export function createMemoryStore() {
  const users = new Map()
  const orders = new Map()

  return {
    ready: true,

    async signUp({ email, password }) {
      if (users.has(email)) return { ok: false, reason: 'exists' }
      const user = {
        id: email,
        email,
        passwordHash: hashPassword(password),
        verifiedAt: null,
        verifyHash: null,
        verifyExp: null,
      }
      users.set(email, user)
      return { ok: true, user: publicUser(user), session: { email, userId: user.id } }
    },

    async signIn({ email, password }) {
      const user = users.get(email)
      if (!user || !verifyPassword(password, user.passwordHash)) return { ok: false, reason: 'credentials' }
      return { ok: true, user: publicUser(user), session: { email, userId: user.id } }
    },

    async userFromSession(session) {
      if (!session || typeof session.email !== 'string') return null
      const user = users.get(session.email)
      return user ? publicUser(user) : null
    },

    async requestConfirm(user) {
      const saved = users.get(user.email)
      if (!saved || saved.verifiedAt) return { ok: true }
      const token = crypto.randomBytes(32).toString('base64url')
      saved.verifyHash = crypto.createHash('sha256').update(token).digest('base64url')
      saved.verifyExp = Math.floor(Date.now() / 1000) + VERIFY_SECONDS
      return { ok: true, token }
    },

    async confirmEmail({ email, token, now }) {
      const saved = users.get(email)
      const hash = token ? crypto.createHash('sha256').update(token).digest('base64url') : ''
      const wanted = Buffer.from(saved && saved.verifyHash ? saved.verifyHash : '')
      const actual = Buffer.from(hash)
      if (!saved || !saved.verifyHash || actual.length !== wanted.length || !crypto.timingSafeEqual(actual, wanted)) {
        return { ok: false }
      }
      if (!saved.verifyExp || saved.verifyExp < now) return { ok: false }
      saved.verifiedAt = now
      saved.verifyHash = null
      saved.verifyExp = null
      return { ok: true }
    },

    async getOrder(id) {
      const record = orders.get(id)
      return record ? orderCopy(record) : null
    },

    async saveOrder(record) {
      orders.set(record.order, orderCopy(record))
    },

    async listOrders(email) {
      return [...orders.values()]
        .filter((record) => record.email === email)
        .map(orderCopy)
        .sort((a, b) => (b.issued || 0) - (a.issued || 0))
    },
  }
}

function fromRow(row) {
  return {
    email: row.email,
    order: row.order_id,
    license: row.license,
    claimed: Boolean(row.claimed),
    customerId: row.customer_id || '',
    issued: Number(row.issued) || 0,
  }
}

function toRow(record) {
  return {
    order_id: record.order,
    email: record.email,
    license: record.license,
    claimed: Boolean(record.claimed),
    customer_id: record.customerId || '',
    issued: record.issued || 0,
  }
}

function authUser(payload) {
  const user = payload && payload.user ? payload.user : payload
  if (!user || typeof user.email !== 'string' || typeof user.id !== 'string') return null
  const confirmed = user.email_confirmed_at || user.confirmed_at || null
  return {
    id: user.id,
    email: user.email.trim().toLowerCase(),
    verifiedAt: confirmed ? Math.floor(Date.parse(confirmed) / 1000) : null,
  }
}

export function createSupabaseStore({ url, anonKey, serviceKey, fetchImpl, emailRedirectTo }) {
  const ready = Boolean(url && anonKey && serviceKey)
  const fetchFn = fetchImpl || fetch
  const root = String(url || '').replace(/\/$/, '')

  async function auth(path, init, key) {
    const response = await fetchFn(`${root}/auth/v1/${path}`, {
      ...init,
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        ...(init && init.headers),
      },
    })
    const payload = await response.json().catch(() => null)
    return { ok: response.ok, status: response.status, payload }
  }

  async function rest(path, init) {
    const response = await fetchFn(`${root}/rest/v1/${path}`, {
      ...init,
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        ...(init && init.headers),
      },
    })
    const payload = await response.json().catch(() => null)
    if (!response.ok) {
      const error = new Error('supabase')
      error.status = response.status
      throw error
    }
    return payload
  }

  return {
    ready,

    async signUp({ email, password }) {
      const result = await auth('signup', {
        method: 'POST',
        body: JSON.stringify({
          email,
          password,
          options: emailRedirectTo ? { emailRedirectTo } : undefined,
        }),
      }, anonKey)
      const message = result.payload && (result.payload.msg || result.payload.message || result.payload.error_description || '')
      if (!result.ok) {
        if (result.status === 422 || /already/i.test(String(message))) return { ok: false, reason: 'exists' }
        return { ok: false, reason: 'signup' }
      }
      const user = authUser(result.payload)
      if (!user) return { ok: false, reason: 'signup' }
      return { ok: true, user, session: { email: user.email, userId: user.id } }
    },

    async signIn({ email, password }) {
      const result = await auth('token?grant_type=password', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      }, anonKey)
      if (!result.ok) return { ok: false, reason: 'credentials' }
      const user = authUser(result.payload)
      if (!user) return { ok: false, reason: 'credentials' }
      return { ok: true, user, session: { email: user.email, userId: user.id } }
    },

    async userFromSession(session) {
      if (!session || typeof session.userId !== 'string' || !session.userId) return null
      const result = await auth(`admin/users/${encodeURIComponent(session.userId)}`, { method: 'GET' }, serviceKey)
      if (!result.ok) return null
      const user = authUser(result.payload)
      if (!user || user.email !== session.email) return null
      return user
    },

    async requestConfirm(user) {
      const result = await auth('resend', {
        method: 'POST',
        body: JSON.stringify({
          type: 'signup',
          email: user.email,
          options: emailRedirectTo ? { emailRedirectTo } : undefined,
        }),
      }, anonKey)
      return { ok: result.ok }
    },

    async confirmEmail() {
      return { ok: false }
    },

    async getOrder(id) {
      const rows = await rest(`license_orders?order_id=eq.${encodeURIComponent(id)}&select=*`)
      return Array.isArray(rows) && rows[0] ? fromRow(rows[0]) : null
    },

    async saveOrder(record) {
      await rest('license_orders?on_conflict=order_id', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(toRow(record)),
      })
    },

    async listOrders(email) {
      const rows = await rest(`license_orders?email=eq.${encodeURIComponent(email)}&select=*&order=issued.desc`)
      return Array.isArray(rows) ? rows.map(fromRow) : []
    },
  }
}
