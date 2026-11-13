import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const TOKENS = path.join(os.homedir(), '.mcp-auth', 'mcp-remote-v1', '44b961529146c9a6dd0768dbf977c4ea_tokens.json')
const token = JSON.parse(fs.readFileSync(TOKENS, 'utf8')).access_token
let sessionId = null
let id = 1

async function mcp(method, params, withId = true) {
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  }
  if (sessionId) headers['mcp-session-id'] = sessionId
  const body = withId ? { jsonrpc: '2.0', id: id++, method, params } : { jsonrpc: '2.0', method, params }
  const res = await fetch('https://appsumo.com/mcp/', {
    method: 'POST', headers, body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  })
  const sid = res.headers.get('mcp-session-id')
  if (sid) sessionId = sid
  if (!withId) return null
  const text = await res.text()
  const ct = res.headers.get('content-type') || ''
  if (ct.includes('text/event-stream')) {
    const datas = []
    for (const line of text.split(/\r?\n/)) if (line.startsWith('data:')) datas.push(line.slice(5).trim())
    return JSON.parse(datas.filter(Boolean).join('\n'))
  }
  return JSON.parse(text)
}
async function tool(name, args={}) {
  const r = await mcp('tools/call', { name, arguments: args })
  if (r.error) return r
  const t = r.result?.content?.[0]?.text
  try { return JSON.parse(t) } catch { return r.result }
}

await mcp('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'meatola-agent', version: '1.0.0' } })
await mcp('notifications/initialized', {}, false)

const [sub, fulfill, codesUpload] = await Promise.all([
  tool('get_submission', { submission_id: 235368 }),
  tool('get_fulfillment', { submission_id: 235368 }),
  tool('request_codes_upload', { submission_id: 235368 }),
])

const s = sub.submission || {}
const summary = {
  product_type: s.product_type,
  planType: s.planType,
  plans: (s.plans || []).map(p => ({
    id: p.id,
    name: p.public_name,
    codes: p.codes,
    price_per_code: p.price,
    original_tier_total: p.original_price,
    tier_total: (Number(p.price) * Number(p.codes)).toFixed(2),
    features: (p.features || []).map(f => f.feature),
  })),
  matrix: s.pricing_table_matrix,
  redemption_url: sub.redemption_url,
  redemption_instructions: s.redemption_instructions,
  code_stacking_instructions: s.code_stacking_instructions,
  has_codes: sub.has_codes,
  codes_files: sub.codes_files,
  codes_remaining: sub.codes_remaining,
  min_codes_to_upload: sub.min_codes_to_upload,
  max_codes_to_upload: sub.max_codes_to_upload,
  fulfillment: fulfill,
  codes_upload_meta: codesUpload.error ? codesUpload : {
    min_codes: codesUpload.min_codes,
    max_codes: codesUpload.max_codes,
    existing_files: codesUpload.existing_files,
    max_bytes: codesUpload.max_bytes,
    warnings: codesUpload.warnings,
    keys: Object.keys(codesUpload),
  },
}
console.log(JSON.stringify(summary, null, 2))
