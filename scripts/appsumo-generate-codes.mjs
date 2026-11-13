import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const CODE_PATTERN = /^ANN-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/
const BATCH_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

export function createCode(bytes) {
  const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  if (source.length < 12) throw new Error('code entropy')
  let raw = ''
  for (let i = 0; i < 12; i += 1) raw += ALPHABET[source[i] % 32]
  return `ANN-${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`
}

export function createCodes(count, randomBytes = (size) => crypto.randomBytes(size)) {
  const total = Number(count)
  if (!Number.isInteger(total) || total < 1) throw new Error('count')
  const codes = new Set()
  while (codes.size < total) codes.add(createCode(randomBytes(12)))
  return [...codes]
}

export function renderCsv(codes) {
  return `code\n${codes.join('\n')}\n`
}

export function renderSql(codes, batch) {
  if (!BATCH_PATTERN.test(batch)) throw new Error('batch')
  const values = codes.map((code) => {
    if (!CODE_PATTERN.test(code)) throw new Error('code')
    return `  ('${code}', '${batch}')`
  })
  return `insert into public.appsumo_codes (code, batch)\nvalues\n${values.join(',\n')}\non conflict (code) do nothing;\n`
}

export function renderJson(codes, batch) {
  return `${JSON.stringify({ batch, codes }, null, 2)}\n`
}

function flag(name) {
  const index = process.argv.indexOf(name)
  if (index < 0 || index + 1 >= process.argv.length) return ''
  return process.argv[index + 1]
}

function main() {
  const count = flag('--count') ? Number(flag('--count')) : 1000
  if (!Number.isInteger(count) || count < 1 || count > 100_000) {
    console.error('Usage: bun scripts/appsumo-generate-codes.mjs [--count 1000] [--out .appsumo-codes]')
    process.exit(1)
  }
  const batch = flag('--batch') || `appsumo-${new Date().toISOString().slice(0, 10)}-${crypto.randomBytes(3).toString('hex')}`
  if (!BATCH_PATTERN.test(batch)) {
    console.error('Batch ids use letters, numbers, "_" and "-" only.')
    process.exit(1)
  }
  const outDir = path.resolve(flag('--out') || '.appsumo-codes')
  const codes = createCodes(count)
  fs.mkdirSync(outDir, { recursive: true })
  const csvPath = path.join(outDir, 'codes.csv')
  const sqlPath = path.join(outDir, 'appsumo_codes.sql')
  const jsonPath = path.join(outDir, 'appsumo_codes.json')
  fs.writeFileSync(csvPath, renderCsv(codes))
  fs.writeFileSync(sqlPath, renderSql(codes, batch))
  fs.writeFileSync(jsonPath, renderJson(codes, batch))
  console.log(`Wrote ${codes.length} codes`)
  console.log(csvPath)
  console.log(sqlPath)
  console.log(jsonPath)
  console.log(`batch ${batch}`)
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : ''
if (entry && fileURLToPath(import.meta.url) === entry) main()
