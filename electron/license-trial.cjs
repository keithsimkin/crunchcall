const fs = require('fs')
const path = require('path')

const TRIAL_DAYS = 7
const TRIAL_SECONDS = TRIAL_DAYS * 24 * 60 * 60
const API_ORIGIN = 'https://annotated.click'
const FETCH_MS = 5000
const FAIL_BACKOFF_SECONDS = 15 * 60

let failedAt = 0

function trialFile(dir) {
  return path.join(dir, 'trial.json')
}

function apiOrigin(baseUrl) {
  if (typeof baseUrl === 'string' && baseUrl.startsWith('https://')) return baseUrl.replace(/\/$/, '')
  const configured = process.env.ANNOTATED_LICENSE_API
  if (typeof configured === 'string' && configured.startsWith('https://')) return configured.replace(/\/$/, '')
  return API_ORIGIN
}

function readLocal(dir) {
  try {
    const parsed = JSON.parse(fs.readFileSync(trialFile(dir), 'utf8'))
    if (!parsed || typeof parsed !== 'object') return null
    const startedAt = Number(parsed.startedAt)
    if (!Number.isInteger(startedAt) || startedAt < 1704067200) return null
    return {
      startedAt,
      deviceId: typeof parsed.deviceId === 'string' ? parsed.deviceId : '',
      synced: parsed.synced === true,
    }
  } catch {
    return null
  }
}

function writeLocal(dir, record) {
  fs.mkdirSync(dir, { recursive: true })
  const tmp = path.join(dir, 'trial.json.tmp')
  fs.writeFileSync(tmp, JSON.stringify(record))
  fs.renameSync(tmp, trialFile(dir))
}

function viewTrial(startedAt, now) {
  const started = Number(startedAt)
  const at = Number(now)
  if (!Number.isInteger(started) || !Number.isInteger(at)) {
    return { applicable: false, active: false, startedAt: 0, endsAt: 0, daysLeft: 0 }
  }
  const endsAt = started + TRIAL_SECONDS
  const active = at < endsAt
  const remaining = Math.max(0, endsAt - at)
  return {
    applicable: true,
    active,
    startedAt: started,
    endsAt,
    daysLeft: active ? Math.max(1, Math.ceil(remaining / 86400)) : 0,
  }
}

function decorateStatus(base, trial) {
  const status = {
    ...(base || {}),
    trialEndsAt: 0,
    trialDaysLeft: 0,
  }
  if (!base || base.tier === 'unlock') return status
  if (!trial || !trial.applicable) return status
  status.trialEndsAt = trial.endsAt
  status.trialDaysLeft = trial.daysLeft
  if (trial.active) status.tier = 'trial'
  return status
}

function isUnlocked(status) {
  return Boolean(status && (status.tier === 'unlock' || status.tier === 'trial'))
}

async function postTrial(deviceId, { baseUrl, fetchImpl } = {}) {
  const fetchFn = fetchImpl || globalThis.fetch
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_MS)
  try {
    const response = await fetchFn(`${apiOrigin(baseUrl)}/api/license/trial`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ deviceId }),
      signal: controller.signal,
    })
    const payload = await response.json().catch(() => null)
    if (!payload || payload.ok !== true || !Number.isInteger(payload.startedAt)) {
      return { ok: false, reason: response.status >= 500 ? 'network' : 'invalid' }
    }
    return {
      ok: true,
      startedAt: payload.startedAt,
      endsAt: Number(payload.endsAt) || payload.startedAt + TRIAL_SECONDS,
      active: payload.active === true,
      daysLeft: Number(payload.daysLeft) || 0,
    }
  } catch {
    return { ok: false, reason: 'network' }
  } finally {
    clearTimeout(timer)
  }
}

async function ensureTrial(opts) {
  const now = Number(opts.now) || Math.floor(Date.now() / 1000)
  const deviceId = typeof opts.deviceId === 'string' ? opts.deviceId : ''
  const local = readLocal(opts.dir)

  if (local && local.synced) {
    return viewTrial(local.startedAt, now)
  }

  if (deviceId && (!failedAt || now - failedAt >= FAIL_BACKOFF_SECONDS)) {
    const claimed = await postTrial(deviceId, opts)
    if (claimed.ok) {
      failedAt = 0
      writeLocal(opts.dir, { startedAt: claimed.startedAt, deviceId, synced: true })
      return viewTrial(claimed.startedAt, now)
    }
    failedAt = now
  }

  if (local) return viewTrial(local.startedAt, now)

  // First launch offline: start a provisional trial and sync when the network returns.
  writeLocal(opts.dir, { startedAt: now, deviceId, synced: false })
  return viewTrial(now, now)
}

function resetTrialRuntime() {
  failedAt = 0
}

module.exports = {
  TRIAL_DAYS,
  TRIAL_SECONDS,
  API_ORIGIN,
  readLocal,
  writeLocal,
  viewTrial,
  decorateStatus,
  isUnlocked,
  postTrial,
  ensureTrial,
  resetTrialRuntime,
}
