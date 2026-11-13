import { normalizeEmail, normalizeIssued } from './sign.mjs'

const CODE_PATTERN = /^[A-Za-z0-9_-]{3,120}$/

export function normalizeCode(value) {
  if (typeof value !== 'string') return ''
  const code = value.trim().toUpperCase()
  if (!CODE_PATTERN.test(code)) return ''
  return code
}

export function orderIdForCode(code) {
  const order = `appsumo_${code}`
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(order)) return ''
  return order
}

export async function redeemCode(db, input) {
  const email = normalizeEmail(input && input.email)
  const code = normalizeCode(input && input.code)
  if (!email || !code) return { ok: false, reason: 'invalid', status: 400 }
  const order = orderIdForCode(code)
  const issued = normalizeIssued(input && input.issued)
  const license = input && typeof input.license === 'string' ? input.license : ''
  if (!order || issued == null || !license.startsWith('annotated1.')) return { ok: false, reason: 'invalid', status: 400 }

  const claim = await db.tryClaim({ code, email })
  if (!claim || claim.status === 'missing') return { ok: false, reason: 'unknown', status: 400 }
  if (claim.status === 'taken' && claim.email && claim.email !== email) {
    return { ok: false, reason: 'email_mismatch', status: 409 }
  }
  if (claim.status === 'taken') {
    const existing = await db.getOrder(order)
    if (existing && existing.license) {
      return { ok: true, license: existing.license, order, email, replay: true, status: 200 }
    }
  }
  const saved = await db.saveOrder({ order, email, license, issued, maxDevices: 1 })
  await db.linkCode({ code, order })
  return {
    ok: true,
    license: saved.license,
    order,
    email,
    replay: saved.license !== license,
    status: 200,
  }
}

export function createMemoryCodes(seed = []) {
  const codes = new Map()
  const orders = new Map()
  for (const code of seed) {
    const normalized = normalizeCode(code)
    if (normalized) codes.set(normalized, { code: normalized, email: '', redeemedAt: null, order: '' })
  }
  return {
    async tryClaim({ code, email }) {
      const row = codes.get(code)
      if (!row) return { status: 'missing' }
      if (row.redeemedAt) return { status: 'taken', email: row.email }
      row.redeemedAt = new Date().toISOString()
      row.email = email
      return { status: 'claimed', email }
    },
    async getOrder(order) {
      return orders.get(order) || null
    },
    async saveOrder(record) {
      const existing = orders.get(record.order)
      if (existing) return existing
      const saved = {
        order: record.order,
        email: record.email,
        license: record.license,
        maxDevices: 1,
        issued: record.issued,
      }
      orders.set(record.order, saved)
      const row = codes.get(record.order.slice('appsumo_'.length))
      if (row) row.order = record.order
      return saved
    },
    async linkCode({ code, order }) {
      const row = codes.get(code)
      if (row) row.order = order
    },
  }
}

function serviceHeaders(serviceKey, extra) {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
    ...(extra || {}),
  }
}

export function createSupabaseCodes({ url, serviceKey, fetchImpl }) {
  const root = String(url || '').replace(/\/$/, '')
  const fetchFn = fetchImpl || fetch

  async function rest(path, init) {
    const response = await fetchFn(`${root}/rest/v1/${path}`, {
      method: init && init.method ? init.method : 'GET',
      body: init && init.body,
      headers: serviceHeaders(serviceKey, init && init.headers),
    })
    const payload = await response.json().catch(() => null)
    if (!response.ok) {
      const error = new Error('supabase')
      error.reason = 'unavailable'
      throw error
    }
    return payload
  }

  return {
    async tryClaim({ code, email }) {
      const claimed = await rest(`appsumo_codes?code=eq.${encodeURIComponent(code)}&redeemed_at=is.null`, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ redeemed_at: new Date().toISOString(), email }),
      })
      if (Array.isArray(claimed) && claimed[0]) return { status: 'claimed', email }
      const existing = await rest(`appsumo_codes?code=eq.${encodeURIComponent(code)}&select=code,email,redeemed_at`)
      if (!Array.isArray(existing) || !existing[0]) return { status: 'missing' }
      return { status: 'taken', email: String(existing[0].email || '').trim().toLowerCase() }
    },
    async getOrder(order) {
      const rows = await rest(
        `license_orders?order_id=eq.${encodeURIComponent(order)}&select=order_id,email,license,max_devices,issued`,
      )
      const row = Array.isArray(rows) ? rows[0] : null
      if (!row) return null
      return {
        order: row.order_id,
        email: row.email,
        license: row.license,
        maxDevices: row.max_devices,
        issued: row.issued,
      }
    },
    async saveOrder(record) {
      await rest('license_orders?on_conflict=order_id', {
        method: 'POST',
        headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
        body: JSON.stringify({
          order_id: record.order,
          email: record.email,
          license: record.license,
          claimed: true,
          customer_id: '',
          issued: record.issued,
          max_devices: 1,
        }),
      })
      const saved = await this.getOrder(record.order)
      if (!saved || !saved.license) {
        const error = new Error('supabase')
        error.reason = 'unavailable'
        throw error
      }
      return saved
    },
    async linkCode({ code, order }) {
      await rest(`appsumo_codes?code=eq.${encodeURIComponent(code)}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ license_order_id: order }),
      })
    },
  }
}
