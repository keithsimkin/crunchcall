const { app, BrowserWindow } = require('electron')
const { autoUpdater } = require('electron-updater')

let state = { phase: 'idle', version: '', percent: 0 }
let installOnDownload = false

function snapshot(next) {
  state = {
    phase: next.phase,
    version: typeof next.version === 'string' ? next.version : '',
    percent: typeof next.percent === 'number' ? Math.max(0, Math.min(100, Math.round(next.percent))) : 0,
  }
  return state
}

function broadcast() {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('update:status', state)
  }
}

function publish(next) {
  snapshot(next)
  broadcast()
}

function startUpdater(allowQuit) {
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  if (!app.isPackaged) autoUpdater.forceDevUpdateConfig = true

  autoUpdater.on('update-available', (info) => {
    publish({ phase: 'available', version: info && info.version, percent: 0 })
  })

  autoUpdater.on('update-not-available', () => {
    installOnDownload = false
    publish({ phase: 'current', version: app.getVersion(), percent: 0 })
  })

  autoUpdater.on('download-progress', (progress) => {
    publish({
      phase: 'downloading',
      version: state.version,
      percent: progress && progress.percent,
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    publish({ phase: 'downloaded', version: info && info.version, percent: 100 })
    if (!installOnDownload) return
    installOnDownload = false
    allowQuit()
    autoUpdater.quitAndInstall(true, true)
  })

  autoUpdater.on('error', () => {
    installOnDownload = false
    if (state.phase === 'downloading') {
      publish({ phase: 'available', version: state.version, percent: 0 })
      return
    }
    publish({ phase: 'current', version: app.getVersion(), percent: 0 })
  })
}

async function checkForAppUpdate() {
  publish({ phase: 'checking', version: app.getVersion(), percent: 0 })
  try {
    const result = await autoUpdater.checkForUpdates()
    if (!result) publish({ phase: 'current', version: app.getVersion(), percent: 0 })
  } catch {
    publish({ phase: 'current', version: app.getVersion(), percent: 0 })
  }
  return state
}

async function installUpdate() {
  if (state.phase === 'downloading' || state.phase === 'downloaded') return state
  if (state.phase !== 'available') return state
  installOnDownload = true
  publish({ phase: 'downloading', version: state.version, percent: 0 })
  try {
    await autoUpdater.downloadUpdate()
  } catch {
    installOnDownload = false
    publish({ phase: 'available', version: state.version, percent: 0 })
  }
  return state
}

function updateStatus() {
  return state
}

module.exports = {
  startUpdater,
  checkForAppUpdate,
  installUpdate,
  updateStatus,
}
