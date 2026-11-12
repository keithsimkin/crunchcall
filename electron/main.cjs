const { app, BrowserWindow, ipcMain, nativeImage, Notification, Tray, Menu, globalShortcut, clipboard, screen, shell } =
  require('electron')
const path = require('path')
const { execFile } = require('child_process')
const sidecar = require('./sidecar.cjs')

const devUrl = process.env.CRUNCHCALL_DEV_URL || 'http://127.0.0.1:5173/#app'
const iconPath = path.join(__dirname, 'icon.png')
const trayIconPath = path.join(__dirname, process.platform === 'win32' ? 'icon-16.png' : 'icon.png')
const appIcon = nativeImage.createFromPath(iconPath)
const trayIcon = nativeImage.createFromPath(trayIconPath)

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

app.setAppUserModelId('CrunchCall')

function showMain() {
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

function trayTooltip() {
  return watching ? 'CrunchCall is watching your calendar' : 'CrunchCall'
}

function ensureTray() {
  if (tray) {
    tray.setToolTip(trayTooltip())
    return
  }
  const icon = trayIcon.isEmpty() ? appIcon : trayIcon
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon)
  tray.setToolTip(trayTooltip())
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open CrunchCall', click: showMain },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          quitting = true
          app.quit()
        },
      },
    ]),
  )
  tray.on('click', showMain)
}

function barUrl() {
  try {
    const url = new URL(devUrl)
    url.hash = 'dictate-bar'
    return url.toString()
  } catch {
    return 'http://127.0.0.1:5173/#dictate-bar'
  }
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
  dictateWin.loadURL(barUrl())
  dictateWin.on('closed', () => {
    dictateWin = null
    dictateArmed = false
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
  if (!dictateWin || dictateWin.isDestroyed()) return
  dictateWin.hide()
}

function toggleDictateHotkey() {
  const bar = ensureDictateBar()
  if (!dictateArmed) {
    dictateArmed = true
    showDictateBar()
    bar.webContents.send('dictate:hotkey', 'start')
    return
  }
  dictateArmed = false
  bar.webContents.send('dictate:hotkey', 'stop')
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

function createWindow() {
  const isMac = process.platform === 'darwin'
  const chrome = chromeThemes.dark
  win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 900,
    minHeight: 640,
    backgroundColor: chrome.canvas,
    title: 'CrunchCall',
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

  win.once('ready-to-show', () => win.show())
  win.on('close', (event) => {
    // Keep the process alive in the tray. Quit only from the tray menu.
    if (quitting) return
    event.preventDefault()
    win.hide()
    ensureTray()
    if (toldTray || !Notification.isSupported()) return
    toldTray = true
    new Notification({
      title: 'CrunchCall is still running',
      body: watching
        ? 'You will get a prompt when a meeting starts. Quit from the tray icon to stop.'
        : 'Quit from the tray icon when you are done. Hold Ctrl+Win to dictate anywhere.',
    }).show()
  })
  win.loadURL(devUrl)
}

function readableError(error) {
  if (error && error.name === 'AbortError') return 'The calendar took too long to answer.'
  return "Couldn't reach that calendar."
}

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
      headers: { Accept: 'text/calendar, text/plain, */*', 'User-Agent': 'CrunchCall' },
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
  const instanceKey = payload.instanceKey
  const note = new Notification({
    title: payload.title.slice(0, 120) || 'Meeting starting',
    body: typeof payload.body === 'string' ? payload.body.slice(0, 180) : 'Turn CrunchCall on for this meeting?',
  })
  note.on('click', () => {
    showMain()
    win?.webContents.send('calendar:start', instanceKey)
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

app.whenReady().then(() => {
  if (process.platform === 'darwin' && !appIcon.isEmpty()) app.dock.setIcon(appIcon)
  createWindow()
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
