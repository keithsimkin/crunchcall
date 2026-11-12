export function downsampleToPcm16(input: Float32Array, inputRate: number): Int16Array {
  const rate = inputRate > 0 ? inputRate : 16000
  const ratio = rate / 16000
  const length = Math.max(0, Math.floor(input.length / ratio))
  const out = new Int16Array(length)
  for (let index = 0; index < length; index += 1) {
    const position = index * ratio
    const left = Math.floor(position)
    const fraction = position - left
    const a = input[left] ?? 0
    const b = input[left + 1] ?? a
    const sample = Math.max(-1, Math.min(1, a + (b - a) * fraction))
    out[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff
  }
  return out
}

export function pcm16ToBase64(pcm: Int16Array): string {
  const bytes = new Uint8Array(pcm.length * 2)
  const view = new DataView(bytes.buffer)
  for (let index = 0; index < pcm.length; index += 1) view.setInt16(index * 2, pcm[index], true)
  let binary = ''
  const step = 0x8000
  for (let index = 0; index < bytes.length; index += step) {
    binary += String.fromCharCode(...bytes.subarray(index, index + step))
  }
  return btoa(binary)
}

export function readSessionId(result: unknown): string | null {
  if (!result || typeof result !== 'object') return null
  const row = result as Record<string, unknown>
  return typeof row.sessionId === 'string' ? row.sessionId : null
}

export function readDictationText(result: unknown): string {
  if (typeof result === 'string') return result
  if (!result || typeof result !== 'object') return ''
  const row = result as Record<string, unknown>
  if (typeof row.text === 'string') return row.text
  if (row.dictation && typeof row.dictation === 'object') {
    const inner = row.dictation as Record<string, unknown>
    if (typeof inner.text === 'string') return inner.text
  }
  return ''
}
