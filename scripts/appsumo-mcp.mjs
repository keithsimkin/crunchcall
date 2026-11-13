import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { pathToFileURL } from 'node:url'

const TOKENS = path.join(os.homedir(), '.mcp-auth', 'mcp-remote-v1', '44b961529146c9a6dd0768dbf977c4ea_tokens.json')

function loadToken() {
  const tokens = JSON.parse(fs.readFileSync(TOKENS, 'utf8'))
  return tokens.access_token
}

export async function withAppsumo(fn) {
  const token = loadToken()
  let sessionId = null
  let id = 1

  async function mcp(method, params, withId = true) {
    const headers = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    }
    if (sessionId) headers['mcp-session-id'] = sessionId
    const body = withId
      ? { jsonrpc: '2.0', id: id++, method, params }
      : { jsonrpc: '2.0', method, params }
    const res = await fetch('https://appsumo.com/mcp/', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })
    const sid = res.headers.get('mcp-session-id')
    if (sid) sessionId = sid
    if (!withId) return null
    const text = await res.text()
    const ct = res.headers.get('content-type') || ''
    if (ct.includes('text/event-stream')) {
      const datas = []
      for (const line of text.split(/\r?\n/)) {
        if (line.startsWith('data:')) datas.push(line.slice(5).trim())
      }
      return JSON.parse(datas.filter(Boolean).join('\n'))
    }
    return JSON.parse(text)
  }

  await mcp('initialize', {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'meatola-agent', version: '1.0.0' },
  })
  await mcp('notifications/initialized', {}, false)

  async function tool(name, args = {}) {
    const r = await mcp('tools/call', { name, arguments: args })
    if (r.error) return r
    const t = r.result?.content?.[0]?.text
    if (t == null) return r.result
    try {
      return JSON.parse(t)
    } catch {
      return { text: t, raw: r.result }
    }
  }

  return fn({ mcp, tool })
}

const isDirect = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
if (isDirect) {
  const name = process.argv[2]
  const args = process.argv[3] ? JSON.parse(process.argv[3]) : {}
  if (!name) {
    console.error('Usage: node scripts/appsumo-mcp.mjs <tool> [json-args]')
    process.exit(1)
  }
  const result = await withAppsumo(({ tool }) => tool(name, args))
  console.log(JSON.stringify(result, null, 2))
}
