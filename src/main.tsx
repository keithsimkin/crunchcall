import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'

// The Electron shell hides the OS title bar, so the app reserves a window band
// for dragging and for the native caption buttons. Set it before the first paint.
if (typeof window !== 'undefined' && window.crunchcall) {
  document.documentElement.dataset.desktop = 'true'
}

const root = document.getElementById('root')!
const hash = window.location.hash.split('?')[0]

async function boot() {
  // Only pull the surface this window needs — overlay / dictate bar stay lean.
  const surface =
    hash === '#dictate-bar'
      ? (await import('./DictateBarApp.tsx')).default
      : hash === '#overlay'
        ? (await import('./ui/OverlayApp.tsx')).default
        : (await import('./App.tsx')).default

  const Surface = surface
  createRoot(root).render(
    <StrictMode>
      <Surface />
    </StrictMode>,
  )
}

void boot()
