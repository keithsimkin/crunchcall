export type AudioCaptureStatus = 'idle' | 'requesting' | 'listening' | 'error'

export type AudioChunk = {
  meetingId: string
  pcm: ArrayBuffer
  sampleRate: number
  capturedAt: number
}

export interface AudioCaptureAdapter {
  readonly id: string
  start(meetingId: string): Promise<void>
  stop(): Promise<void>
  onChunk(handler: (chunk: AudioChunk) => void): () => void
}
