// The Windows installer is a file, not a new service. annotated.click serves a
// stable /annotated-setup.exe redirect (see netlify.toml) to the GitHub Releases
// asset. Set VITE_WINDOWS_INSTALLER_URL at build time to override. ANNOTATED_INSTALLER_URL
// is the same idea for the unused Node license server.
const SITE_INSTALLER = 'https://annotated.click/annotated-setup.exe'

export function windowsInstallerUrl(override?: string) {
  const fromEnv = import.meta.env?.VITE_WINDOWS_INSTALLER_URL
  const value = (override ?? fromEnv ?? '').trim()
  if (value.startsWith('https://')) return value
  return SITE_INSTALLER
}

export const WINDOWS_INSTALLER_URL = windowsInstallerUrl()
