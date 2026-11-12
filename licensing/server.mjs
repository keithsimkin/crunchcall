import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const license = require('../electron/license.cjs')

const root = path.dirname(fileURLToPath(import.meta.url))
const BUY_PATH = '/buy'
const DONE_PATH = '/buy/done'
const CHECKOUT_PATH = '/checkout'
const WEBHOOK_PATH = '/stripe/webhook'
const DOWNLOAD_PATH = '/download'

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
  const price = priceLabel ? `<p>Unlock is ${escapeHtml(priceLabel)}, once. Local notes stay free.</p>` : '<p>Unlock is a one-time payment. Local notes stay free, and there is no account.</p>'
  const action = ready
    ? '<form method="post" action="/checkout"><button type="submit" style="font:inherit;font-weight:600;padding:10px 16px;border-radius:999px;border:0;background:#1c1c19;color:#f5f5f3">Continue to payment</button></form>'
    : '<p>Payment is not set up on this server yet.</p>'
  return page(
    'Buy annotated Unlock',
    `${price}
<p>After payment you get a license and the signed installer. Windows checks the installer signature when you open it. annotated checks the license on this PC, offline.</p>
${action}`,
  )
}

function donePage(record, pending) {
  if (pending || !record) {
    return page('Payment is still settling', '<p>Refresh this page in a moment. The license shows up here after the payment clears.</p>')
  }
  const download = `/download?license=${encodeURIComponent(record.license)}`
  return page(
    'Your unlock is ready',
    `<p>Paste this license into annotated, under Settings, then License. It is checked on this PC.</p>
<textarea readonly rows="5" style="width:100%;font:12px/1.4 ui-monospace,Consolas,monospace;padding:10px;border:1px solid #d9d9d3;border-radius:8px">${escapeHtml(record.license)}</textarea>
<p><a href="${download}">Download the signed installer</a></p>
<p>The download link only works with this license. Windows checks the signature before the installer runs.</p>`,
  )
}

function loadOrders(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return parsed
  } catch (error) {
    if (error && error.code === 'ENOENT') return {}
    throw error
  }
}

function saveOrders(file, orders) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(orders))
  fs.renameSync(tmp, file)
}

function fulfillSession(session, privateKeyPem, orders, now) {
  if (!session || session.object !== 'checkout.session') return { ok: false, reason: 'session' }
  if (!session.metadata || session.metadata.product !== license.PRODUCT) return { ok: false, reason: 'product' }
  if (session.payment_status !== 'paid') return { ok: false, reason: 'pending', pending: true }
  const id = typeof session.id === 'string' ? session.id : ''
  if (!id) return { ok: false, reason: 'session' }
  if (orders[id] && orders[id].license) return { ok: true, record: orders[id] }
  const email = (session.customer_details && session.customer_details.email) || session.customer_email || ''
  const issued = Math.floor(Number(now) || Date.now() / 1000)
  let token
  try {
    token = license.issueLicense(privateKeyPem, { email, order: id, issued })
  } catch {
    return { ok: false, reason: 'email' }
  }
  const record = { email: email.trim().toLowerCase(), order: id, license: token }
  orders[id] = record
  return { ok: true, record }
}

function verifyStripeSignature(rawBody, header, secret, nowSeconds) {
  if (typeof rawBody !== 'string' || typeof header !== 'string' || typeof secret !== 'string' || !secret) return false
  const fields = new Map()
  const signatures = []
  for (const part of header.split(',')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    const key = part.slice(0, eq).trim()
    const value = part.slice(eq + 1).trim()
    if (key === 'v1') signatures.push(value)
    else fields.set(key, value)
  }
  const timestamp = fields.get('t')
  if (!timestamp || !/^\d+$/.test(timestamp) || signatures.length === 0) return false
  const age = Math.abs(Math.floor(nowSeconds) - Number(timestamp))
  if (age > 300) return false
  const expected = crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')
  const expectedBuf = Buffer.from(expected)
  return signatures.some((candidate) => {
    const actual = Buffer.from(candidate)
    return actual.length === expectedBuf.length && crypto.timingSafeEqual(actual, expectedBuf)
  })
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

function stripeEvent(rawBody, header, secret, nowSeconds) {
  if (!verifyStripeSignature(rawBody, header, secret, nowSeconds)) return { ok: false, reason: 'signature' }
  try {
    const event = JSON.parse(rawBody)
    if (!event || event.type !== 'checkout.session.completed' || !event.data || !event.data.object) {
      return { ok: true, ignore: true }
    }
    return { ok: true, session: event.data.object }
  } catch {
    return { ok: false, reason: 'body' }
  }
}

async function createCheckoutSession({ secretKey, priceId, successUrl, cancelUrl }) {
  const body = new URLSearchParams({
    mode: 'payment',
    'line_items[0][price]': priceId,
    'line_items[0][quantity]': '1',
    success_url: successUrl,
    cancel_url: cancelUrl,
    'metadata[product]': license.PRODUCT,
  })
  const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok || !payload || typeof payload.url !== 'string') {
    const error = new Error('checkout')
    error.status = response.status
    throw error
  }
  return payload.url
}

async function fetchCheckoutSession(secretKey, sessionId) {
  if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId)) return null
  const response = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, {
    headers: { Authorization: `Bearer ${secretKey}` },
  })
  if (!response.ok) return null
  const payload = await response.json().catch(() => null)
  return payload
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

function send(res, status, body, headers = {}) {
  const payload = Buffer.from(body)
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': payload.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  })
  res.end(payload)
}

function createServer(options) {
  const ordersFile = options.ordersFile
  const publicKey = options.publicKey
  const privateKey = options.privateKey
  const installerUrl = options.installerUrl || ''
  const stripeSecret = options.stripeSecret || ''
  const stripePrice = options.stripePrice || ''
  const webhookSecret = options.webhookSecret || ''
  const origin = options.origin || 'https://annotated.click'
  const priceLabel = options.priceLabel || ''
  const orders = loadOrders(ordersFile)

  function persist() {
    saveOrders(ordersFile, orders)
  }

  return http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', origin)
    try {
      if (req.method === 'GET' && url.pathname === '/health') {
        send(res, 200, 'ok', { 'Content-Type': 'text/plain; charset=utf-8' })
        return
      }
      if (req.method === 'GET' && url.pathname === BUY_PATH) {
        send(res, 200, buyPage({ ready: Boolean(stripeSecret && stripePrice), priceLabel }))
        return
      }
      if (req.method === 'POST' && url.pathname === CHECKOUT_PATH) {
        if (!stripeSecret || !stripePrice) {
          send(res, 503, page('Payment is not set up', '<p>Payment is not set up on this server yet.</p>'))
          return
        }
        const checkout = await createCheckoutSession({
          secretKey: stripeSecret,
          priceId: stripePrice,
          successUrl: `${origin}${DONE_PATH}?session_id={CHECKOUT_SESSION_ID}`,
          cancelUrl: `${origin}${BUY_PATH}`,
        })
        res.writeHead(303, { Location: checkout, 'Cache-Control': 'no-store' })
        res.end()
        return
      }
      if (req.method === 'POST' && url.pathname === WEBHOOK_PATH) {
        const raw = await readBody(req)
        const signatureHeader = req.headers['stripe-signature']
        const event = stripeEvent(
          raw,
          Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader || '',
          webhookSecret,
          Math.floor(Date.now() / 1000),
        )
        if (!event.ok) {
          send(res, 400, 'invalid', { 'Content-Type': 'text/plain; charset=utf-8' })
          return
        }
        if (!event.ignore && event.session) {
          const result = fulfillSession(event.session, privateKey, orders)
          if (!result.ok && result.reason === 'email') {
            send(res, 500, 'retry', { 'Content-Type': 'text/plain; charset=utf-8' })
            return
          }
          if (result.ok) persist()
        }
        send(res, 200, 'ok', { 'Content-Type': 'text/plain; charset=utf-8' })
        return
      }
      if (req.method === 'GET' && url.pathname === DONE_PATH) {
        const sessionId = url.searchParams.get('session_id') || ''
        let record = orders[sessionId]
        if (!record && stripeSecret && sessionId) {
          const session = await fetchCheckoutSession(stripeSecret, sessionId)
          const result = fulfillSession(session, privateKey, orders)
          if (result.ok) {
            record = result.record
            persist()
          } else if (result.pending) {
            send(res, 200, donePage(null, true))
            return
          }
        }
        send(res, 200, donePage(record || null, !record))
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
      send(res, 404, page('Not found', '<p>That page is not here.</p>'))
    } catch {
      send(res, 500, page('Something went wrong', '<p>Try again in a moment.</p>'))
    }
  })
}

function start() {
  const privatePath = process.env.ANNOTATED_LICENSE_PRIVATE_KEY || path.join(root, 'private.pem')
  const server = createServer({
    ordersFile: process.env.ANNOTATED_ORDERS_FILE || path.join(root, 'orders.json'),
    publicKey: license.bundledPublicKey(),
    privateKey: fs.readFileSync(privatePath, 'utf8'),
    installerUrl: process.env.ANNOTATED_INSTALLER_URL || '',
    stripeSecret: process.env.STRIPE_SECRET_KEY || '',
    stripePrice: process.env.STRIPE_PRICE_ID || '',
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
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
  fulfillSession,
  stripeEvent,
  verifyStripeSignature,
}
