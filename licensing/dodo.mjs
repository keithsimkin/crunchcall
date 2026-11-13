const PRODUCT = 'annotated'

export function dodoApiBase(envName) {
  return envName === 'test' ? 'https://test.dodopayments.com' : 'https://live.dodopayments.com'
}

export function validDodoProductId(id) {
  return typeof id === 'string' && /^pdt_[A-Za-z0-9_]+$/.test(id)
}

export function isAppsumoOrder(orderId) {
  return typeof orderId === 'string' && orderId.startsWith('appsumo_')
}

function bytesToBase64(bytes) {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}

function base64ToBytes(text) {
  const bin = atob(text)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i)
  return bytes
}

function sameBytes(left, right) {
  if (left.length !== right.length) return false
  let diff = 0
  for (let i = 0; i < left.length; i += 1) diff |= left[i] ^ right[i]
  return diff === 0
}

export async function verifyDodoSignature(rawBody, headers, secret, nowSeconds) {
  if (typeof rawBody !== 'string' || !headers || typeof secret !== 'string' || !secret) return false
  const id = typeof headers.id === 'string' ? headers.id : ''
  const timestamp = typeof headers.timestamp === 'string' ? headers.timestamp : ''
  const signatureHeader = typeof headers.signature === 'string' ? headers.signature : ''
  if (!id || !/^\d+$/.test(timestamp) || !signatureHeader) return false
  const age = Math.abs(Math.floor(nowSeconds) - Number(timestamp))
  if (age > 300) return false
  const raw = secret.startsWith('whsec_') ? secret.slice(6) : secret
  let keyBytes
  try {
    keyBytes = base64ToBytes(raw)
  } catch {
    return false
  }
  if (!keyBytes.length) return false
  const cryptoKey = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = new Uint8Array(
    await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(`${id}.${timestamp}.${rawBody}`)),
  )
  const expected = bytesToBase64(mac)
  const expectedBuf = new TextEncoder().encode(expected)
  return signatureHeader.split(' ').some((part) => {
    const comma = part.indexOf(',')
    if (comma < 0 || part.slice(0, comma) !== 'v1') return false
    return sameBytes(new TextEncoder().encode(part.slice(comma + 1)), expectedBuf)
  })
}

export async function readDodoEvent(rawBody, headers, secret, nowSeconds) {
  if (!(await verifyDodoSignature(rawBody, headers, secret, nowSeconds))) return { ok: false, reason: 'signature' }
  try {
    const event = JSON.parse(rawBody)
    if (!event || event.type !== 'payment.succeeded' || !event.data) return { ok: true, ignore: true }
    return { ok: true, payment: event.data }
  } catch {
    return { ok: false, reason: 'body' }
  }
}

export function emailFromDodoPayment(payment) {
  const customer = payment && payment.customer
  if (customer && typeof customer.email === 'string') return customer.email.trim().toLowerCase()
  return ''
}

export function dodoCheckoutBody({ productId, email, userId, returnUrl, cancelUrl }) {
  return {
    product_cart: [{ product_id: productId, quantity: 1 }],
    customer: { email },
    return_url: returnUrl,
    cancel_url: cancelUrl,
    metadata: { product: PRODUCT, email, user_id: userId || '' },
  }
}

export function planDodoLicense({ paymentId, email, existingPayment, owned }) {
  if (existingPayment && existingPayment.license) return { action: 'replay', record: existingPayment }
  if (owned && owned.license && !isAppsumoOrder(owned.order)) return { action: 'already', record: owned }
  return {
    action: 'issue',
    orderId: paymentId,
    email,
    maxDevices: 1,
  }
}

export function paymentMatchesProduct(payment, productId) {
  if (!payment || typeof payment !== 'object') return false
  const metadata = payment.metadata && typeof payment.metadata === 'object' ? payment.metadata : null
  if (metadata && metadata.product && metadata.product !== PRODUCT) return false
  const cart = Array.isArray(payment.product_cart) ? payment.product_cart : []
  return cart.some((item) => item && item.product_id === productId)
}
