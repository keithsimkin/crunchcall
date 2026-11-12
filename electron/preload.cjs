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
  setOverlay: (cue) => ipcRenderer.invoke('overlay:set', cue),
  onOverlay: (callback) => {
    const listener = (_event, cue) => callback(cue)
    ipcRenderer.on('overlay:cue', listener)
    return () => ipcRenderer.removeListener('overlay:cue', listener)
  },
  openAtLogin: () => ipcRenderer.invoke('app:login-get'),
  setOpenAtLogin: (on) => ipcRenderer.invoke('app:login-set', Boolean(on)),
  pasteDictation: (text) => ipcRenderer.invoke('dictate:paste', String(text || '')),
  hideDictateBar: () => ipcRenderer.invoke('dictate:hide'),
  openExternal: (url) => ipcRenderer.invoke('shell:open', String(url || '')),
  licenseStatus: () => ipcRenderer.invoke('license:status'),
  activateLicense: (token) => ipcRenderer.invoke('license:activate', String(token || '')),
  clearLicense: () => ipcRenderer.invoke('license:clear'),
  buyLicense: () => ipcRenderer.invoke('license:buy'),
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
