const { contextBridge, ipcRenderer } = require('electron')

let pendingStart = null
const listeners = new Set()
const dictateListeners = new Set()

ipcRenderer.on('calendar:start', (_event, instanceKey) => {
  pendingStart = instanceKey
  for (const listener of listeners) listener(instanceKey)
})

ipcRenderer.on('dictate:hotkey', (_event, phase) => {
  for (const listener of dictateListeners) listener(phase)
})

contextBridge.exposeInMainWorld('crunchcall', {
  fetchCalendar: (url) => ipcRenderer.invoke('calendar:fetch', url),
  notify: (payload) => ipcRenderer.invoke('calendar:notify', payload),
  setWatching: (on) => ipcRenderer.invoke('calendar:watching', Boolean(on)),
  setChrome: (theme) => ipcRenderer.invoke('window:chrome', theme),
  engine: (method, params) => ipcRenderer.invoke('engine:call', method, params || {}),
  pasteDictation: (text) => ipcRenderer.invoke('dictate:paste', String(text || '')),
  hideDictateBar: () => ipcRenderer.invoke('dictate:hide'),
  openExternal: (url) => ipcRenderer.invoke('shell:open', String(url || '')),
  onStart: (callback) => {
    listeners.add(callback)
    if (pendingStart) callback(pendingStart)
    return () => listeners.delete(callback)
  },
  onDictateHotkey: (callback) => {
    dictateListeners.add(callback)
    return () => dictateListeners.delete(callback)
  },
})
