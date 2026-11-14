const { app, BrowserWindow, ipcMain } = require('electron')
const fs = require('fs')
const path = require('path')

const PAGE = `<!doctype html>
<meta charset="utf-8">
<title>annotated recorder</title>
<canvas id="frame"></canvas>
<script>
const canvas = document.getElementById('frame')
const ctx = canvas.getContext('2d', { alpha: false })
let media = null
let pending = null
let bitmap = null
let drawing = false
function mime() {
  const types = ['video/webm;codecs=vp8', 'video/webm;codecs=vp9', 'video/webm']
  return types.find((type) => window.MediaRecorder && MediaRecorder.isTypeSupported(type)) || ''
}
setInterval(() => {
  if (!media || drawing) return
  drawing = true
  const next = pending
  pending = null
  const paint = next
    ? createImageBitmap(new Blob([next], { type: 'image/jpeg' })).then((bmp) => {
        if (bitmap) bitmap.close()
        bitmap = bmp
      })
    : Promise.resolve()
  paint
    .then(() => {
      if (bitmap) ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    })
    .finally(() => {
      drawing = false
    })
}, 33)
window.recorder.bind((message) => {
  if (message.type === 'init') {
    canvas.width = message.width
    canvas.height = message.height
    const stream = canvas.captureStream(30)
    const options = { videoBitsPerSecond: message.bitrate || 4000000 }
    const chosen = mime()
    if (chosen) options.mimeType = chosen
    media = new MediaRecorder(stream, options)
    let chain = Promise.resolve()
    media.ondataavailable = (event) => {
      const data = event.data
      chain = chain.then(async () => {
        if (!data || !data.size) return
        window.recorder.chunk(new Uint8Array(await data.arrayBuffer()))
      })
    }
    media.onstop = () => {
      chain.then(() => window.recorder.ended())
    }
    media.start(400)
    window.recorder.ready()
    return
  }
  if (message.type === 'frame' && message.bytes) pending = message.bytes
  if (message.type === 'stop' && media && media.state === 'recording') {
    media.requestData()
    media.stop()
  } else if (message.type === 'stop') window.recorder.ended()
})
</script>`

const pumps = new Map()
let hooked = false

function hookIpc() {
  if (hooked) return
  hooked = true
  ipcMain.on('recorder:ready', (event) => pumps.get(event.sender.id)?.ready())
  ipcMain.on('recorder:chunk', (event, bytes) => {
    const pump = pumps.get(event.sender.id)
    if (pump) pump.stream.write(Buffer.from(bytes))
  })
  ipcMain.on('recorder:ended', (event) => {
    const pump = pumps.get(event.sender.id)
    if (!pump) return
    pump.stream.end(() => pump.finish())
  })
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function recordWebContents(webContents, file) {
  hookIpc()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const htmlPath = path.join(app.getPath('temp'), `annotated-recorder-${process.pid}-${Date.now()}.html`)
  fs.writeFileSync(htmlPath, PAGE)
  const encoder = new BrowserWindow({
    show: false,
    width: 320,
    height: 180,
    focusable: false,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, 'recorder-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  })
  const stream = fs.createWriteStream(file)
  let resolveReady = () => {}
  let resolveEnded = () => {}
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('The WebM encoder did not start.')), 8000)
    resolveReady = () => {
      clearTimeout(timer)
      resolve()
    }
  })
  const ended = new Promise((resolve) => {
    resolveEnded = resolve
  })
  pumps.set(encoder.webContents.id, { stream, ready: resolveReady, finish: resolveEnded })
  await encoder.loadFile(htmlPath)
  encoder.setPosition(-4000, -4000)
  encoder.showInactive()

  let latest = null
  let subscribed = false
  try {
    webContents.beginFrameSubscription((image) => {
      try {
        const size = image.getSize()
        if (!size.width || !size.height) return
        latest = { width: size.width, height: size.height, jpeg: image.toJPEG(70) }
      } catch {
        /* ignore a bad frame */
      }
    })
    subscribed = true
  } catch (error) {
    console.error('beginFrameSubscription failed', error)
  }

  let stopped = false
  let frames = 0
  let opened = false
  const loop = (async () => {
    try {
    while (!stopped) {
      if (!latest && frames === 0) {
        try {
          const shot = await webContents.capturePage()
          const size = shot.getSize()
          if (size.width && size.height) latest = { width: size.width, height: size.height, jpeg: shot.toJPEG(70) }
        } catch {
          /* the page may still be loading */
        }
      }
      const frame = latest
      latest = null
      if (frame) {
        if (!opened) {
          console.log(`recording ${frame.width}x${frame.height}`)
          const bitrate = frame.width >= 2000 ? 5_000_000 : 2_500_000
          encoder.webContents.send('recorder:control', {
            type: 'init',
            width: frame.width,
            height: frame.height,
            bitrate,
          })
          await ready
          opened = true
        }
        encoder.webContents.send('recorder:control', { type: 'frame', bytes: frame.jpeg })
        frames += 1
      }
      await delay(33)
    }
    } catch (error) {
      console.error(error)
    }
  })()

  return {
    frames: () => frames,
    async stop() {
      stopped = true
      if (subscribed) {
        try {
          webContents.endFrameSubscription()
        } catch {
          /* already ended */
        }
      }
      await loop
      const encoderId = encoder.webContents.id
      if (opened && !encoder.isDestroyed()) {
        encoder.webContents.send('recorder:control', { type: 'stop' })
        await Promise.race([ended, delay(8000)])
      } else {
        stream.end()
      }
      pumps.delete(encoderId)
      if (!encoder.isDestroyed()) encoder.close()
    },
  }
}

module.exports = { recordWebContents }
