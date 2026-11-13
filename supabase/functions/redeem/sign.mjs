const PRODUCT = 'annotated'
const TIER = 'unlock'
const PREFIX = 'annotated1'
const MIN_ISSUED = 1704067200
const FUTURE_SLACK_SECONDS = 86400
const ORDER_PATTERN = /^[A-Za-z0-9_-]{8,128}$/
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const keyCache = new Map()

export function normalizeEmail(value) {
  if (typeof value !== 'string') return ''
  const email = value.trim().toLowerCase()
  if (email.length < 3 || email.length > 254 || !EMAIL_PATTERN.test(email)) return ''
  return email
}

export function normalizeOrder(value) {
  if (typeof value !== 'string') return ''
  const order = value.trim()
  if (!ORDER_PATTERN.test(order)) return ''
  return order
}

export function normalizeIssued(value) {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null
  if (value < MIN_ISSUED) return null
  return value
}

export function canonicalPayload(fields) {
  const email = normalizeEmail(fields && fields.email)
  const order = normalizeOrder(fields && fields.order)
  const issued = normalizeIssued(fields && fields.issued)
  if (!email || !order || issued == null) return null
  const body = { email, issued, order, product: PRODUCT, tier: TIER }
  return { body, json: JSON.stringify(body) }
}

function pemToBytes(pem) {
  const b64 = String(pem)
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s+/g, '')
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i)
  return bytes
}

export function bytesToBase64Url(bytes) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let bin = ''
  for (let i = 0; i < view.length; i += 1) bin += String.fromCharCode(view[i])
  return btoa(bin).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

export function base64UrlToBytes(text) {
  const pad = text.length % 4 === 0 ? '' : '='.repeat(4 - (text.length % 4))
  const b64 = text.replaceAll('-', '+').replaceAll('_', '/') + pad
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i)
  return bytes
}

export async function importSigningKey(privatePem) {
  const cached = keyCache.get(privatePem)
  if (cached) return cached
  const privateKey = await crypto.subtle.importKey('pkcs8', pemToBytes(privatePem), { name: 'Ed25519' }, true, ['sign'])
  const jwk = await crypto.subtle.exportKey('jwk', privateKey)
  const publicKey = await crypto.subtle.importKey(
    'jwk',
    { kty: 'OKP', crv: 'Ed25519', x: jwk.x },
    { name: 'Ed25519' },
    false,
    ['verify'],
  )
  const pair = { privateKey, publicKey }
  keyCache.set(privatePem, pair)
  return pair
}

export async function issueLicenseToken(privatePem, fields) {
  const built = canonicalPayload(fields)
  if (!built) {
    const error = new Error('license')
    error.code = 'invalid'
    throw error
  }
  const payloadPart = bytesToBase64Url(new TextEncoder().encode(built.json))
  const { privateKey } = await importSigningKey(privatePem)
  const signature = await crypto.subtle.sign({ name: 'Ed25519' }, privateKey, new TextEncoder().encode(payloadPart))
  return `${PREFIX}.${payloadPart}.${bytesToBase64Url(new Uint8Array(signature))}`
}

function fail(reason) {
  return { ok: false, reason }
}

export async function verifyLicenseToken(privatePem, token, now) {
  if (typeof token !== 'string' || typeof privatePem !== 'string' || !privatePem.includes('PRIVATE KEY')) return fail('malformed')
  const trimmed = token.trim()
  if (trimmed.length < 20 || trimmed.length > 4096) return fail('malformed')
  const parts = trimmed.split('.')
  if (parts.length !== 3 || parts[0] !== PREFIX) return fail('malformed')
  const payloadPart = parts[1]
  const sigPart = parts[2]
  if (!/^[A-Za-z0-9_-]+$/.test(payloadPart) || !/^[A-Za-z0-9_-]+$/.test(sigPart)) return fail('malformed')
  let signature
  try {
    signature = base64UrlToBytes(sigPart)
  } catch {
    return fail('malformed')
  }
  if (signature.length !== 64) return fail('malformed')
  let signed = false
  try {
    const { publicKey } = await importSigningKey(privatePem)
    signed = await crypto.subtle.verify(
      { name: 'Ed25519' },
      publicKey,
      signature,
      new TextEncoder().encode(payloadPart),
    )
  } catch {
    return fail('signature')
  }
  if (!signed) return fail('signature')
  let parsed
  try {
    parsed = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payloadPart)))
  } catch {
    return fail('malformed')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return fail('malformed')
  const keys = Object.keys(parsed)
  if (keys.length !== 5 || keys.slice().sort().join(',') !== 'email,issued,order,product,tier') return fail('malformed')
  if (parsed.product !== PRODUCT) return fail('product')
  if (parsed.tier !== TIER) return fail('tier')
  const email = normalizeEmail(parsed.email)
  const order = normalizeOrder(parsed.order)
  const issued = normalizeIssued(parsed.issued)
  if (!email || email !== parsed.email) return fail('email')
  if (!order || order !== parsed.order) return fail('order')
  if (issued == null || issued !== parsed.issued) return fail('issued')
  const nowSeconds = Number.isFinite(Number(now)) ? Math.floor(Number(now)) : Math.floor(Date.now() / 1000)
  if (issued > nowSeconds + FUTURE_SLACK_SECONDS) return fail('clock')
  const canonical = JSON.stringify({ email, issued, order, product: PRODUCT, tier: TIER })
  if (bytesToBase64Url(new TextEncoder().encode(canonical)) !== payloadPart) return fail('malformed')
  return { ok: true, email, order, issued, tier: TIER }
}
