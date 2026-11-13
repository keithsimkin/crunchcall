import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { resolveOAuthConfig } = require('../electron/calendar-accounts.cjs')

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const localPath = process.env.CRUNCHCALL_OAUTH_LOCAL || path.join(root, 'electron', 'oauth.local.json')
const outPath = process.env.CRUNCHCALL_OAUTH_OUT || path.join(root, 'electron', 'oauth.json')

function readJson(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

const config = resolveOAuthConfig({
  env: process.env,
  local: readJson(localPath),
  packaged: {},
})

const body = {
  googleClientId: config.googleClientId,
  googleClientSecret: config.googleClientSecret,
  microsoftClientId: config.microsoftClientId,
}

fs.mkdirSync(path.dirname(outPath), { recursive: true })
fs.writeFileSync(outPath, `${JSON.stringify(body, null, 2)}\n`, { mode: 0o600 })

const parts = []
if (body.googleClientId) parts.push('Google client id')
if (body.googleClientSecret) parts.push('Google client secret')
if (body.microsoftClientId) parts.push('Microsoft client id')
const destination = path.relative(root, outPath) || outPath
console.log(`Wrote ${destination} (${parts.join(', ') || 'empty'}).`)
if (!body.googleClientSecret) {
  console.warn(
    'Google client secret is missing. Connect Google stays hidden until CRUNCHCALL_GOOGLE_CLIENT_SECRET or electron/oauth.local.json provides googleClientSecret.',
  )
}
