import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import DictateBarApp from './DictateBarApp.tsx'
import OverlayApp from './ui/OverlayApp.tsx'

// The Electron shell hides the OS title bar, so the app reserves a window band
// for dragging and for the native caption buttons. Set it before the first paint.
if (typeof window !== 'undefined' && window.crunchcall) {
  document.documentElement.dataset.desktop = 'true'
}

const hash = window.location.hash
const surface = hash === '#dictate-bar' ? <DictateBarApp /> : hash === '#overlay' ? <OverlayApp /> : <App />

createRoot(document.getElementById('root')!).render(<StrictMode>{surface}</StrictMode>)
