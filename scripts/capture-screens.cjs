// Captures App Store screenshots, or a walkthrough video, from the desktop app in demo mode.
//
// Local / CI (this repo), after `bun run build`:
//   node scripts/capture-screens.cjs ./captures
//   node scripts/capture-screens.cjs --record ./tour
//
// Installed Windows app:
//   "%LOCALAPPDATA%\Programs\annotated\annotated.exe" --demo --capture C:\path
//   "%LOCALAPPDATA%\Programs\annotated\annotated.exe" --demo --record C:\path
//
// --demo (or ANNOTATED_DEMO=1) uses %APPDATA%\annotated-demo and never the real profile.
// --record writes walkthrough.webm, walkthrough.json, overlay.webm, and overlay.json.
const { spawn } = require('child_process')
const fs = require('fs')
const path = require('path')

const record = process.argv.includes('--record')
const outArg = process.argv.find((arg, index) => index > 1 && !arg.startsWith('--'))
const outDir = path.resolve(outArg || path.join(process.cwd(), record ? 'tour' : 'captures'))
const electron = require('electron')
const root = path.join(__dirname, '..')

if (!fs.existsSync(path.join(root, 'dist', 'index.html'))) {
  console.error('dist/index.html is missing. Run `bun run build` first.')
  process.exit(1)
}

fs.mkdirSync(outDir, { recursive: true })

const child = spawn(
  electron,
  [root, '--demo', record ? '--record' : '--capture', outDir, '--no-sandbox', '--disable-gpu'],
  {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, ANNOTATED_DEMO: '1' },
})

child.on('exit', (code) => {
  if (code !== 0) process.exit(code || 1)
  if (record) {
    const names = ['walkthrough.webm', 'walkthrough.json', 'overlay.webm', 'overlay.json']
    const missing = names.filter((name) => !fs.existsSync(path.join(outDir, name)) || fs.statSync(path.join(outDir, name)).size < 32)
    if (missing.length) {
      console.error(`missing recording files: ${missing.join(', ')}`)
      process.exit(1)
    }
    const chapters = JSON.parse(fs.readFileSync(path.join(outDir, 'walkthrough.json'), 'utf8'))
    if (!Array.isArray(chapters) || chapters.length < 8) {
      console.error('walkthrough.json is missing chapters')
      process.exit(1)
    }
    const webm = fs.readFileSync(path.join(outDir, 'walkthrough.webm'))
    if (webm[0] !== 0x1a || webm[1] !== 0x45 || webm[2] !== 0xdf || webm[3] !== 0xa3) {
      console.error('walkthrough.webm is not a WebM file')
      process.exit(1)
    }
    console.log(`record ok ${chapters.length} chapters → ${outDir}`)
    return
  }
  const names = [
    'home',
    'notes',
    'live',
    'dictate',
    'calendar',
    'projects',
    'shortcuts',
    'ask',
    'connect',
    'settings',
    'overlay',
  ]
  const missing = names.filter((name) => !fs.existsSync(path.join(outDir, `${name}.png`)))
  if (missing.length) {
    console.error(`missing captures: ${missing.join(', ')}`)
    process.exit(1)
  }
  const home = fs.readFileSync(path.join(outDir, 'home.png'))
  const width = home.readUInt32BE(16)
  const height = home.readUInt32BE(20)
  if (width < 1440 || height < 900) {
    console.error(`home.png is ${width}x${height}, expected at least 1440x900`)
    process.exit(1)
  }
  console.log(`capture ok ${width}x${height} → ${outDir}`)
})
