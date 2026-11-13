const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

const SEAT_SALT = 'annotated-seat-v1'
const API_ORIGIN = 'https://annotated.click'
const RECHECK_SECONDS = 24 * 60 * 60
const FAIL_BACKOFF_SECONDS = 15 * 60
const FETCH_MS = 5000

const SEAT_TAKEN =
  'This code is already active on another PC. On that PC, open Settings, then License, and choose Deactivate this PC. Then paste this key here and activate it.'
const SEAT_OFFLINE = 'Connect once to activate this PC. After that, annotated keeps working offline.'
const SEAT_NETWORK = "Couldn't reach the license server. Check your connection and try again."
const SEAT_DEACTIVATE_NETWORK =
  "This PC is still activated because annotated couldn't reach the license server. Try again when you're online so this code can move to another PC."

let cachedDevice = ''
let failedAt = 0
let pending = null

function seatRequired(order) {
  return typeof order === 'string' && order.startsWith('appsumo_')
}

function hashDeviceId(machineId) {
  const id = typeof machineId === 'string' ? machineId.trim() : ''
  if (!id) return ''
  return crypto.createHash('sha256').update(`${SEAT_SALT}\0${id}`).digest('hex')
}

function parseWindowsMachineGuid(text) {
  const match = /MachineGuid\s+REG_\w+\s+(\S+)/i.exec(String(text || ''))
  return match ? match[1].trim() : ''
}

function readMachineId(execImpl = execFileSync) {
  try {
    if (process.platform === 'win32') {
      const stdout = execImpl('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'], {
        timeout: 4000,
        windowsHide: true,
        encoding: 'utf8',
      })
      return parseWindowsMachineGuid(stdout)
    }
    if (process.platform === 'linux') {
      return fs.readFileSync('/etc/machine-id', 'utf8').trim()
    }
    if (process.platform === 'darwin') {
      const stdout = execImpl('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'], { timeout: 4000, encoding: 'utf8' })
      const match = /"IOPlatformUUID"\s*=\s*"([^"]+)"/.exec(String(stdout || ''))
      return match ? match[1].trim() : ''
    }
  } catch {
    return ''
  }
  return ''
}

function installSeed(dir) {
  const file = path.join(dir, 'device-seed')
  try {
    const existing = fs.readFileSync(file, 'utf8').trim()
    if (existing) return existing
  } catch {
    /* create one below */
  }
  const seed = crypto.randomBytes(32).toString('hex')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(file, `${seed}\n`)
  return seed
}

function currentDeviceId(dir) {
  if (cachedDevice) return cachedDevice
  const machine = readMachineId() || installSeed(dir)
  cachedDevice = hashDeviceId(machine)
  return cachedDevice
}

function visibleText(value) {
  const text = String(value || '')
  let out = ''
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i)
    if (code >= 32 && code !== 127) out += text[i]
  }
  return out
}

function deviceLabel() {
  return visibleText(os.hostname()).trim().slice(0, 80)
}

function cacheFile(dir) {
  return path.join(dir, 'license-seat.json')
}

function readToken(dir) {
  try {
    return fs.readFileSync(path.join(dir, 'license'), 'utf8').trim()
  } catch {
    return ''
  }
}

function readCache(dir) {
  try {
    const parsed = JSON.parse(fs.readFileSync(cacheFile(dir), 'utf8'))
    if (!parsed || typeof parsed !== 'object') return null
    if (typeof parsed.order !== 'string' || typeof parsed.deviceId !== 'string') return null
    return {
      order: parsed.order,
      deviceId: parsed.deviceId,
      checkedAt: Number(parsed.checkedAt) || 0,
      ok: parsed.ok === true,
    }
  } catch {
    return null
  }
}

function writeCache(dir, record) {
  fs.mkdirSync(dir, { recursive: true })
  const tmp = path.join(dir, 'license-seat.json.tmp')
  fs.writeFileSync(tmp, JSON.stringify(record))
  fs.renameSync(tmp, cacheFile(dir))
}

function clearCache(dir) {
  try {
    fs.unlinkSync(cacheFile(dir))
  } catch (error) {
    if (!error || error.code !== 'ENOENT') throw error
  }
}

function apiOrigin(baseUrl) {
  if (typeof baseUrl === 'string' && baseUrl.startsWith('https://')) return baseUrl.replace(/\/$/, '')
  const configured = process.env.ANNOTATED_LICENSE_API
  if (typeof configured === 'string' && configured.startsWith('https://')) return configured.replace(/\/$/, '')
  return API_ORIGIN
}

function viewSeat(dir, order, deviceId, now) {
  if (!seatRequired(order)) return { applicable: false, ok: true, stale: false, seat: 'open', detail: '' }
  const cache = readCache(dir)
  if (!cache || cache.order !== order || cache.deviceId !== deviceId) {
    return { applicable: true, ok: false, stale: true, seat: 'inactive', detail: SEAT_OFFLINE }
  }
  if (cache.ok !== true) {
    return { applicable: true, ok: false, stale: false, seat: 'blocked', detail: SEAT_TAKEN }
  }
  const checkedAt = Number(cache.checkedAt) || 0
  return {
    applicable: true,
    ok: true,
    stale: now - checkedAt >= RECHECK_SECONDS,
    seat: 'active',
    detail: '',
  }
}

function decorateStatus(base, view) {
  const status = { ...(base || {}), seat: 'open', seatDetail: '' }
  if (!base || base.license !== 'valid' || !view || !view.applicable) return status
  if (view.ok) return { ...status, seat: 'active', seatDetail: '' }
  return {
    ...status,
    tier: 'free',
    seat: view.seat || 'blocked',
    seatDetail: view.detail || SEAT_TAKEN,
  }
}

async function postLicense(pathname, body, { baseUrl, fetchImpl } = {}) {
  const fetchFn = fetchImpl || globalThis.fetch
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_MS)
  try {
    const response = await fetchFn(`${apiOrigin(baseUrl)}${pathname}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    const payload = await response.json().catch(() => null)
    if (payload && payload.ok === true) {
      return { ok: true, limited: payload.limited === true, maxDevices: payload.maxDevices ?? null }
    }
    if (payload && payload.reason === 'limit_reached') {
      return { ok: false, reason: 'limit_reached', message: SEAT_TAKEN }
    }
    if (!payload || payload.reason === 'unavailable' || response.status >= 500) {
      return { ok: false, reason: 'network', message: SEAT_NETWORK }
    }
    return { ok: false, reason: payload.reason || 'invalid', message: 'That license is not valid.' }
  } catch {
    return { ok: false, reason: 'network', message: SEAT_NETWORK }
  } finally {
    clearTimeout(timer)
  }
}

async function touchSeat(opts) {
  const result = await postLicense(
    '/api/license/activate',
    { license: opts.token, deviceId: opts.deviceId, deviceLabel: opts.deviceLabel || '' },
    opts,
  )
  if (result.ok) {
    failedAt = 0
    writeCache(opts.dir, { order: opts.order, deviceId: opts.deviceId, checkedAt: opts.now, ok: true })
    return { ok: true }
  }
  if (result.reason === 'limit_reached') {
    failedAt = 0
    writeCache(opts.dir, { order: opts.order, deviceId: opts.deviceId, checkedAt: opts.now, ok: false })
    return { ok: false, reason: 'limit_reached', message: SEAT_TAKEN }
  }
  failedAt = opts.now
  return { ok: false, reason: result.reason || 'network', message: result.message || SEAT_NETWORK }
}

async function recheckIfDue(opts) {
  const view = viewSeat(opts.dir, opts.order, opts.deviceId, opts.now)
  if (!view.applicable || view.seat === 'blocked') return view
  if (view.ok && !view.stale) return view
  if (!opts.force && failedAt && opts.now - failedAt < FAIL_BACKOFF_SECONDS) return view
  await touchSeat(opts)
  return viewSeat(opts.dir, opts.order, opts.deviceId, opts.now)
}

function scheduleRecheck(opts) {
  if (pending) return
  pending = Promise.resolve()
    .then(() => recheckIfDue(opts))
    .catch(() => {})
    .finally(() => {
      pending = null
    })
}

async function releaseSeat(opts) {
  const result = await postLicense(
    '/api/license/deactivate',
    { license: opts.token, deviceId: opts.deviceId },
    opts,
  )
  if (!result.ok && result.reason === 'network') return { ok: false, message: SEAT_DEACTIVATE_NETWORK }
  if (!result.ok && result.reason !== 'unknown') return { ok: false, message: result.message || 'That license is not valid.' }
  clearCache(opts.dir)
  return { ok: true }
}

function resetSeatRuntime() {
  cachedDevice = ''
  failedAt = 0
  pending = null
}

module.exports = {
  SEAT_SALT,
  API_ORIGIN,
  RECHECK_SECONDS,
  FAIL_BACKOFF_SECONDS,
  SEAT_TAKEN,
  SEAT_OFFLINE,
  SEAT_NETWORK,
  SEAT_DEACTIVATE_NETWORK,
  seatRequired,
  hashDeviceId,
  parseWindowsMachineGuid,
  readMachineId,
  installSeed,
  currentDeviceId,
  deviceLabel,
  readToken,
  readCache,
  clearCache,
  viewSeat,
  decorateStatus,
  touchSeat,
  claimSeat: touchSeat,
  recheckIfDue,
  scheduleRecheck,
  releaseSeat,
  resetSeatRuntime,
}
