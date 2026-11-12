const { app, BrowserWindow, ipcMain, nativeImage, Notification, Tray, Menu, globalShortcut, clipboard, screen, shell, safeStorage, session, desktopCapturer } =
  require('electron')
const path = require('path')
const { execFile } = require('child_process')
const sidecar = require('./sidecar.cjs')
const { createCalendarAccounts, loadClientIds } = require('./calendar-accounts.cjs')
const updates = require('./updates.cjs')
const license = require('./license.cjs')

const BUY_URL = 'https://annotated.click/buy'
const ACCOUNT_URL = 'https://annotated.click/account'

const devUrl = process.env.CRUNCHCALL_DEV_URL || 'http://127.0.0.1:5173/#app'
const iconPath = path.join(__dirname, process.platform === 'win32' ? 'icon.ico' : 'icon.png')
const trayIconPath = path.join(__dirname, process.platform === 'win32' ? 'icon-16.png' : 'icon.png')
const appIcon = nativeImage.createFromPath(iconPath)
const trayIcon = nativeImage.createFromPath(trayIconPath)

// Windows paints the taskbar from a shortcut that carries this id. The tray is
// given icon-16.png directly, but `electron .` is electron.exe, so the taskbar
// stays the Electron mark until a shortcut points at icon.ico.
const APP_USER_MODEL_ID = 'click.annotated.app'

// The window chrome is drawn by the app itself: no OS title bar, just the
// native caption buttons floating on the same canvas colour as the sidebar.
const titleBarHeight = 40
const chromeThemes = {
  dark: { canvas: '#0c0c0e', symbol: '#a1a1aa' },
  light: { canvas: '#f0f0ec', symbol: '#5f5f5a' },
}

let win = null
let dictateWin = null
let tray = null
let watching = false
let quitting = false
let toldTray = false
let dictateArmed = false
let overlayWin = null
let loopbackArmed = false
let authenticity = license.describeAuthenticity({ packaged: app.isPackaged, signature: null })

app.setAppUserModelId(APP_USER_MODEL_ID)

function windowsLaunch() {
  if (app.isPackaged) {
    const cwd = path.dirname(process.execPath)
    return { cwd, args: '', command: `"${process.execPath}"` }
  }
  const cwd = app.getAppPath()
  const args = `"${cwd}"`
  return { cwd, args, command: `"${process.execPath}" ${args}` }
}

function ensureWindowsTaskbarIcon() {
  if (process.platform !== 'win32' || app.isPackaged) return
  const { cwd, args } = windowsLaunch()
  const programs = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs')
  const shortcutPath = path.join(programs, 'annotated.lnk')
  try {
    require('fs').unlinkSync(path.join(programs, 'CrunchCall.lnk'))
  } catch {
    // The previous shortcut is already gone.
  }
  try {
    shell.writeShortcutLink(shortcutPath, 'create', {
      target: process.execPath,
      args,
      cwd,
      icon: iconPath,
      iconIndex: 0,
      appUserModelId: APP_USER_MODEL_ID,
      description: 'annotated',
    })
  } catch {
    // A missing shortcut only affects the taskbar glyph. Still open the app.
  }
}

function applyWindowsTaskbarIcon(window) {
  if (process.platform !== 'win32') return
  const { command } = windowsLaunch()
  window.setAppDetails({
    appId: APP_USER_MODEL_ID,
    appIconPath: iconPath,
    appIconIndex: 0,
    relaunchCommand: command,
    relaunchDisplayName: 'annotated',
  })
}

function showMain() {
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

function trayTooltip() {
  return watching ? 'annotated is watching your calendar' : 'annotated'
}

let pendingTrayCommand = null
let flushBound = false
let tooltipTimer = null

function trayMenu() {
  return Menu.buildFromTemplate([
    { label: 'Open annotated', click: showMain },
    { label: 'Open dashboard', click: () => openSection('dashboard') },
    { label: 'Start a meeting', click: () => openSection('meeting') },
    { label: dictateArmed ? 'Stop dictating' : 'Dictate', click: () => toggleDictateHotkey() },
    { type: 'separator' },
    { label: 'Calendar', click: () => openSection('calendar') },
    { label: 'Projects', click: () => openSection('projects') },
    { type: 'separator' },
    { label: 'Settings', click: () => openSection('settings') },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        quitting = true
        app.quit()
      },
    },
  ])
}

function rebuildTrayMenu() {
  if (!tray) return
  tray.setContextMenu(trayMenu())
}

function ensureTray() {
  if (tray) {
    tray.setToolTip(trayTooltip())
    return
  }
  const icon = trayIcon.isEmpty() ? appIcon : trayIcon
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon)
  tray.setToolTip(trayTooltip())
  rebuildTrayMenu()
  tray.on('click', showMain)
}

function openSection(command) {
  showMain()
  deliverCommand(command)
}

function deliverCommand(command) {
  pendingTrayCommand = command
  flushCommand()
}

function flushCommand() {
  const target = win
  if (!target || target.isDestroyed() || !pendingTrayCommand) return
  if (target.webContents.isLoading()) {
    if (flushBound) return
    flushBound = true
    target.webContents.once('did-finish-load', () => {
      flushBound = false
      flushCommand()
    })
    return
  }
  const next = pendingTrayCommand
  pendingTrayCommand = null
  target.webContents.send('app:command', next)
}

function loadSurface(target, hash) {
  if (!app.isPackaged) {
    try {
      const url = new URL(devUrl)
      url.hash = hash
      target.loadURL(url.toString())
      return
    } catch {
      target.loadURL(`http://127.0.0.1:5173/#${hash}`)
      return
    }
  }
  target.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { hash })
}

function releaseLink(value) {
  let parsed
  try {
    parsed = new URL(String(value || ''))
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'github.com') return null
  if (!parsed.pathname.startsWith('/keithsimkin/crunchcall')) return null
  return parsed.toString()
}

function announce(payload) {
  const title = payload && typeof payload.title === 'string' ? payload.title.slice(0, 120).trim() : ''
  if (!title) return
  const body = payload && typeof payload.body === 'string' ? payload.body.slice(0, 180).trim() : ''
  const url = payload && payload.url ? releaseLink(payload.url) : null
  if (tray) {
    tray.setToolTip(`${title}${body ? `. ${body}` : ''}`.slice(0, 120))
    clearTimeout(tooltipTimer)
    tooltipTimer = setTimeout(() => {
      if (tray) tray.setToolTip(trayTooltip())
    }, 5000)
  }
  if (payload && payload.focus) showMain()
  if (!Notification.isSupported()) return
  const note = new Notification({ title, body: body || title })
  if (url) note.on('click', () => shell.openExternal(url))
  note.show()
}

function ensureDictateBar() {
  if (dictateWin && !dictateWin.isDestroyed()) return dictateWin
  const display = screen.getPrimaryDisplay().workArea
  const width = 420
  const height = 88
  dictateWin = new BrowserWindow({
    width,
    height,
    x: Math.round(display.x + (display.width - width) / 2),
    y: Math.round(display.y + display.height - height - 28),
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  })
  dictateWin.setAlwaysOnTop(true, 'screen-saver')
  dictateWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  loadSurface(dictateWin, 'dictate-bar')
  dictateWin.on('closed', () => {
    dictateWin = null
    dictateArmed = false
    rebuildTrayMenu()
  })
  return dictateWin
}

function showDictateBar() {
  const bar = ensureDictateBar()
  if (bar.isMinimized()) bar.restore()
  bar.showInactive()
  bar.moveTop()
}

function hideDictateBar() {
  dictateArmed = false
  rebuildTrayMenu()
  if (!dictateWin || dictateWin.isDestroyed()) return
  dictateWin.hide()
}

function toggleDictateHotkey() {
  const bar = ensureDictateBar()
  if (!dictateArmed) {
    dictateArmed = true
    showDictateBar()
    rebuildTrayMenu()
    bar.webContents.send('dictate:hotkey', 'start')
    return
  }
  dictateArmed = false
  bar.webContents.send('dictate:hotkey', 'stop')
  rebuildTrayMenu()
}

function pasteText(text) {
  const value = String(text || '')
  if (!value) return Promise.resolve()
  clipboard.writeText(value)
  return new Promise((resolve) => {
    // Give the focused app a beat, then paste. Hide our bar first so focus returns.
    hideDictateBar()
    setTimeout(() => {
      if (process.platform === 'darwin') {
        execFile('osascript', ['-e', 'tell application "System Events" to keystroke "v" using command down'], () =>
          resolve(),
        )
        return
      }
      if (process.platform === 'win32') {
        execFile(
          'powershell',
          [
            '-NoProfile',
            '-Command',
            "Start-Sleep -Milliseconds 120; (New-Object -ComObject WScript.Shell).SendKeys('^v')",
          ],
          () => resolve(),
        )
        return
      }
      execFile('xdotool', ['key', 'ctrl+v'], () => resolve())
    }, 80)
  })
}

function ensureOverlay() {
  if (overlayWin && !overlayWin.isDestroyed()) return overlayWin
  const display = screen.getPrimaryDisplay().workArea
  const width = 320
  const height = 150
  overlayWin = new BrowserWindow({
    width,
    height,
    x: Math.round(display.x + display.width - width - 24),
    y: Math.round(display.y + 24),
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    skipTaskbar: true,
    focusable: false,
    alwaysOnTop: true,
    hasShadow: false,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  })
  overlayWin.setAlwaysOnTop(true, 'screen-saver')
  overlayWin.setContentProtection(true)
  overlayWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  loadSurface(overlayWin, 'overlay')
  overlayWin.on('closed', () => {
    overlayWin = null
  })
  return overlayWin
}

function createWindow() {
  const isMac = process.platform === 'darwin'
  const chrome = chromeThemes.dark
  win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 900,
    minHeight: 640,
    backgroundColor: chrome.canvas,
    title: 'annotated',
    icon: appIcon.isEmpty() ? undefined : appIcon,
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    ...(isMac
      ? {}
      : { titleBarOverlay: { color: chrome.canvas, symbolColor: chrome.symbol, height: titleBarHeight } }),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  })

  applyWindowsTaskbarIcon(win)
  win.once('ready-to-show', () => {
    if (!appIcon.isEmpty()) win.setIcon(appIcon)
    win.show()
  })
  win.on('close', (event) => {
    // Keep the process alive in the tray. Quit only from the tray menu.
    if (quitting) return
    event.preventDefault()
    win.hide()
    ensureTray()
    if (toldTray || !Notification.isSupported()) return
    toldTray = true
    new Notification({
      title: 'annotated is still running',
      body: watching
        ? 'You will get a prompt when a meeting starts. Quit from the tray icon to stop.'
        : 'Quit from the tray icon when you are done. Hold Ctrl+Win to dictate anywhere.',
    }).show()
  })
  loadSurface(win, 'app')
}

function readableError(error) {
  if (error && error.name === 'AbortError') return 'The calendar took too long to answer.'
  return "Couldn't reach that calendar."
}

let calendarAccounts = null

function accounts() {
  if (calendarAccounts) return calendarAccounts
  calendarAccounts = createCalendarAccounts({
    file: path.join(app.getPath('userData'), 'calendar-accounts.json'),
    encrypt: (text) => {
      if (!safeStorage.isEncryptionAvailable()) return null
      return safeStorage.encryptString(text).toString('base64')
    },
    decrypt: (encoded) => safeStorage.decryptString(Buffer.from(encoded, 'base64')),
    openExternal: (url) => shell.openExternal(url),
    clientIds: loadClientIds(),
  })
  return calendarAccounts
}

function asProvider(value) {
  return value === 'google' || value === 'microsoft' ? value : null
}

function asCalendars(value) {
  if (!Array.isArray(value)) return []
  const chosen = []
  for (const item of value) {
    if (!item || typeof item.id !== 'string' || typeof item.name !== 'string') continue
    const id = item.id.trim()
    const name = item.name.replace(/\s+/g, ' ').trim()
    if (!id || id.length > 1024 || !name || name.length > 200) continue
    chosen.push({ id, name })
    if (chosen.length >= 20) break
  }
  return chosen
}

function asRange(value) {
  if (!value || typeof value.start !== 'number' || typeof value.end !== 'number') return null
  if (!Number.isFinite(value.start) || !Number.isFinite(value.end)) return null
  const span = value.end - value.start
  if (span <= 0 || span > 40 * 24 * 60 * 60 * 1000) return null
  return { start: value.start, end: value.end }
}

ipcMain.handle('calendar:sign-in', () => accounts().status())

ipcMain.handle('calendar:connect', (_event, provider) => {
  const name = asProvider(provider)
  if (!name) return { ok: false, error: 'Choose Google or Outlook.' }
  return accounts().connect(name)
})

ipcMain.handle('calendar:choices', (_event, provider) => {
  const name = asProvider(provider)
  if (!name) return { ok: false, error: 'Choose Google or Outlook.' }
  return accounts().list(name)
})

ipcMain.handle('calendar:sync-account', (_event, provider, calendars, range) => {
  const name = asProvider(provider)
  if (!name) return { ok: false, error: 'Choose Google or Outlook.' }
  const chosen = asCalendars(calendars)
  const window = asRange(range)
  if (chosen.length === 0) return { ok: false, error: 'Choose at least one calendar.' }
  if (!window) return { ok: false, error: "Couldn't read that calendar window." }
  return accounts().sync(name, chosen, window)
})

ipcMain.handle('calendar:disconnect', (_event, provider) => {
  const name = asProvider(provider)
  if (!name) return
  accounts().disconnect(name)
})

ipcMain.handle('calendar:cancel-sign-in', () => {
  accounts().cancel()
})

ipcMain.handle('calendar:fetch', async (_event, url) => {
  let parsed
  try {
    parsed = new URL(String(url))
  } catch {
    return { ok: false, error: 'That link is not a valid address.' }
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, error: 'Use an https calendar link.' }
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 20_000)
  try {
    const response = await fetch(parsed, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { Accept: 'text/calendar, text/plain, */*', 'User-Agent': 'annotated' },
    })
    if (!response.ok) return { ok: false, error: `The calendar site returned ${response.status}.` }
    const text = await response.text()
    if (text.length > 5_000_000) return { ok: false, error: 'That calendar is too large to sync.' }
    return { ok: true, text }
  } catch (error) {
    return { ok: false, error: readableError(error) }
  } finally {
    clearTimeout(timer)
  }
})

ipcMain.handle('calendar:notify', (_event, payload) => {
  if (!payload || typeof payload.instanceKey !== 'string' || typeof payload.title !== 'string') return
  if (!Notification.isSupported()) return
  const note = new Notification({
    title: payload.title.slice(0, 120) || 'Meeting starting',
    body: typeof payload.body === 'string' ? payload.body.slice(0, 180) : 'Turn annotated on for this meeting?',
  })
  note.on('click', () => {
    showMain()
  })
  note.show()
})

ipcMain.handle('calendar:watching', (_event, on) => {
  watching = Boolean(on)
  if (tray) tray.setToolTip(trayTooltip())
})

ipcMain.handle('window:chrome', (event, theme) => {
  const target = BrowserWindow.fromWebContents(event.sender)
  if (!target || target.isDestroyed()) return
  const chrome = theme === 'light' ? chromeThemes.light : chromeThemes.dark
  target.setBackgroundColor(chrome.canvas)
  if (process.platform === 'darwin') return
  try {
    target.setTitleBarOverlay({ color: chrome.canvas, symbolColor: chrome.symbol, height: titleBarHeight })
  } catch {
    /* the window was created without a title bar overlay */
  }
})

ipcMain.handle('engine:call', async (_event, method, params) =>
  sidecar.call(String(method || ''), params && typeof params === 'object' ? params : {}),
)

ipcMain.handle('dictate:paste', async (_event, text) => {
  await pasteText(text)
})

ipcMain.handle('dictate:hide', () => {
  hideDictateBar()
})

ipcMain.handle('app:update-settled', () => {})

ipcMain.handle('update:status', () => updates.updateStatus())

ipcMain.handle('update:install', () => updates.installUpdate())

ipcMain.handle('app:announce', (event, payload) => {
  if (!win || event.sender !== win.webContents) return
  announce(payload)
})

ipcMain.handle('shell:open', async (_event, url) => {
  let parsed
  try {
    parsed = new URL(String(url))
  } catch {
    return
  }
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'github.com') return
  if (!parsed.pathname.startsWith('/keithsimkin/crunchcall')) return
  await shell.openExternal(parsed.toString())
})

ipcMain.handle('audio:arm-loopback', () => {
  loopbackArmed = true
})

function fromMain(event) {
  return Boolean(win && event.sender === win.webContents)
}

function currentLicenseStatus() {
  const stored = license.readStored(app.getPath('userData'), license.bundledPublicKey())
  return license.publicStatus(stored, authenticity)
}

async function refreshAuthenticity() {
  if (!app.isPackaged || process.platform !== 'win32') {
    authenticity = license.describeAuthenticity({ packaged: app.isPackaged, signature: null })
    return
  }
  try {
    const signature = await license.readAuthenticode(process.execPath)
    authenticity = license.describeAuthenticity({ packaged: true, signature })
  } catch {
    authenticity = license.describeAuthenticity({ packaged: true, signature: null })
  }
}

ipcMain.handle('license:status', () => currentLicenseStatus())

ipcMain.handle('license:activate', (event, token) => {
  if (!fromMain(event)) return { ok: false, message: 'Open the main window to add a license.' }
  const saved = license.writeStored(app.getPath('userData'), String(token || ''), license.bundledPublicKey())
  if (!saved.ok) return { ok: false, message: license.explainReason(saved.reason) }
  return { ok: true, status: currentLicenseStatus() }
})

ipcMain.handle('license:clear', (event) => {
  if (!fromMain(event)) return currentLicenseStatus()
  license.clearStored(app.getPath('userData'))
  if (overlayWin && !overlayWin.isDestroyed()) overlayWin.hide()
  return currentLicenseStatus()
})

ipcMain.handle('license:buy', async (event) => {
  if (!fromMain(event)) return
  await shell.openExternal(BUY_URL)
})

ipcMain.handle('license:account', async (event) => {
  if (!fromMain(event)) return
  await shell.openExternal(ACCOUNT_URL)
})

ipcMain.handle('overlay:set', (event, cue) => {
  if (!fromMain(event)) return { ok: false }
  const unlocked = currentLicenseStatus().tier === 'unlock'
  const message = cue && typeof cue.message === 'string' ? cue.message.trim() : ''
  if (!unlocked || !message) {
    if (overlayWin && !overlayWin.isDestroyed()) overlayWin.hide()
    return { ok: false, locked: !unlocked }
  }
  const bar = ensureOverlay()
  bar.setContentProtection(true)
  bar.webContents.send('overlay:cue', {
    label: typeof cue.label === 'string' ? cue.label : 'Live cue',
    message,
  })
  if (bar.isMinimized()) bar.restore()
  bar.showInactive()
})

ipcMain.handle('app:login-get', () => Boolean(app.getLoginItemSettings().openAtLogin))

ipcMain.handle('app:login-set', (_event, on) => {
  app.setLoginItemSettings({ openAtLogin: Boolean(on) })
})

app.whenReady().then(() => {
  void refreshAuthenticity()
  session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    if (!loopbackArmed) {
      callback({})
      return
    }
    loopbackArmed = false
    desktopCapturer
      .getSources({ types: ['screen'] })
      .then((sources) => {
        if (!sources[0]) {
          callback({})
          return
        }
        callback({ video: sources[0], audio: 'loopback' })
      })
      .catch(() => callback({}))
  })
  if (process.platform === 'darwin' && !appIcon.isEmpty()) app.dock.setIcon(appIcon)
  ensureWindowsTaskbarIcon()
  updates.startUpdater(() => {
    quitting = true
  })
  createWindow()
  void updates.checkForAppUpdate()
  // Ctrl+Win on Windows / Ctrl+Cmd on macOS — toggle the system dictate bar.
  const chord = process.platform === 'darwin' ? 'Control+Meta' : 'Control+Super'
  try {
    globalShortcut.register(chord, () => toggleDictateHotkey())
  } catch {
    try {
      globalShortcut.register('CommandOrControl+Alt+Space', () => toggleDictateHotkey())
    } catch {
      /* shortcut unavailable on this machine */
    }
  }
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

app.on('before-quit', () => {
  quitting = true
  sidecar.stop()
})

app.on('window-all-closed', () => {
  app.quit()
})
