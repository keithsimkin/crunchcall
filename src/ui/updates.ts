export const updateOwner = 'keithsimkin'
export const updateRepo = 'crunchcall'
export const releasesPage = `https://github.com/${updateOwner}/${updateRepo}/releases/latest`
export const releasesApi = `https://api.github.com/repos/${updateOwner}/${updateRepo}/releases/latest`

export const appVersion =
  typeof __CRUNCHCALL_VERSION__ === 'string' && __CRUNCHCALL_VERSION__ ? __CRUNCHCALL_VERSION__ : '0.1.0'

export type UpdateResult =
  | { phase: 'idle' | 'checking'; current: string }
  | { phase: 'current'; current: string; latest: string }
  | { phase: 'available'; current: string; latest: string; url: string }
  | { phase: 'empty'; current: string }
  | { phase: 'error'; current: string; message: string }

export function compareVersions(left: string, right: string): number {
  const a = parts(left)
  const b = parts(right)
  const length = Math.max(a.length, b.length)
  for (let index = 0; index < length; index += 1) {
    const delta = (a[index] ?? 0) - (b[index] ?? 0)
    if (delta !== 0) return delta
  }
  return 0
}

export function judgeRelease(body: unknown, current: string): UpdateResult {
  if (!body || typeof body !== 'object') {
    return { phase: 'error', current, message: "GitHub didn't return a version." }
  }
  const record = body as Record<string, unknown>
  const latest = normalizeVersion(record.tag_name)
  if (!latest) return { phase: 'error', current, message: "GitHub didn't return a version." }
  if (compareVersions(latest, current) <= 0) return { phase: 'current', current, latest }
  return { phase: 'available', current, latest, url: releaseUrl(record.html_url) }
}

export async function loadLatest(current: string): Promise<UpdateResult> {
  let response: Response
  try {
    response = await fetch(releasesApi, {
      headers: { Accept: 'application/vnd.github+json' },
    })
  } catch {
    return { phase: 'error', current, message: "Couldn't reach GitHub." }
  }
  if (response.status === 404) return { phase: 'empty', current }
  if (!response.ok) return { phase: 'error', current, message: "Couldn't reach GitHub." }
  try {
    return judgeRelease(await response.json(), current)
  } catch {
    return { phase: 'error', current, message: "GitHub didn't return a version." }
  }
}

export function updateHelp(result: UpdateResult): string {
  switch (result.phase) {
    case 'checking':
      return 'Checking GitHub…'
    case 'current':
      return "You're on the latest version."
    case 'available':
      return `${result.latest} is on GitHub.`
    case 'empty':
      return 'No release on GitHub yet.'
    case 'error':
      return result.message
    default:
      return 'Looks on GitHub for a newer release.'
  }
}

function parts(version: string): number[] {
  return normalizeVersion(version)
    .split(/[.-]/)
    .map((part) => {
      const value = Number.parseInt(part, 10)
      return Number.isFinite(value) ? value : 0
    })
}

function normalizeVersion(value: unknown): string {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim().replace(/^v/i, '')
  if (!/^\d+(\.\d+){0,3}([.-][0-9A-Za-z.-]+)?$/.test(trimmed)) return ''
  return trimmed
}

function releaseUrl(value: unknown): string {
  if (typeof value !== 'string') return releasesPage
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.hostname !== 'github.com') return releasesPage
    if (!url.pathname.startsWith(`/${updateOwner}/${updateRepo}`)) return releasesPage
    return url.toString()
  } catch {
    return releasesPage
  }
}
