import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, test } from 'bun:test'
import { DEFAULT_GOOGLE_CLIENT_ID } from '../electron/calendar-accounts.cjs'

const temps = []
const script = new URL('./write-oauth-config.mjs', import.meta.url)

afterEach(() => {
  for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

test('the pack step writes oauth.json from env without printing the secret', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crunchcall-oauth-pack-'))
  temps.push(dir)
  const out = path.join(dir, 'oauth.json')
  const env = { ...process.env }
  delete env.CRUNCHCALL_GOOGLE_CLIENT_ID
  delete env.CRUNCHCALL_MICROSOFT_CLIENT_ID
  env.CRUNCHCALL_GOOGLE_CLIENT_SECRET = 'super-secret-value'
  env.CRUNCHCALL_OAUTH_LOCAL = path.join(dir, 'missing.json')
  env.CRUNCHCALL_OAUTH_OUT = out

  const result = spawnSync(process.execPath, [script.pathname], { env, encoding: 'utf8' })
  expect(result.status).toBe(0)
  expect(result.stdout).not.toContain('super-secret-value')
  expect(result.stderr).not.toContain('super-secret-value')
  expect(result.stderr).not.toContain('missing')
  expect(JSON.parse(fs.readFileSync(out, 'utf8'))).toEqual({
    googleClientId: DEFAULT_GOOGLE_CLIENT_ID,
    googleClientSecret: 'super-secret-value',
    microsoftClientId: '',
  })
})

test('a local file fills fields the environment leaves empty', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crunchcall-oauth-pack-'))
  temps.push(dir)
  const local = path.join(dir, 'oauth.local.json')
  const out = path.join(dir, 'oauth.json')
  fs.writeFileSync(
    local,
    JSON.stringify({
      googleClientId: 'local-google-client',
      googleClientSecret: 'local-secret-value',
      microsoftClientId: 'local-ms-client',
    }),
  )
  const env = { ...process.env }
  delete env.CRUNCHCALL_GOOGLE_CLIENT_ID
  delete env.CRUNCHCALL_GOOGLE_CLIENT_SECRET
  delete env.CRUNCHCALL_MICROSOFT_CLIENT_ID
  env.CRUNCHCALL_OAUTH_LOCAL = local
  env.CRUNCHCALL_OAUTH_OUT = out

  const result = spawnSync(process.execPath, [script.pathname], { env, encoding: 'utf8' })
  expect(result.status).toBe(0)
  expect(result.stdout).not.toContain('local-secret-value')
  expect(JSON.parse(fs.readFileSync(out, 'utf8'))).toEqual({
    googleClientId: 'local-google-client',
    googleClientSecret: 'local-secret-value',
    microsoftClientId: 'local-ms-client',
  })
})

test('a pack without a google secret warns and still writes the public client id', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crunchcall-oauth-pack-'))
  temps.push(dir)
  const out = path.join(dir, 'oauth.json')
  const env = { ...process.env }
  delete env.CRUNCHCALL_GOOGLE_CLIENT_ID
  delete env.CRUNCHCALL_GOOGLE_CLIENT_SECRET
  delete env.CRUNCHCALL_MICROSOFT_CLIENT_ID
  env.CRUNCHCALL_OAUTH_LOCAL = path.join(dir, 'missing.json')
  env.CRUNCHCALL_OAUTH_OUT = out

  const result = spawnSync(process.execPath, [script.pathname], { env, encoding: 'utf8' })
  expect(result.status).toBe(0)
  expect(result.stderr).toContain('Google client secret is missing')
  expect(JSON.parse(fs.readFileSync(out, 'utf8')).googleClientId).toBe(DEFAULT_GOOGLE_CLIENT_ID)
  expect(JSON.parse(fs.readFileSync(out, 'utf8')).googleClientSecret).toBe('')
})
