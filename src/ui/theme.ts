import { useEffect, useState } from 'react'

export type ThemePreference = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'

const THEME_KEY = 'crunchcall.theme'

export function readThemePreference(): ThemePreference {
  try {
    const raw = localStorage.getItem(THEME_KEY)
    if (raw === 'light' || raw === 'dark' || raw === 'system') return raw
  } catch {
    /* ignore */
  }
  return 'system'
}

export function writeThemePreference(theme: ThemePreference): void {
  localStorage.setItem(THEME_KEY, theme)
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference === 'light' || preference === 'dark') return preference
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function applyResolvedTheme(resolved: ResolvedTheme): void {
  const root = document.documentElement
  root.dataset.theme = resolved
  root.style.colorScheme = resolved
}

export function useTheme() {
  const [preference, setPreferenceState] = useState<ThemePreference>(() => readThemePreference())
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolveTheme(readThemePreference()))

  useEffect(() => {
    const next = resolveTheme(preference)
    setResolved(next)
    applyResolvedTheme(next)

    if (preference !== 'system') return

    const media = window.matchMedia('(prefers-color-scheme: dark)')
    function onChange() {
      const system = resolveTheme('system')
      setResolved(system)
      applyResolvedTheme(system)
    }
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [preference])

  function setPreference(next: ThemePreference) {
    writeThemePreference(next)
    setPreferenceState(next)
  }

  return { preference, setPreference, resolved }
}
