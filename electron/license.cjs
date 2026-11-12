const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { execFile } = require('child_process')

const PRODUCT = 'annotated'
const TIER = 'unlock'
const PREFIX = 'annotated1'
const MIN_ISSUED = 1704067200
const FUTURE_SLACK_SECONDS = 86400
const ORDER_PATTERN = /^[A-Za-z0-9_-]{8,128}$/
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

let cachedPublicKey = null

function fail(reason) {
  return { ok: false, reason }
}

function nowSeconds(now) {
  const value = now == null ? Date.now() / 1000 : Number(now)
  if (!Number.isFinite(value)) return Math.floor(Date.now() / 1000)
  return Math.floor(value)
}

function normalizeEmail(value) {
  if (typeof value !== 'string') return ''
  const email = value.trim().toLowerCase()
  if (email.length < 3 || email.length > 254 || !EMAIL_PATTERN.test(email)) return ''
  return email
}

function normalizeOrder(value) {
  if (typeof value !== 'string') return ''
  const order = value.trim()
  if (!ORDER_PATTERN.test(order)) return ''
  return order
}

function normalizeIssued(value) {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null
  if (value < MIN_ISSUED) return null
  return value
}

function buildPayload(fields) {
  const email = normalizeEmail(fields && fields.email)
  if (!email) return { error: 'email' }
  const order = normalizeOrder(fields && fields.order)
  if (!order) return { error: 'order' }
  const issued = normalizeIssued(fields && fields.issued)
  if (issued == null) return { error: 'issued' }
  const body = { email, issued, order, product: PRODUCT, tier: TIER }
  return { body, json: JSON.stringify(body) }
}

function issueLicense(privateKeyPem, fields) {
  const built = buildPayload(fields)
  if (built.error) {
    const error = new Error(built.error)
    error.code = built.error
    throw error
  }
  const payloadPart = Buffer.from(built.json).toString('base64url')
  const signature = crypto.sign(null, Buffer.from(payloadPart), privateKeyPem)
  return `${PREFIX}.${payloadPart}.${signature.toString('base64url')}`
}

function verifyLicense(token, publicKeyPem, now) {
  if (typeof token !== 'string' || typeof publicKeyPem !== 'string' || !publicKeyPem.includes('PUBLIC KEY')) {
    return fail('malformed')
  }
  const trimmed = token.trim()
  if (trimmed.length < 20 || trimmed.length > 4096) return fail('malformed')
  const parts = trimmed.split('.')
  if (parts.length !== 3 || parts[0] !== PREFIX) return fail('malformed')
  const payloadPart = parts[1]
  const sigPart = parts[2]
  if (!/^[A-Za-z0-9_-]+$/.test(payloadPart) || !/^[A-Za-z0-9_-]+$/.test(sigPart)) return fail('malformed')
  const signature = Buffer.from(sigPart, 'base64url')
  if (signature.length !== 64) return fail('malformed')
  let signed = false
  try {
    signed = crypto.verify(null, Buffer.from(payloadPart), publicKeyPem, signature)
  } catch {
    return fail('signature')
  }
  if (!signed) return fail('signature')
  let parsed
  try {
    parsed = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'))
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
  if (issued > nowSeconds(now) + FUTURE_SLACK_SECONDS) return fail('clock')
  const canonical = JSON.stringify({ email, issued, order, product: PRODUCT, tier: TIER })
  if (Buffer.from(canonical).toString('base64url') !== payloadPart) return fail('malformed')
  return { ok: true, email, order, issued, tier: TIER }
}

function bundledPublicKey() {
  if (!cachedPublicKey) cachedPublicKey = fs.readFileSync(path.join(__dirname, 'license-public.pem'), 'utf8')
  return cachedPublicKey
}

function licenseFile(dir) {
  return path.join(dir, 'license')
}

function readStored(dir, publicKeyPem, now) {
  let token
  try {
    token = fs.readFileSync(licenseFile(dir), 'utf8')
  } catch (error) {
    if (error && error.code === 'ENOENT') return fail('missing')
    return fail('malformed')
  }
  return verifyLicense(token, publicKeyPem, now)
}

function writeStored(dir, token, publicKeyPem, now) {
  const verified = verifyLicense(token, publicKeyPem, now)
  if (!verified.ok) return verified
  fs.mkdirSync(dir, { recursive: true })
  const tmp = path.join(dir, 'license.tmp')
  fs.writeFileSync(tmp, `${token.trim()}\n`)
  fs.renameSync(tmp, licenseFile(dir))
  return verified
}

function clearStored(dir) {
  try {
    fs.unlinkSync(licenseFile(dir))
  } catch (error) {
    if (!error || error.code !== 'ENOENT') throw error
  }
}

function signerName(subject) {
  const text = typeof subject === 'string' ? subject : ''
  const match = /(?:^|,\s*)CN=([^,]+)/.exec(text)
  if (!match) return text.trim()
  return match[1].replace(/^"|"$/g, '').trim()
}

function describeAuthenticity({ packaged, signature }) {
  if (!packaged) {
    return {
      state: 'development',
      signer: '',
      detail: 'Development copy. A release installer is signed, and Windows checks that signature when you open it.',
    }
  }
  const status = signature && typeof signature.status === 'string' ? signature.status : ''
  const signer = signerName(signature && signature.signer)
  if (status === 'Valid') {
    return { state: 'genuine', signer, detail: signer ? `Signed by ${signer}.` : 'Signed.' }
  }
  if (status === 'HashMismatch') {
    return { state: 'tampered', signer, detail: 'This copy was changed after it was signed.' }
  }
  if (status === 'NotSigned') {
    return {
      state: 'unsigned',
      signer: '',
      detail: 'This copy is not signed. The release installer is signed before download.',
    }
  }
  if (!status) {
    return { state: 'unknown', signer: '', detail: 'Could not read the signature on this copy.' }
  }
  return { state: 'untrusted', signer, detail: 'Windows does not trust the signature on this copy.' }
}

function unlockAllowed(stored, authenticity) {
  return Boolean(stored && stored.ok && authenticity && authenticity.state !== 'tampered')
}

function publicStatus(stored, authenticity) {
  const auth = authenticity || describeAuthenticity({ packaged: false, signature: null })
  return {
    tier: unlockAllowed(stored, auth) ? 'unlock' : 'free',
    email: stored && stored.ok ? stored.email : '',
    order: stored && stored.ok ? stored.order : '',
    license: !stored || stored.reason === 'missing' ? 'none' : stored.ok ? 'valid' : 'invalid',
    authenticity: auth.state,
    signer: auth.signer,
    detail: auth.detail,
  }
}

function explainReason(reason) {
  if (reason === 'signature') return 'That license was altered.'
  if (reason === 'clock') return 'That license is dated in the future.'
  if (reason === 'product' || reason === 'tier') return 'That license is not for annotated Unlock.'
  if (reason === 'missing') return 'Paste a license first.'
  return 'That license is not valid.'
}

function readAuthenticode(execPath) {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        [
          '$s = Get-AuthenticodeSignature -LiteralPath $env:ANNOTATED_EXE',
          '$signer = ""',
          'if ($s.SignerCertificate) { $signer = [string]$s.SignerCertificate.Subject }',
          "Write-Output (@{ status = [string]$s.Status; signer = $signer } | ConvertTo-Json -Compress)",
        ].join('; '),
      ],
      {
        timeout: 8000,
        windowsHide: true,
        env: { ...process.env, ANNOTATED_EXE: execPath },
      },
      (error, stdout) => {
        if (error) {
          reject(error)
          return
        }
        try {
          const parsed = JSON.parse(String(stdout || '').trim())
          resolve({
            status: typeof parsed.status === 'string' ? parsed.status : '',
            signer: typeof parsed.signer === 'string' ? parsed.signer : '',
          })
        } catch (parseError) {
          reject(parseError)
        }
      },
    )
  })
}

module.exports = {
  PRODUCT,
  TIER,
  PREFIX,
  issueLicense,
  verifyLicense,
  bundledPublicKey,
  readStored,
  writeStored,
  clearStored,
  describeAuthenticity,
  unlockAllowed,
  publicStatus,
  explainReason,
  readAuthenticode,
  signerName,
}
