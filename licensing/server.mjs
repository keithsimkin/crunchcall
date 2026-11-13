import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { createSupabaseStore } from './store.mjs'

const require = createRequire(import.meta.url)
const license = require('../electron/license.cjs')

const root = path.dirname(fileURLToPath(import.meta.url))
const BUY_PATH = '/buy'
const DONE_PATH = '/buy/done'
const CHECKOUT_PATH = '/checkout'
const DODO_WEBHOOK_PATH = '/dodo/webhook'
const DOWNLOAD_PATH = '/download'
const SESSION_SECONDS = 30 * 24 * 60 * 60
const RECEIPT_SECONDS = 14 * 24 * 60 * 60

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function page(title, body) {
  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<body style="margin:0;background:#f5f5f3;color:#1c1c19;font:16px/1.5 system-ui,sans-serif">
<main style="max-width:36rem;margin:0 auto;padding:48px 20px">
<h1 style="font-size:1.6rem;font-weight:600;letter-spacing:-0.03em">${escapeHtml(title)}</h1>
${body}
</main>
</body>
</html>`
}

function buyPage({ ready, priceLabel }) {
  const price = priceLabel
    ? `<p>Unlock is ${escapeHtml(priceLabel)}, once. Local notes stay free.</p>`
    : '<p>Unlock is a one-time payment. Local notes stay free.</p>'
  const action = ready
    ? '<form method="post" action="/checkout"><button type="submit" style="font:inherit;font-weight:600;padding:10px 16px;border-radius:999px;border:0;background:#1c1c19;color:#f5f5f3">Continue to payment</button></form>'
    : '<p>Payment is not set up on this server yet.</p>'
  return page(
    'Buy annotated Unlock',
    `${price}
<p>After payment you get a license and the signed installer. Windows checks the installer signature when you open it. annotated checks the license on this PC, offline.</p>
${action}
<p><a href="/account">Your licenses</a></p>`,
  )
}

function donePage(record, pending, extra = '') {
  if (pending || !record) {
    return page('Payment is still settling', '<p>Refresh this page in a moment. The license shows up here after the payment clears.</p>')
  }
  const download = `/download?license=${encodeURIComponent(record.license)}`
  return page(
    'Your unlock is ready',
    `<p>Paste this license into annotated, under Settings, then License. It is checked on this PC.</p>
<textarea readonly rows="5" style="width:100%;font:12px/1.4 ui-monospace,Consolas,monospace;padding:10px;border:1px solid #d9d9d3;border-radius:8px">${escapeHtml(record.license)}</textarea>
<p><a href="${download}">Download the signed installer</a></p>
<p>The download link only works with this license. Windows checks the signature before the installer runs.</p>
${extra}`,
  )
}

function fulfillPurchase(purchase, privateKeyPem, orders, now) {
  if (!purchase || purchase.product !== license.PRODUCT) return { ok: false, reason: 'product' }
  const id = typeof purchase.id === 'string' ? purchase.id : ''
  if (!id) return { ok: false, reason: 'session' }
  if (orders[id] && orders[id].license) return { ok: true, record: orders[id] }
  const email = typeof purchase.email === 'string' ? purchase.email : ''
  const issued = Math.floor(Number(now) || Date.now() / 1000)
  let token
  try {
    token = license.issueLicense(privateKeyPem, { email, order: id, issued })
  } catch {
    return { ok: false, reason: 'email' }
  }
  const record = {
    email: email.trim().toLowerCase(),
    order: id,
    license: token,
    claimed: false,
    customerId: typeof purchase.customerId === 'string' ? purchase.customerId : '',
    issued,
  }
  orders[id] = record
  return { ok: true, record }
}

function downloadTarget(token, publicKeyPem, installerUrl, now) {
  const verified = license.verifyLicense(token, publicKeyPem, now)
  if (!verified.ok) return { status: 403, body: 'This download needs a valid unlock license.' }
  let url
  try {
    url = new URL(installerUrl)
  } catch {
    return { status: 503, body: 'The signed installer is not published yet.' }
  }
  if (url.protocol !== 'https:') return { status: 503, body: 'The signed installer is not published yet.' }
  return { status: 302, location: url.toString() }
}

function readBody(req, limit = 1_000_000) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(Object.assign(new Error('too large'), { code: 'LIMIT' }))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function accountEmail(value) {
  if (typeof value !== 'string') return ''
  const email = value.trim().toLowerCase()
  if (email.length < 3 || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return ''
  return email
}

function seal(payload, secret) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url')
  return `${body}.${sig}`
}

function openSeal(token, secret) {
  if (typeof token !== 'string' || typeof secret !== 'string' || !secret) return null
  const dot = token.lastIndexOf('.')
  if (dot < 1) return null
  const body = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url')
  const actual = Buffer.from(sig)
  const wanted = Buffer.from(expected)
  if (actual.length !== wanted.length || !crypto.timingSafeEqual(actual, wanted)) return null
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
  } catch {
    return null
  }
}

function readCookies(req) {
  const header = req.headers.cookie
  const out = {}
  if (!header || Array.isArray(header)) return out
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    const key = part.slice(0, eq).trim()
    if (!key) continue
    try {
      out[key] = decodeURIComponent(part.slice(eq + 1).trim())
    } catch {
      out[key] = ''
    }
  }
  return out
}

function cookieHeader(name, value, { maxAge, origin, clear }) {
  const parts = [`${name}=${clear ? '' : encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${clear ? 0 : maxAge}`]
  if (String(origin || '').startsWith('https://')) parts.push('Secure')
  return parts.join('; ')
}

function csrfCookie(secret) {
  const token = crypto.randomBytes(32).toString('base64url')
  const sig = crypto.createHmac('sha256', secret).update(`csrf.${token}`).digest('base64url')
  return `${token}.${sig}`
}

function csrfOk(cookie, field, secret) {
  if (typeof cookie !== 'string' || typeof field !== 'string' || !secret || cookie !== field) return false
  const dot = cookie.indexOf('.')
  if (dot < 1) return false
  const token = cookie.slice(0, dot)
  const sig = cookie.slice(dot + 1)
  const expected = crypto.createHmac('sha256', secret).update(`csrf.${token}`).digest('base64url')
  const actual = Buffer.from(sig)
  const wanted = Buffer.from(expected)
  return actual.length === wanted.length && crypto.timingSafeEqual(actual, wanted)
}

function readUserSession(token, secret, now) {
  const payload = openSeal(token, secret)
  if (!payload || typeof payload.email !== 'string' || typeof payload.exp !== 'number') return null
  if (payload.exp < now) return null
  return payload
}

function receiptIds(token, secret, now) {
  const payload = openSeal(token, secret)
  if (!payload || !Array.isArray(payload.ids) || typeof payload.exp !== 'number' || payload.exp < now) return []
  return payload.ids.filter((id) => typeof id === 'string')
}

function rememberReceipt(token, secret, orderId, now) {
  const ids = receiptIds(token, secret, now)
  if (!ids.includes(orderId)) ids.push(orderId)
  return seal({ ids: ids.slice(-20), exp: now + RECEIPT_SECONDS }, secret)
}

function allowAttempt(attempts, ip, nowMs) {
  const recent = (attempts.get(ip) || []).filter((at) => nowMs - at < 10 * 60 * 1000)
  if (recent.length >= 10) {
    attempts.set(ip, recent)
    return false
  }
  recent.push(nowMs)
  attempts.set(ip, recent)
  return true
}

function authPage({ csrf, email, error, mode }) {
  const signup = mode === 'signup'
  return page(
    signup ? 'Create account' : 'Sign in',
    `${error ? `<p>${escapeHtml(error)}</p>` : ''}
<form method="post" action="${signup ? '/account/signup' : '/account/login'}">
<input type="hidden" name="csrf" value="${escapeHtml(csrf)}">
<p><label>Email<br><input name="email" type="email" required maxlength="254" autocomplete="email" value="${escapeHtml(email || '')}" style="width:100%;padding:8px;font:inherit"></label></p>
<p><label>Password<br><input name="password" type="password" required minlength="10" maxlength="200" autocomplete="${signup ? 'new-password' : 'current-password'}" style="width:100%;padding:8px;font:inherit"></label></p>
<button type="submit" style="font:inherit;font-weight:600;padding:10px 16px;border-radius:999px;border:0;background:#1c1c19;color:#f5f5f3">${signup ? 'Create account' : 'Sign in'}</button>
</form>
<p>${signup ? 'Already have an account? <a href="/account/login">Sign in</a>.' : 'Need an account? <a href="/account/signup">Create one</a>.'}</p>
<p>An account does not buy a license. The key appears here after payment clears for this email.</p>`,
  )
}

function dashboardPage({ user, licenses, csrf, notice, error }) {
  const rows = licenses.length
    ? licenses.map((record) => `<section>
<h2 style="font-size:1.1rem">Unlock</h2>
<p>Paid order ${escapeHtml(record.order)}. Paste this key into annotated, under Settings, then License.</p>
<textarea readonly rows="5" style="width:100%;font:12px/1.4 ui-monospace,Consolas,monospace;padding:10px;border:1px solid #d9d9d3;border-radius:8px">${escapeHtml(record.license)}</textarea>
<p><button type="button" onclick="navigator.clipboard.writeText(this.parentElement.previousElementSibling.value)">Copy key</button> <a href="/download?license=${encodeURIComponent(record.license)}">Download the signed installer</a></p>
</section>`).join('')
    : '<p>No paid license is on this account yet. Buy Unlock with this email, then come back here.</p>'
  const confirm = user.verifiedAt
    ? ''
    : `<p>Confirm ${escapeHtml(user.email)} to open this key from another device. ${escapeHtml(notice || 'Use the link we emailed you.')}</p>
<form method="post" action="/account/verify/send"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><button type="submit">Email the link again</button></form>`
  const problem = error ? `<p>${escapeHtml(error)}</p>` : ''
  return page(
    'Your licenses',
    `<p>Signed in as ${escapeHtml(user.email)}.</p>
<form method="post" action="/account/logout"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><button type="submit">Sign out</button></form>
${confirm}
${problem}
${rows}
<h2 style="font-size:1.1rem">Save a key you already have</h2>
<form method="post" action="/account/claim">
<input type="hidden" name="csrf" value="${escapeHtml(csrf)}">
<p><textarea name="license" rows="4" style="width:100%;font:12px/1.4 ui-monospace,Consolas,monospace;padding:10px"></textarea></p>
<button type="submit">Save to this account</button>
</form>
<p><a href="/buy">Buy Unlock</a></p>`,
  )
}

function accountLinks(user, record) {
  if (!record) return ''
  if (user && user.email === record.email) {
    return '<p>This key is on your account. <a href="/account">Open your licenses</a>.</p>'
  }
  return `<p>Create an account with ${escapeHtml(record.email)} and this key stays available when you come back. <a href="/account/signup?email=${encodeURIComponent(record.email)}">Create account</a> or <a href="/account/login">sign in</a>.</p>`
}

function clientIp(req) {
  const raw = req.socket && typeof req.socket.remoteAddress === 'string' ? req.socket.remoteAddress : ''
  return raw.startsWith('::ffff:') ? raw.slice(7) : raw
}

function validDodoProductId(id) {
  return typeof id === 'string' && /^pdt_[A-Za-z0-9_]+$/.test(id)
}

function dodoApiBase(testMode) {
  return testMode ? 'https://test.dodopayments.com' : 'https://live.dodopayments.com'
}

function dodoWebhookKey(secret) {
  if (typeof secret !== 'string' || !secret) return null
  const raw = secret.startsWith('whsec_') ? secret.slice(6) : secret
  try {
    const key = Buffer.from(raw, 'base64')
    return key.length ? key : null
  } catch {
    return null
  }
}

function verifyDodoSignature(rawBody, headers, secret, nowSeconds) {
  if (typeof rawBody !== 'string' || !headers || typeof secret !== 'string' || !secret) return false
  const id = typeof headers.id === 'string' ? headers.id : ''
  const timestamp = typeof headers.timestamp === 'string' ? headers.timestamp : ''
  const signatureHeader = typeof headers.signature === 'string' ? headers.signature : ''
  if (!id || !/^\d+$/.test(timestamp) || !signatureHeader) return false
  const age = Math.abs(Math.floor(nowSeconds) - Number(timestamp))
  if (age > 300) return false
  const key = dodoWebhookKey(secret)
  if (!key) return false
  const expected = crypto.createHmac('sha256', key).update(`${id}.${timestamp}.${rawBody}`).digest('base64')
  const expectedBuf = Buffer.from(expected)
  return signatureHeader.split(' ').some((part) => {
    const comma = part.indexOf(',')
    if (comma < 0) return false
    if (part.slice(0, comma) !== 'v1') return false
    const actual = Buffer.from(part.slice(comma + 1))
    return actual.length === expectedBuf.length && crypto.timingSafeEqual(actual, expectedBuf)
  })
}

function dodoEvent(rawBody, headers, secret, nowSeconds) {
  if (!verifyDodoSignature(rawBody, headers, secret, nowSeconds)) return { ok: false, reason: 'signature' }
  try {
    const event = JSON.parse(rawBody)
    if (!event || event.type !== 'payment.succeeded' || !event.data) return { ok: true, ignore: true }
    return { ok: true, payment: event.data }
  } catch {
    return { ok: false, reason: 'body' }
  }
}

function emailFromDodoPayment(payment) {
  const customer = payment && payment.customer
  if (customer && typeof customer.email === 'string') return customer.email
  return ''
}

function fulfillDodoPayment(payment, productId, privateKeyPem, orders, now) {
  if (!payment || typeof payment !== 'object') return { ok: false, reason: 'payment' }
  const status = typeof payment.status === 'string' ? payment.status : 'succeeded'
  if (status !== 'succeeded') return { ok: false, reason: 'pending', pending: true }
  const metadata = payment.metadata && typeof payment.metadata === 'object' ? payment.metadata : null
  if (metadata && metadata.product && metadata.product !== license.PRODUCT) return { ok: false, reason: 'product' }
  const cart = Array.isArray(payment.product_cart) ? payment.product_cart : []
  const priced = cart.some((item) => item && item.product_id === productId)
  if (!priced) return { ok: false, reason: 'product' }
  const paymentId = typeof payment.payment_id === 'string' ? payment.payment_id : ''
  if (!paymentId) return { ok: false, reason: 'session' }
  const email = emailFromDodoPayment(payment)
  const customer = payment.customer
  const customerId = customer && typeof customer.customer_id === 'string'
    ? customer.customer_id
    : typeof payment.customer_id === 'string' ? payment.customer_id : ''
  return fulfillPurchase({
    id: paymentId,
    email,
    product: license.PRODUCT,
    customerId,
  }, privateKeyPem, orders, now)
}

async function createDodoCheckout({ apiKey, apiBase, productId, returnUrl, cancelUrl, fetchImpl }) {
  const response = await fetchImpl(`${apiBase}/checkouts`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      product_cart: [{ product_id: productId, quantity: 1 }],
      return_url: returnUrl,
      cancel_url: cancelUrl,
      metadata: { product: license.PRODUCT },
    }),
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok || !payload || typeof payload.checkout_url !== 'string') {
    const error = new Error('checkout')
    error.status = response.status
    throw error
  }
  return payload.checkout_url
}

async function fetchDodoPayment(apiKey, apiBase, paymentId, fetchImpl) {
  if (!/^pay_[A-Za-z0-9_]+$/.test(paymentId)) return null
  const response = await fetchImpl(`${apiBase}/payments/${encodeURIComponent(paymentId)}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  })
  if (!response.ok) return null
  return response.json().catch(() => null)
}

async function defaultSendMail({ to, subject, text }) {
  const apiKey = process.env.RESEND_API_KEY || ''
  const from = process.env.ANNOTATED_MAIL_FROM || ''
  if (!apiKey || !from) return { ok: false, reason: 'mail' }
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to: [to], subject, text }),
  })
  if (!response.ok) return { ok: false, reason: 'mail' }
  return { ok: true }
}

function send(res, status, body, headers = {}) {
  const payload = Buffer.from(body)
  const extra = { ...headers }
  const cookies = extra['Set-Cookie']
  delete extra['Set-Cookie']
  const listed = cookies == null ? [] : [].concat(cookies).filter(Boolean)
  if (listed.length) res.setHeader('Set-Cookie', listed)
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': payload.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extra,
  })
  res.end(payload)
}

function redirect(res, location, cookies = []) {
  if (cookies.length) res.setHeader('Set-Cookie', cookies)
  res.writeHead(303, { Location: location, 'Cache-Control': 'no-store' })
  res.end()
}

function createServer(options) {
  const publicKey = options.publicKey
  const privateKey = options.privateKey
  const installerUrl = options.installerUrl || ''
  const origin = options.origin || 'https://annotated.click'
  const priceLabel = options.priceLabel || ''
  const sessionSecret = options.sessionSecret || ''
  const dodoApiKey = options.dodoApiKey || ''
  const dodoProductId = options.dodoProductId || ''
  const dodoWebhookSecret = options.dodoWebhookSecret || ''
  const dodoTestMode = options.dodoEnv === 'test'
  const fetchImpl = options.fetchImpl || fetch
  const sendMail = options.sendMail || defaultSendMail
  const dodoBase = dodoApiBase(dodoTestMode)
  const dodoReady = Boolean(dodoApiKey) && validDodoProductId(dodoProductId)
  const store = options.store || createSupabaseStore({
    url: options.supabaseUrl || process.env.SUPABASE_URL || '',
    anonKey: options.supabaseAnonKey || process.env.SUPABASE_ANON_KEY || '',
    serviceKey: options.supabaseServiceKey || process.env.SUPABASE_SERVICE_ROLE_KEY || '',
    fetchImpl,
    emailRedirectTo: `${origin}/account`,
  })
  const attempts = new Map()

  async function remember(result) {
    if (result && result.ok && result.record) await store.saveOrder(result.record)
    return result
  }

  async function orderBag(id) {
    const orders = {}
    if (!id) return orders
    const existing = await store.getOrder(id)
    if (existing) orders[id] = existing
    return orders
  }

  function sessionCookie(user, now) {
    return cookieHeader('annotated_session', seal({
      email: user.email,
      userId: user.id,
      exp: now + SESSION_SECONDS,
    }, sessionSecret), { maxAge: SESSION_SECONDS, origin })
  }

  async function currentUser(cookies, now) {
    if (!sessionSecret || !store.ready) return null
    const session = readUserSession(cookies.annotated_session, sessionSecret, now)
    if (!session) return null
    return store.userFromSession(session)
  }

  function csrfFor(cookies) {
    if (cookies.annotated_csrf && csrfOk(cookies.annotated_csrf, cookies.annotated_csrf, sessionSecret)) {
      return { value: cookies.annotated_csrf, set: [] }
    }
    const value = csrfCookie(sessionSecret)
    return { value, set: [cookieHeader('annotated_csrf', value, { maxAge: 7200, origin })] }
  }

  async function mailVerification(user) {
    const issued = await store.requestConfirm(user)
    if (!issued.ok || !issued.token) return issued
    const link = `${origin}/account/verify?email=${encodeURIComponent(user.email)}&token=${encodeURIComponent(issued.token)}`
    try {
      return await sendMail({
        to: user.email,
        subject: 'Confirm your annotated account',
        text: `Confirm your annotated account so you can open your unlock key from any device:\n\n${link}\n\nThis link expires in 24 hours.`,
      })
    } catch {
      return { ok: false, reason: 'mail' }
    }
  }

  async function claimReceipts(user, ids) {
    for (const id of ids) {
      const record = await store.getOrder(id)
      if (!record || record.email !== user.email || record.claimed) continue
      record.claimed = true
      await store.saveOrder(record)
    }
  }

  async function licensesFor(user) {
    const records = await store.listOrders(user.email)
    return records.filter((record) => record && record.license && (user.verifiedAt || record.claimed))
  }

  return http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', origin)
    const now = Math.floor(Date.now() / 1000)
    const cookies = readCookies(req)
    const user = await currentUser(cookies, now)
    try {
      if (req.method === 'GET' && url.pathname === '/health') {
        send(res, 200, 'ok', { 'Content-Type': 'text/plain; charset=utf-8' })
        return
      }
      if (req.method === 'GET' && url.pathname === BUY_PATH) {
        send(res, 200, buyPage({
          ready: dodoReady,
          priceLabel,
        }))
        return
      }
      if (req.method === 'POST' && url.pathname === CHECKOUT_PATH) {
        if (!dodoReady) {
          send(res, 503, page('Payment is not set up', '<p>Payment is not set up on this server yet.</p>'))
          return
        }
        try {
          const checkout = await createDodoCheckout({
            apiKey: dodoApiKey,
            apiBase: dodoBase,
            productId: dodoProductId,
            returnUrl: `${origin}${DONE_PATH}`,
            cancelUrl: `${origin}${BUY_PATH}`,
            fetchImpl,
          })
          redirect(res, checkout)
        } catch {
          send(res, 502, page('Payment is not set up', '<p>Payment could not start. Try again in a moment.</p>'))
        }
        return
      }
      if (req.method === 'POST' && url.pathname === DODO_WEBHOOK_PATH) {
        const raw = await readBody(req)
        const headerValue = (name) => {
          const value = req.headers[name]
          return Array.isArray(value) ? value[0] : value || ''
        }
        const event = dodoEvent(
          raw,
          {
            id: headerValue('webhook-id'),
            timestamp: headerValue('webhook-timestamp'),
            signature: headerValue('webhook-signature'),
          },
          dodoWebhookSecret,
          now,
        )
        if (!event.ok) {
          send(res, 400, 'invalid', { 'Content-Type': 'text/plain; charset=utf-8' })
          return
        }
        if (!store.ready) {
          send(res, 503, 'retry', { 'Content-Type': 'text/plain; charset=utf-8' })
          return
        }
        if (!event.ignore && event.payment) {
          if (!emailFromDodoPayment(event.payment)) {
            send(res, 500, 'retry', { 'Content-Type': 'text/plain; charset=utf-8' })
            return
          }
          const result = await remember(fulfillDodoPayment(event.payment, dodoProductId, privateKey, await orderBag(event.payment.payment_id), now))
          if (!result.ok && result.reason === 'email') {
            send(res, 500, 'retry', { 'Content-Type': 'text/plain; charset=utf-8' })
            return
          }
        }
        send(res, 200, 'ok', { 'Content-Type': 'text/plain; charset=utf-8' })
        return
      }
      if (req.method === 'GET' && url.pathname === DONE_PATH) {
        const paymentId = url.searchParams.get('payment_id') || ''
        let record = null
        if (/^pay_[A-Za-z0-9_]+$/.test(paymentId)) {
          record = store.ready ? await store.getOrder(paymentId) : null
          if (!record && dodoReady && store.ready) {
            const payment = await fetchDodoPayment(dodoApiKey, dodoBase, paymentId, fetchImpl)
            const result = payment
              ? await remember(fulfillDodoPayment(payment, dodoProductId, privateKey, await orderBag(payment.payment_id || paymentId), now))
              : { ok: false }
            if (result.ok) {
              record = result.record
            } else if (result.pending) {
              send(res, 200, donePage(null, true))
              return
            }
          }
        }
        const setCookies = []
        if (record && sessionSecret && store.ready) {
          setCookies.push(cookieHeader('annotated_receipt', rememberReceipt(cookies.annotated_receipt, sessionSecret, record.order, now), {
            maxAge: RECEIPT_SECONDS,
            origin,
          }))
          if (user && user.email === record.email && !record.claimed) {
            record.claimed = true
            await store.saveOrder(record)
          }
        }
        send(res, 200, donePage(record || null, !record, sessionSecret ? accountLinks(user, record) : ''), {
          'Set-Cookie': setCookies,
        })
        return
      }
      if (req.method === 'GET' && url.pathname === DOWNLOAD_PATH) {
        const target = downloadTarget(url.searchParams.get('license') || '', publicKey, installerUrl)
        if (target.location) {
          res.writeHead(302, { Location: target.location, 'Cache-Control': 'no-store' })
          res.end()
          return
        }
        send(res, target.status, page('Download', `<p>${escapeHtml(target.body)}</p>`))
        return
      }
      if (url.pathname === '/account' || url.pathname.startsWith('/account/')) {
        if (!sessionSecret || !store.ready) {
          send(res, 503, page('Accounts are not set up', '<p>Account sign-in is not set up on this server yet.</p>'))
          return
        }
        const csrf = csrfFor(cookies)
        if (req.method === 'GET' && (url.pathname === '/account/login' || url.pathname === '/account/signup')) {
          const email = accountEmail(url.searchParams.get('email') || '')
          send(res, 200, authPage({
            csrf: csrf.value,
            email,
            error: '',
            mode: url.pathname.endsWith('signup') ? 'signup' : 'login',
          }), { 'Set-Cookie': csrf.set })
          return
        }
        if (req.method === 'POST' && (url.pathname === '/account/login' || url.pathname === '/account/signup')) {
          if (!allowAttempt(attempts, clientIp(req), Date.now())) {
            send(res, 429, page('Slow down', '<p>Too many attempts. Wait a few minutes and try again.</p>'), { 'Set-Cookie': csrf.set })
            return
          }
          const form = new URLSearchParams(await readBody(req))
          const email = accountEmail(form.get('email') || '')
          const password = form.get('password') || ''
          const mode = url.pathname.endsWith('signup') ? 'signup' : 'login'
          if (!csrfOk(cookies.annotated_csrf, form.get('csrf') || '', sessionSecret)) {
            send(res, 400, authPage({ csrf: csrf.value, email, error: 'The form expired. Try again.', mode }), { 'Set-Cookie': csrf.set })
            return
          }
          if (!email || password.length < 10 || password.length > 200) {
            send(res, 400, authPage({ csrf: csrf.value, email, error: 'Use a valid email and a password of at least 10 characters.', mode }), { 'Set-Cookie': csrf.set })
            return
          }
          if (mode === 'signup') {
            const created = await store.signUp({ email, password })
            if (!created.ok) {
              const error = created.reason === 'exists'
                ? 'That email already has an account. Sign in.'
                : 'The account could not be created. Try again.'
              send(res, 400, authPage({ csrf: csrf.value, email, error, mode }), { 'Set-Cookie': csrf.set })
              return
            }
            const mailed = await mailVerification(created.user)
            await claimReceipts(created.user, receiptIds(cookies.annotated_receipt, sessionSecret, now))
            const notice = mailed.ok ? '' : 'Confirmation email is not set up yet, so open the key from this browser or paste it after you sign in elsewhere.'
            send(res, 200, dashboardPage({
              user: created.user,
              licenses: await licensesFor(created.user),
              csrf: csrf.value,
              notice,
            }), { 'Set-Cookie': csrf.set.concat(sessionCookie(created.user, now)) })
            return
          }
          const existing = await store.signIn({ email, password })
          if (!existing.ok) {
            send(res, 400, authPage({ csrf: csrf.value, email, error: 'Email or password is wrong.', mode: 'login' }), { 'Set-Cookie': csrf.set })
            return
          }
          await claimReceipts(existing.user, receiptIds(cookies.annotated_receipt, sessionSecret, now))
          redirect(res, '/account', csrf.set.concat(sessionCookie(existing.user, now)))
          return
        }
        if (req.method === 'POST' && url.pathname === '/account/logout') {
          const form = new URLSearchParams(await readBody(req))
          if (!csrfOk(cookies.annotated_csrf, form.get('csrf') || '', sessionSecret)) {
            send(res, 400, page('Form expired', '<p>The form expired. <a href="/account">Try again</a>.</p>'))
            return
          }
          redirect(res, '/account/login', [
            cookieHeader('annotated_session', '', { clear: true, origin }),
          ])
          return
        }
        if (req.method === 'GET' && url.pathname === '/account/verify') {
          const email = accountEmail(url.searchParams.get('email') || '')
          const token = url.searchParams.get('token') || ''
          const confirmed = email ? await store.confirmEmail({ email, token, now }) : { ok: false }
          if (!confirmed.ok) {
            send(res, 400, page('Link expired', '<p>That confirmation link is not valid. Sign in and send a new one.</p>'))
            return
          }
          redirect(res, '/account')
          return
        }
        if (!user) {
          redirect(res, '/account/login')
          return
        }
        if (req.method === 'POST' && url.pathname === '/account/verify/send') {
          const form = new URLSearchParams(await readBody(req))
          if (!csrfOk(cookies.annotated_csrf, form.get('csrf') || '', sessionSecret)) {
            send(res, 400, page('Form expired', '<p>The form expired. <a href="/account">Try again</a>.</p>'), { 'Set-Cookie': csrf.set })
            return
          }
          const mailed = user.verifiedAt ? { ok: true } : await mailVerification(user)
          send(res, 200, dashboardPage({
            user,
            licenses: await licensesFor(user),
            csrf: csrf.value,
            notice: mailed.ok ? 'A new confirmation link is on its way.' : 'Confirmation email is not set up yet.',
          }), { 'Set-Cookie': csrf.set })
          return
        }
        if (req.method === 'POST' && url.pathname === '/account/claim') {
          const form = new URLSearchParams(await readBody(req))
          if (!csrfOk(cookies.annotated_csrf, form.get('csrf') || '', sessionSecret)) {
            send(res, 400, page('Form expired', '<p>The form expired. <a href="/account">Try again</a>.</p>'), { 'Set-Cookie': csrf.set })
            return
          }
          const verified = license.verifyLicense(form.get('license') || '', publicKey, now)
          let notice = ''
          if (!verified.ok) notice = 'That license is not valid.'
          else if (verified.email !== user.email) notice = 'That license is for a different email.'
          else {
            const existing = await store.getOrder(verified.order)
            if (existing && existing.email !== user.email) notice = 'That license is for a different email.'
            else if (existing) {
              existing.claimed = true
              await store.saveOrder(existing)
            } else {
              await store.saveOrder({
                email: user.email,
                order: verified.order,
                license: String(form.get('license') || '').trim(),
                claimed: true,
                customerId: '',
                issued: verified.issued,
              })
            }
          }
          send(res, notice ? 400 : 200, dashboardPage({
            user,
            licenses: await licensesFor(user),
            csrf: csrf.value,
            notice: '',
            error: notice,
          }), { 'Set-Cookie': csrf.set })
          return
        }
        if (req.method === 'GET' && url.pathname === '/account') {
          send(res, 200, dashboardPage({
            user,
            licenses: await licensesFor(user),
            csrf: csrf.value,
            notice: '',
          }), { 'Set-Cookie': csrf.set })
          return
        }
      }
      send(res, 404, page('Not found', '<p>That page is not here.</p>'))
    } catch {
      send(res, 500, page('Something went wrong', '<p>Try again in a moment.</p>'))
    }
  })
}

function start() {
  const privatePath = process.env.ANNOTATED_LICENSE_PRIVATE_KEY || path.join(root, 'private.pem')
  const server = createServer({
    publicKey: license.bundledPublicKey(),
    privateKey: fs.readFileSync(privatePath, 'utf8'),
    installerUrl: process.env.ANNOTATED_INSTALLER_URL || '',
    dodoApiKey: process.env.DODO_PAYMENTS_API_KEY || '',
    dodoProductId: process.env.DODO_PAYMENTS_PRODUCT_ID || '',
    dodoWebhookSecret: process.env.DODO_PAYMENTS_WEBHOOK_KEY || '',
    dodoEnv: process.env.DODO_PAYMENTS_ENV || 'live',
    sessionSecret: process.env.ANNOTATED_SESSION_SECRET || '',
    supabaseUrl: process.env.SUPABASE_URL || '',
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
    supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
    origin: process.env.ANNOTATED_PUBLIC_ORIGIN || 'https://annotated.click',
    priceLabel: process.env.ANNOTATED_PRICE_LABEL || '',
  })
  const port = Number(process.env.PORT || 8787)
  const host = process.env.ANNOTATED_LICENSE_HOST || '127.0.0.1'
  server.listen(port, host, () => {
    console.log(`license issuer at http://${host}:${port}/buy`)
  })
}

const runningDirect = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (runningDirect) start()

export {
  buyPage,
  createServer,
  donePage,
  downloadTarget,
  fulfillDodoPayment,
  verifyDodoSignature,
}
