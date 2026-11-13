const DEVICE_PATTERN = /^[a-f0-9]{64}$/

export function normalizeDeviceId(value) {
  if (typeof value !== 'string') return ''
  const id = value.trim().toLowerCase()
  if (!DEVICE_PATTERN.test(id)) return ''
  return id
}

export function normalizeLabel(value) {
  if (typeof value !== 'string') return ''
  let out = ''
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i)
    if (code >= 32 && code !== 127) out += value[i]
  }
  return out.trim().slice(0, 80)
}

export function decideActivation({ maxDevices, deviceIds, deviceId }) {
  if (maxDevices == null) return { ok: true, limited: false, action: 'none' }
  const limit = Number(maxDevices)
  if (!Number.isInteger(limit) || limit < 1) return { ok: false, reason: 'unavailable' }
  const ids = Array.isArray(deviceIds) ? deviceIds : []
  if (ids.includes(deviceId)) return { ok: true, limited: true, maxDevices: limit, action: 'touch' }
  if (ids.length >= limit) return { ok: false, reason: 'limit_reached', maxDevices: limit }
  return { ok: true, limited: true, maxDevices: limit, action: 'insert' }
}

export function mapSeat(payload) {
  if (!payload || typeof payload !== 'object') return { ok: false, reason: 'unavailable' }
  const maxDevices = Number.isInteger(payload.maxDevices) ? payload.maxDevices : null
  if (payload.ok === true) return { ok: true, limited: payload.limited === true, maxDevices }
  const reason = typeof payload.reason === 'string' && payload.reason ? payload.reason : 'unavailable'
  return { ok: false, reason, maxDevices }
}

function serviceHeaders(serviceKey) {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
  }
}

export function createSupabaseSeats({ url, serviceKey, fetchImpl }) {
  const root = String(url || '').replace(/\/$/, '')
  const fetchFn = fetchImpl || fetch

  async function rpc(name, args) {
    let response
    try {
      response = await fetchFn(`${root}/rest/v1/rpc/${name}`, {
        method: 'POST',
        headers: serviceHeaders(serviceKey),
        body: JSON.stringify(args),
      })
    } catch {
      return { ok: false, reason: 'unavailable' }
    }
    const payload = await response.json().catch(() => null)
    if (!response.ok) return { ok: false, reason: 'unavailable' }
    return mapSeat(payload)
  }

  return {
    activate({ orderId, email, deviceId, deviceLabel }) {
      return rpc('activate_license_device', {
        p_order_id: orderId,
        p_email: email,
        p_device_id: deviceId,
        p_device_label: deviceLabel || '',
      })
    },
    deactivate({ orderId, email, deviceId }) {
      return rpc('deactivate_license_device', {
        p_order_id: orderId,
        p_email: email,
        p_device_id: deviceId,
      })
    },
  }
}
