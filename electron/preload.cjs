const { contextBridge, ipcRenderer } = require('electron')

let pendingStart = null
let pendingCommand = null
const listeners = new Set()
const dictateListeners = new Set()
const commandListeners = new Set()
const trayCommands = new Set(['dashboard', 'meeting', 'calendar', 'projects', 'settings', 'updates'])

ipcRenderer.on('calendar:start', (_event, instanceKey) => {
  if (listeners.size === 0) {
    pendingStart = instanceKey
    return
  }
  pendingStart = null
  for (const listener of listeners) listener(instanceKey)
})

ipcRenderer.on('dictate:hotkey', (_event, phase) => {
  for (const listener of dictateListeners) listener(phase)
})

ipcRenderer.on('app:command', (_event, command) => {
  if (!trayCommands.has(command)) return
  if (commandListeners.size === 0) {
    pendingCommand = command
    return
  }
  pendingCommand = null
  for (const listener of commandListeners) listener(command)
})

contextBridge.exposeInMainWorld('crunchcall', {
  fetchCalendar: (url) => ipcRenderer.invoke('calendar:fetch', url),
  calendarSignIn: () => ipcRenderer.invoke('calendar:sign-in'),
  connectCalendar: (provider) => ipcRenderer.invoke('calendar:connect', provider),
  calendarChoices: (provider) => ipcRenderer.invoke('calendar:choices', provider),
  syncCalendar: (provider, calendars, range) => ipcRenderer.invoke('calendar:sync-account', provider, calendars, range),
  disconnectCalendar: (provider) => ipcRenderer.invoke('calendar:disconnect', provider),
  cancelCalendarSignIn: () => ipcRenderer.invoke('calendar:cancel-sign-in'),
  notify: (payload) => ipcRenderer.invoke('calendar:notify', payload),
  setWatching: (on) => ipcRenderer.invoke('calendar:watching', Boolean(on)),
  setChrome: (theme) => ipcRenderer.invoke('window:chrome', theme),
  engine: (method, params) => ipcRenderer.invoke('engine:call', method, params || {}),
  armLoopback: () => ipcRenderer.invoke('audio:arm-loopback'),
  setOverlaySession: (session) => ipcRenderer.invoke('overlay:session', session),
  setOverlay: (cue) => ipcRenderer.invoke('overlay:set', cue),
  setOverlayExpanded: (expanded) => ipcRenderer.invoke('overlay:expand', Boolean(expanded)),
  overlayAction: (action) => ipcRenderer.invoke('overlay:action', String(action || '')),
  onOverlaySession: (callback) => {
    const listener = (_event, session) => callback(session)
    ipcRenderer.on('overlay:session', listener)
    return () => ipcRenderer.removeListener('overlay:session', listener)
  },
  onOverlayExpanded: (callback) => {
    const listener = (_event, expanded) => callback(Boolean(expanded))
    ipcRenderer.on('overlay:expanded', listener)
    return () => ipcRenderer.removeListener('overlay:expanded', listener)
  },
  onOverlay: (callback) => {
    // Legacy cue channel — also derived from session updates for older callers.
    const fromCue = (_event, cue) => callback(cue)
    const fromSession = (_event, session) => callback(session && session.cue ? session.cue : null)
    ipcRenderer.on('overlay:cue', fromCue)
    ipcRenderer.on('overlay:session', fromSession)
    return () => {
      ipcRenderer.removeListener('overlay:cue', fromCue)
      ipcRenderer.removeListener('overlay:session', fromSession)
    }
  },
  onOverlayAction: (callback) => {
    const listener = (_event, action) => callback(String(action || ''))
    ipcRenderer.on('overlay:action', listener)
    return () => ipcRenderer.removeListener('overlay:action', listener)
  },
  openAtLogin: () => ipcRenderer.invoke('app:login-get'),
  setOpenAtLogin: (on) => ipcRenderer.invoke('app:login-set', Boolean(on)),
  pasteDictation: (text) => ipcRenderer.invoke('dictate:paste', String(text || '')),
  hideDictateBar: () => ipcRenderer.invoke('dictate:hide'),
  setDictateShortcut: (payload) =>
    ipcRenderer.invoke('shortcuts:dictate', payload && typeof payload === 'object' ? payload : {}),
  openExternal: (url) => ipcRenderer.invoke('shell:open', String(url || '')),
  licenseStatus: () => ipcRenderer.invoke('license:status'),
  activateLicense: (token) => ipcRenderer.invoke('license:activate', String(token || '')),
  deactivateLicense: () => ipcRenderer.invoke('license:deactivate'),
  clearLicense: () => ipcRenderer.invoke('license:clear'),
  buyLicense: () => ipcRenderer.invoke('license:buy'),
  openAccount: () => ipcRenderer.invoke('license:account'),
  updateStatus: () => ipcRenderer.invoke('update:status'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdate: (callback) => {
    const listener = (_event, status) => callback(status)
    ipcRenderer.on('update:status', listener)
    return () => ipcRenderer.removeListener('update:status', listener)
  },
  announce: (payload) => ipcRenderer.invoke('app:announce', payload && typeof payload === 'object' ? payload : {}),
  settleUpdateCheck: () => ipcRenderer.invoke('app:update-settled'),
  onAppCommand: (callback) => {
    commandListeners.add(callback)
    if (pendingCommand) {
      const command = pendingCommand
      pendingCommand = null
      callback(command)
    }
    return () => commandListeners.delete(callback)
  },
  onStart: (callback) => {
    listeners.add(callback)
    if (pendingStart) {
      const instanceKey = pendingStart
      pendingStart = null
      callback(instanceKey)
    }
    return () => listeners.delete(callback)
  },
  onDictateHotkey: (callback) => {
    dictateListeners.add(callback)
    return () => dictateListeners.delete(callback)
  },
})
