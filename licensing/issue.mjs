import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { issueLicense } = require('../electron/license.cjs')

const root = path.join(path.dirname(fileURLToPath(import.meta.url)))

function flag(name) {
  const index = process.argv.indexOf(name)
  if (index < 0 || index + 1 >= process.argv.length) return ''
  return process.argv[index + 1]
}

const email = flag('--email')
const order = flag('--order') || `ord_${Date.now().toString(36)}`
const keyPath = flag('--key') || process.env.ANNOTATED_LICENSE_PRIVATE_KEY || path.join(root, 'private.pem')

if (!email) {
  console.error('Usage: bun licensing/issue.mjs --email buyer@example.com [--order cs_test_123]')
  process.exit(1)
}

const privateKey = fs.readFileSync(keyPath, 'utf8')
const token = issueLicense(privateKey, { email, order, issued: Math.floor(Date.now() / 1000) })
console.log(token)
