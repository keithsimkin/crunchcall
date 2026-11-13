const { contextBridge, ipcRenderer } = require('electron')

let handler = null
const queued = []

ipcRenderer.on('recorder:control', (_event, message) => {
  if (handler) handler(message)
  else queued.push(message)
})

contextBridge.exposeInMainWorld('recorder', {
  bind(next) {
    handler = next
    while (queued.length) next(queued.shift())
  },
  ready() {
    ipcRenderer.send('recorder:ready')
  },
  chunk(bytes) {
    ipcRenderer.send('recorder:chunk', bytes)
  },
  ended() {
    ipcRenderer.send('recorder:ended')
  },
})
