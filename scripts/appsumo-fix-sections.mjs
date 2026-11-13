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

const fields = JSON.parse(fs.readFileSync('C:/TREA/meatola/.appsumo-fix-sections.json', 'utf8'))
const result = await tool('update_submission', { submission_id: 235368, fields })
if (result.error) {
  console.log(JSON.stringify(result, null, 2))
  process.exit(1)
}
fs.writeFileSync('C:/TREA/meatola/.appsumo-submission-235368.parsed.json', JSON.stringify(result, null, 2))
const s = result.submission || {}
console.log(JSON.stringify({
  features: s.story?.features,
  plans: (s.plans || []).map(p => ({
    name: p.public_name,
    codes: p.codes,
    price: p.price,
    original: p.original_price,
    total: (Number(p.price) * Number(p.codes)).toFixed(2),
  })),
  matrix: s.pricing_table_matrix,
  founder_posts: s.company?.founder_posts,
  contacts: s.contacts,
  founders_data: s.founders_data,
}, null, 2))
