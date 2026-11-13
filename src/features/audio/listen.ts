export type ListenHandle = {
  label: string
  kind: 'speakers' | 'microphone'
  sampleRate: number
  pull: () => Int16Array
  /** Recent peak amplitude from 0 to 1, for level meters. */
  level: () => number
  stop: () => void
}

export type MicOption = {
  id: string
  name: string
}

type Graph = {
  context: AudioContext
  streams: MediaStream[]
  nodes: AudioNode[]
}

export async function listMicrophones(): Promise<MicOption[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [{ id: 'default', name: 'Default' }]
  let list = await navigator.mediaDevices.enumerateDevices()
  const inputs = () => list.filter((item) => item.kind === 'audioinput' && item.deviceId)
  if (inputs().length > 0 && inputs().every((item) => !item.label)) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.getTracks().forEach((track) => track.stop())
      list = await navigator.mediaDevices.enumerateDevices()
    } catch {
      /* labels stay hidden until the microphone is allowed */
    }
  }
  const found = inputs().map((item, index) => ({
    id: item.deviceId,
    name: item.label || `Microphone ${index + 1}`,
  }))
  return [{ id: 'default', name: 'Default' }, ...found]
}

export async function startListening(options: { mic: boolean; deviceId: string }): Promise<ListenHandle> {
  const streams: MediaStream[] = []
  let label = 'Microphone'
  let kind: ListenHandle['kind'] = 'microphone'
  const loopback = await openLoopback()
  if (loopback) {
    streams.push(loopback)
    label = 'Speakers (loopback)'
    kind = 'speakers'
  }
  if (options.mic || !loopback) {
    const mic = await openMic(options.deviceId)
    streams.push(mic)
    if (!loopback) label = mic.getAudioTracks()[0]?.label || 'Microphone'
    else label = `${label} + mic`
  }

  const context = new AudioContext()
  const processor = context.createScriptProcessor(4096, 1, 1)
  const mute = context.createGain()
  mute.gain.value = 0
  const nodes: AudioNode[] = [processor, mute]
  const pending: Float32Array[] = []
  let peak = 0
  processor.onaudioprocess = (event) => {
    const data = event.inputBuffer.getChannelData(0)
    pending.push(new Float32Array(data))
    let local = 0
    for (let index = 0; index < data.length; index += 1) {
      const sample = Math.abs(data[index])
      if (sample > local) local = sample
    }
    peak = Math.max(local, peak * 0.82)
  }
  for (const stream of streams) {
    const source = context.createMediaStreamSource(stream)
    source.connect(processor)
    nodes.push(source)
  }
  processor.connect(mute)
  mute.connect(context.destination)
  const graph: Graph = { context, streams, nodes }

  return {
    label,
    kind,
    sampleRate: context.sampleRate,
    pull: () => {
      const chunks = pending.splice(0, pending.length)
      const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
      const pcm = new Int16Array(length)
      let offset = 0
      for (const chunk of chunks) {
        for (let index = 0; index < chunk.length; index += 1) {
          const sample = Math.max(-1, Math.min(1, chunk[index]))
          pcm[offset] = sample < 0 ? sample * 0x8000 : sample * 0x7fff
          offset += 1
        }
      }
      return pcm
    },
    level: () => peak,
    stop: () => release(graph),
  }
}

async function openLoopback(): Promise<MediaStream | null> {
  const arm = window.crunchcall?.armLoopback
  if (!arm || !navigator.mediaDevices?.getDisplayMedia) return null
  try {
    await arm()
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
    for (const track of stream.getVideoTracks()) track.enabled = false
    if (stream.getAudioTracks().length === 0) {
      stream.getTracks().forEach((track) => track.stop())
      return null
    }
    return stream
  } catch {
    return null
  }
}

async function openMic(deviceId: string): Promise<MediaStream> {
  const audio = deviceId && deviceId !== 'default' ? { deviceId: { exact: deviceId } } : true
  return navigator.mediaDevices.getUserMedia({ audio })
}

function release(graph: Graph) {
  for (const node of graph.nodes) node.disconnect()
  for (const stream of graph.streams) stream.getTracks().forEach((track) => track.stop())
  void graph.context.close()
}
