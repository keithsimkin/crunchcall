import { normalizeDeviceId } from './seats.mjs'

export const TRIAL_DAYS = 7
export const TRIAL_SECONDS = TRIAL_DAYS * 24 * 60 * 60

export function trialWindow(startedAt, now) {
  const started = Number(startedAt)
  const at = Number(now)
  if (!Number.isInteger(started) || !Number.isInteger(at)) {
    return { ok: false, reason: 'unavailable' }
  }
  const endsAt = started + TRIAL_SECONDS
  const active = at < endsAt
  const remaining = Math.max(0, endsAt - at)
  const daysLeft = active ? Math.max(1, Math.ceil(remaining / 86400)) : 0
  return { ok: true, startedAt: started, endsAt, active, daysLeft }
}

export function decideTrialClaim({ existingStartedAt, now }) {
  if (existingStartedAt != null) {
    return trialWindow(existingStartedAt, now)
  }
  return trialWindow(now, now)
}

function serviceHeaders(serviceKey) {
  return {
    apikey: serviceKey,
    authorization: `Bearer ${serviceKey}`,
    'content-type': 'application/json',
    prefer: 'return=representation',
  }
}

export function createSupabaseTrials({ url, serviceKey, fetchImpl } = {}) {
  const fetchFn = fetchImpl || globalThis.fetch
  return {
    async claim({ deviceId, now }) {
      const id = normalizeDeviceId(deviceId)
      if (!id) return { ok: false, reason: 'device' }
      const started = Number(now)
      if (!Number.isInteger(started) || started < 1704067200) return { ok: false, reason: 'unavailable' }
      if (!url || !serviceKey) return { ok: false, reason: 'unavailable' }

      const response = await fetchFn(`${String(url).replace(/\/$/, '')}/rest/v1/rpc/claim_device_trial`, {
        method: 'POST',
        headers: serviceHeaders(serviceKey),
        body: JSON.stringify({ p_device_id: id, p_started_at: started }),
      })
      if (!response.ok) return { ok: false, reason: 'unavailable' }
      const rows = await response.json().catch(() => null)
      const row = Array.isArray(rows) ? rows[0] : rows
      if (!row || typeof row.started_at !== 'number') return { ok: false, reason: 'unavailable' }
      const view = trialWindow(row.started_at, started)
      if (!view.ok) return view
      return { ...view, created: row.created === true }
    },
  }
}

export function createMemoryTrials(seed = []) {
  const byDevice = new Map()
  for (const row of seed) {
    const id = normalizeDeviceId(row.deviceId)
    if (id) byDevice.set(id, Number(row.startedAt))
  }
  return {
    async claim({ deviceId, now }) {
      const id = normalizeDeviceId(deviceId)
      if (!id) return { ok: false, reason: 'device' }
      const started = Number(now)
      if (!Number.isInteger(started) || started < 1704067200) return { ok: false, reason: 'unavailable' }
      const created = !byDevice.has(id)
      if (created) byDevice.set(id, started)
      const view = trialWindow(byDevice.get(id), started)
      return { ...view, created }
    },
  }
}
