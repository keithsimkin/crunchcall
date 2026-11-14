import { copyFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const stage = join(root, 'native', 'stage')
const preferred = process.platform === 'win32' ? 'crunchcalld.exe' : 'crunchcalld'
const candidates = [
  join(root, 'native', 'target', 'release', preferred),
  join(root, 'native', 'target', 'debug', preferred),
  join(root, 'native', 'target', 'release', 'crunchcalld.exe'),
  join(root, 'native', 'target', 'debug', 'crunchcalld.exe'),
  join(root, 'native', 'target', 'release', 'crunchcalld'),
  join(root, 'native', 'target', 'debug', 'crunchcalld'),
]

mkdirSync(stage, { recursive: true })
for (const name of readdirSync(stage)) {
  unlinkSync(join(stage, name))
}

const source = candidates.find((path) => existsSync(path))
if (!source) {
  console.warn('stage-engine: no crunchcalld binary found under native/target; installer will ship without the local engine')
  process.exit(0)
}

const destName = source.endsWith('.exe') ? 'crunchcalld.exe' : 'crunchcalld'
const dest = join(stage, destName)
copyFileSync(source, dest)
console.log(`stage-engine: ${source} -> ${dest}`)
