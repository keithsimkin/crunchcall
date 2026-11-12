import { useCallback, useEffect, useState } from 'react'
import type { UpdateStatus } from '../desktop'

const idle: UpdateStatus = { phase: 'idle', version: '', percent: 0 }

function readStatus(value: unknown): UpdateStatus {
  if (!value || typeof value !== 'object') return idle
  const status = value as Partial<UpdateStatus>
  const phase = status.phase
  if (
    phase !== 'idle' &&
    phase !== 'checking' &&
    phase !== 'current' &&
    phase !== 'available' &&
    phase !== 'downloading' &&
    phase !== 'downloaded'
  ) {
    return idle
  }
  return {
    phase,
    version: typeof status.version === 'string' ? status.version : '',
    percent: typeof status.percent === 'number' ? status.percent : 0,
  }
}

export function useUpdates() {
  const [status, setStatus] = useState<UpdateStatus>(idle)

  useEffect(() => {
    const api = window.crunchcall
    if (!api?.onUpdate) return
    const stop = api.onUpdate((next) => setStatus(readStatus(next)))
    void api.updateStatus?.().then((next) => setStatus(readStatus(next)))
    return stop
  }, [])

  const install = useCallback(() => {
    void window.crunchcall?.installUpdate?.()
  }, [])

  const ready = status.phase === 'available' || status.phase === 'downloading' || status.phase === 'downloaded'

  return { ...status, install, ready }
}
