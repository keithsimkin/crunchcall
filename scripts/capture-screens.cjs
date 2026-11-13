// Captures App Store screenshots from the desktop app in demo mode.
//
// Local / CI (this repo):
//   bun run build
//   node scripts/capture-screens.cjs ./captures
//
// Installed Windows app:
//   "%LOCALAPPDATA%\Programs\annotated\annotated.exe" --demo --capture C:\path
//
// --demo (or ANNOTATED_DEMO=1) uses %APPDATA%\annotated-demo and never the real profile.
const { spawn } = require('child_process')
const fs = require('fs')
const path = require('path')

const outDir = path.resolve(process.argv[2] || path.join(process.cwd(), 'captures'))
const electron = require('electron')
const root = path.join(__dirname, '..')

if (!fs.existsSync(path.join(root, 'dist', 'index.html'))) {
  console.error('dist/index.html is missing. Run `bun run build` first.')
  process.exit(1)
}

fs.mkdirSync(outDir, { recursive: true })

const child = spawn(electron, [root, '--demo', '--capture', outDir, '--no-sandbox', '--disable-gpu'], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, ANNOTATED_DEMO: '1' },
})

child.on('exit', (code) => {
  if (code !== 0) process.exit(code || 1)
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
