const path = require('path')

const CAPTURE_SCREENS = [
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
]

function readFlag(argv, name) {
  const prefix = `--${name}=`
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === `--${name}`) {
      const next = argv[i + 1]
      if (next && !next.startsWith('-')) return next
      return ''
    }
    if (typeof arg === 'string' && arg.startsWith(prefix)) return arg.slice(prefix.length)
  }
  return null
}

function demoRequested(argv = process.argv, env = process.env) {
  if (env && env.ANNOTATED_DEMO === '1') return true
  if (argv.includes('--demo')) return true
  // A capture always uses the demo profile so it cannot write a real account.
  return readFlag(argv, 'capture') !== null
}

function captureDirectory(argv = process.argv) {
  const value = readFlag(argv, 'capture')
  if (!value) return null
  return path.resolve(value)
}

function demoUserDataPath(appData) {
  return path.join(appData, 'annotated-demo')
}

function demoLicenseStatus() {
  return {
    tier: 'unlock',
    email: 'alex.rivera@fieldnote.example',
    order: 'demo-fieldnote',
    license: 'valid',
    authenticity: 'development',
    signer: '',
    detail: 'Demo profile. Your real notes are untouched.',
    seat: 'active',
    seatDetail: '',
  }
}

function demoOverlaySession() {
  return {
    meetingId: 'live-product',
    title: 'Product sync',
    elapsed: '18:42',
    listening: true,
    opacity: 0.94,
    position: 'center',
    cue: {
      label: 'Missing date',
      message: 'Jon named the share test without a day. Ask for one before you leave.',
    },
    lines: [
      { id: 'l6', speaker: 'Priya', text: 'What model size did we pick? And is tiny enough for a first run?' },
      { id: 'l7', speaker: 'You', text: 'Tiny on first run. Small if the machine can hold it.' },
      { id: 'l8', speaker: 'Jon', text: 'So the next step is the share test, but we have not named a day.' },
    ],
  }
}

function surfaceHash(hash, demo) {
  if (!demo) return hash
  if (String(hash).includes('demo=')) return hash
  return `${hash}${String(hash).includes('?') ? '&' : '?'}demo=1`
}

module.exports = {
  CAPTURE_SCREENS,
  readFlag,
  demoRequested,
  captureDirectory,
  demoUserDataPath,
  demoLicenseStatus,
  demoOverlaySession,
  surfaceHash,
}
