// The Windows installer is a file, not a new service. GitHub Releases on
// keithsimkin/crunchcall is the free default. Set VITE_WINDOWS_INSTALLER_URL
// at build time to point at a specific release asset, or host the same file
// on this Netlify site and use that URL. ANNOTATED_INSTALLER_URL is the same
// idea for the unused Node license server.
const RELEASES = 'https://github.com/keithsimkin/crunchcall/releases/latest'

export function windowsInstallerUrl(override?: string) {
  const fromEnv = import.meta.env?.VITE_WINDOWS_INSTALLER_URL
  const value = (override ?? fromEnv ?? '').trim()
  if (value.startsWith('https://')) return value
  return RELEASES
}

export const WINDOWS_INSTALLER_URL = windowsInstallerUrl()
