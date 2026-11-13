import { sendLicenseEmail } from '../../../licensing/mail.mjs'
import {
  dodoApiBase,
  dodoCheckoutBody,
  emailFromDodoPayment,
  paymentMatchesProduct,
  planDodoLicense,
  readDodoEvent,
  validDodoProductId,
} from '../../../licensing/dodo.mjs'
import { issueLicenseToken, normalizeEmail } from '../redeem/sign.mjs'

const ORIGIN = 'https://annotated.click'

function log(event, fields) {
  console.log(JSON.stringify({ event, ...fields }))
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  })
}

function text(body, status = 200) {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  })
}

export function billingPath(url) {
  const path = new URL(url).pathname.replace(/\/+$/, '') || '/'
  const match = path.match(/(?:^|\/)billing(?=\/|$)(.*)$/)
  if (!match) return path
  return match[1] || '/'
}

function bearer(request) {
  const header = request.headers.get('authorization') || ''
  const match = /^Bearer\s+(\S+)/i.exec(header)
  return match ? match[1] : ''
}

function serviceHeaders(serviceKey, extra) {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
    ...(extra || {}),
  }
}

export function createSupabaseBilling({ url, serviceKey, fetchImpl }) {
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
    async userFromToken(token) {
      if (!token) return null
      const response = await fetchFn(`${root}/auth/v1/user`, {
        headers: { apikey: serviceKey, Authorization: `Bearer ${token}` },
      })
      if (!response.ok) return null
      const user = await response.json().catch(() => null)
      const email = normalizeEmail(user && user.email)
      if (!user || typeof user.id !== 'string' || !email) return null
      return { id: user.id, email }
    },
    async getOrder(id) {
      const rows = await rest(`license_orders?order_id=eq.${encodeURIComponent(id)}&select=order_id,email,license,user_id,max_devices,issued`)
      const row = Array.isArray(rows) ? rows[0] : null
      if (!row) return null
      return {
        order: row.order_id,
        email: row.email,
        license: row.license,
        userId: row.user_id || '',
        maxDevices: row.max_devices,
        issued: Number(row.issued) || 0,
      }
    },
    async ownedDodo(email) {
      const rows = await rest(`license_orders?email=eq.${encodeURIComponent(email)}&select=order_id,email,license,user_id,max_devices,issued&order=issued.desc`)
      const list = Array.isArray(rows) ? rows : []
      const row = list.find((item) => item && typeof item.order_id === 'string' && !item.order_id.startsWith('appsumo_'))
      if (!row) return null
      return { order: row.order_id, email: row.email, license: row.license, userId: row.user_id || '', maxDevices: row.max_devices }
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
          customer_id: record.customerId || '',
          issued: record.issued,
          max_devices: 1,
          user_id: record.userId || null,
        }),
      })
      const saved = await this.getOrder(record.order)
      if (!saved) {
        const error = new Error('supabase')
        error.reason = 'unavailable'
        throw error
      }
      return saved
    },
    async account(email) {
      const orders = await rest(`license_orders?email=eq.${encodeURIComponent(email)}&select=order_id,email,license,issued,max_devices&order=issued.desc`)
      const list = Array.isArray(orders) ? orders : []
      const ids = list.map((row) => row.order_id).filter(Boolean)
      let activations = []
      if (ids.length) {
        const filter = ids.map((id) => encodeURIComponent(id)).join(',')
        const rows = await rest(`license_activations?order_id=in.(${filter})&select=order_id,device_id,device_label,activated_at,last_seen_at`)
        activations = Array.isArray(rows) ? rows : []
      }
      return {
        orders: list.map((row) => ({
          order: row.order_id,
          email: row.email,
          license: row.license,
          issued: Number(row.issued) || 0,
          maxDevices: row.max_devices,
        })),
        activations: activations.map((row) => ({
          order: row.order_id,
          deviceId: row.device_id,
          label: row.device_label || '',
          activatedAt: row.activated_at,
          lastSeenAt: row.last_seen_at,
        })),
      }
    },
    async deactivate({ orderId, email, deviceId }) {
      const response = await fetchFn(`${root}/rest/v1/rpc/deactivate_license_device`, {
        method: 'POST',
        headers: serviceHeaders(serviceKey),
        body: JSON.stringify({ p_order_id: orderId, p_email: email, p_device_id: deviceId }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok || !payload || payload.ok !== true) return { ok: false, reason: 'unavailable' }
      return { ok: true }
    },
  }
}

export function createMemoryBilling(seed = []) {
  const orders = new Map(seed.map((row) => [row.order, { ...row }]))
  const activations = []
  return {
    async userFromToken(token) {
      if (token === 'buyer-token') return { id: 'user_1', email: 'buyer@example.com' }
      return null
    },
    async getOrder(id) {
      return orders.get(id) || null
    },
    async ownedDodo(email) {
      for (const row of orders.values()) {
        if (row.email === email && !row.order.startsWith('appsumo_')) return row
      }
      return null
    },
    async saveOrder(record) {
      const existing = orders.get(record.order)
      if (existing) return existing
      const saved = { ...record, maxDevices: 1 }
      orders.set(record.order, saved)
      return saved
    },
    async account(email) {
      const owned = [...orders.values()].filter((row) => row.email === email)
      return {
        orders: owned,
        activations: activations.filter((row) => owned.some((order) => order.order === row.order)),
      }
    },
    async deactivate({ orderId, email, deviceId }) {
      const order = orders.get(orderId)
      if (!order || order.email !== email) return { ok: false, reason: 'unknown' }
      const index = activations.findIndex((row) => row.order === orderId && row.deviceId === deviceId)
      if (index >= 0) activations.splice(index, 1)
      return { ok: true }
    },
    seedActivation(row) {
      activations.push(row)
    },
  }
}

async function readJson(request) {
  const text = await request.text()
  if (text.length > 100_000) return { error: 'invalid' }
  try {
    const value = JSON.parse(text)
    return { value: value && typeof value === 'object' ? value : {} }
  } catch {
    return { error: 'invalid' }
  }
}

export async function handleBilling(request, env, overrides = {}) {
  const path = billingPath(request.url)
  const store = overrides.store || createSupabaseBilling({
    url: env.SUPABASE_URL,
    serviceKey: env.SUPABASE_SERVICE_ROLE_KEY,
    fetchImpl: overrides.fetchImpl,
  })
  const now = overrides.now ? overrides.now() : Math.floor(Date.now() / 1000)
  const fetchImpl = overrides.fetchImpl || fetch

  if (path === '/api/checkout' && request.method === 'POST') {
    const user = await store.userFromToken(bearer(request))
    if (!user) return json({ ok: false, reason: 'auth' }, 401)
    const owned = await store.ownedDodo(user.email)
    if (owned && owned.license) return json({ ok: true, next: 'account' })
    const productId = env.DODO_PAYMENTS_PRODUCT_ID || ''
    const apiKey = env.DODO_PAYMENTS_API_KEY || ''
    if (!apiKey || !validDodoProductId(productId)) return json({ ok: false, reason: 'unavailable' }, 503)
    const response = await fetchImpl(`${dodoApiBase(env.DODO_PAYMENTS_ENV)}/checkouts`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(dodoCheckoutBody({
        productId,
        email: user.email,
        userId: user.id,
        returnUrl: `${ORIGIN}/account`,
        cancelUrl: `${ORIGIN}/buy`,
      })),
    })
    const payload = await response.json().catch(() => null)
    if (!response.ok || !payload || typeof payload.checkout_url !== 'string') {
      log('checkout', { ok: false, reason: 'dodo' })
      return json({ ok: false, reason: 'unavailable' }, 502)
    }
    log('checkout', { ok: true })
    return json({ ok: true, next: 'checkout', url: payload.checkout_url })
  }

  if (path === '/dodo/webhook' && request.method === 'POST') {
    const raw = await request.text()
    const event = await readDodoEvent(raw, {
      id: request.headers.get('webhook-id') || '',
      timestamp: request.headers.get('webhook-timestamp') || '',
      signature: request.headers.get('webhook-signature') || '',
    }, env.DODO_PAYMENTS_WEBHOOK_KEY || '', now)
    if (!event.ok) return text('invalid', 400)
    if (event.ignore || !event.payment) return text('ok')
    const productId = env.DODO_PAYMENTS_PRODUCT_ID || ''
    if (!paymentMatchesProduct(event.payment, productId)) return text('ok')
    const email = emailFromDodoPayment(event.payment)
    const paymentId = typeof event.payment.payment_id === 'string' ? event.payment.payment_id : ''
    if (!email || !paymentId) return text('retry', 500)
    const existing = await store.getOrder(paymentId)
    const owned = existing ? null : await store.ownedDodo(email)
    const plan = planDodoLicense({ paymentId, email, existingPayment: existing, owned })
    if (plan.action !== 'issue') {
      log('webhook', { ok: true, action: plan.action })
      return text('ok')
    }
    const metadata = event.payment.metadata && typeof event.payment.metadata === 'object' ? event.payment.metadata : {}
    const userId = typeof metadata.user_id === 'string' ? metadata.user_id : ''
    const customer = event.payment.customer
    const customerId = customer && typeof customer.customer_id === 'string' ? customer.customer_id : ''
    let license
    try {
      license = await issueLicenseToken(env.ANNOTATED_LICENSE_PRIVATE_KEY, { email, order: paymentId, issued: now })
    } catch {
      log('webhook', { ok: false, reason: 'sign' })
      return text('retry', 500)
    }
    const saved = await store.saveOrder({
      order: paymentId,
      email,
      license,
      userId,
      customerId,
      issued: now,
      maxDevices: 1,
    })
    const mailed = await sendLicenseEmail({ to: email, license: saved.license, env, fetchImpl })
    log('webhook', { ok: true, action: 'issue', mailed: mailed.ok === true })
    return text('ok')
  }

  if (path === '/api/account' && request.method === 'GET') {
    const user = await store.userFromToken(bearer(request))
    if (!user) return json({ ok: false, reason: 'auth' }, 401)
    const account = await store.account(user.email)
    return json({ ok: true, email: user.email, ...account })
  }

  if (path === '/api/account/deactivate' && request.method === 'POST') {
    const user = await store.userFromToken(bearer(request))
    if (!user) return json({ ok: false, reason: 'auth' }, 401)
    const body = await readJson(request)
    const orderId = body.value && typeof body.value.orderId === 'string' ? body.value.orderId : ''
    const deviceId = body.value && typeof body.value.deviceId === 'string' ? body.value.deviceId.trim().toLowerCase() : ''
    if (!orderId || !/^[a-f0-9]{64}$/.test(deviceId)) return json({ ok: false, reason: 'device' }, 400)
    const order = await store.getOrder(orderId)
    if (!order || order.email !== user.email) return json({ ok: false, reason: 'unknown' }, 404)
    const removed = await store.deactivate({ orderId, email: user.email, deviceId })
    if (!removed.ok) return json({ ok: false, reason: 'unavailable' }, 503)
    log('deactivate', { ok: true })
    return json({ ok: true })
  }

  return json({ ok: false, reason: 'not_found' }, 404)
}
