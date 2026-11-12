export function engineErrorMessage(error: { code: string; message: string } | string | undefined): string {
  if (!error) return 'The engine call failed.'
  if (typeof error === 'string') return error
  return error.message || error.code || 'The engine call failed.'
}

export function engineAvailable(): boolean {
  return typeof window !== 'undefined' && typeof window.crunchcall?.engine === 'function'
}

export async function callEngine(
  method: string,
  params?: Record<string, unknown>,
): Promise<{ ok: true; result: unknown } | { ok: false; message: string }> {
  const engine = window.crunchcall?.engine
  if (!engine) return { ok: false, message: 'The desktop engine is not running.' }
  try {
    const response = await engine(method, params)
    if (response.ok) return { ok: true, result: response.result }
    return { ok: false, message: engineErrorMessage(response.error) }
  } catch (error) {
    return { ok: false, message: friendlyEngineError(error) }
  }
}

function friendlyEngineError(error: unknown): string {
  const raw = error instanceof Error ? error.message : 'The engine call failed.'
  if (raw.includes('No handler registered')) {
    return 'The desktop app is still on the previous engine. Quit CrunchCall and open it again.'
  }
  return raw
}

export function describeEngineResult(result: unknown): string {
  if (typeof result === 'string' && result.trim()) return result
  if (!result || typeof result !== 'object') return 'Download started.'
  const row = result as Record<string, unknown>
  if (typeof row.message === 'string' && row.message.trim()) return row.message
  if (typeof row.status === 'string' && row.status.trim()) return row.status
  if (typeof row.state === 'string' && row.state.trim()) return row.state
  if (row.installed === true) return 'Installed.'
  return 'Download started.'
}
