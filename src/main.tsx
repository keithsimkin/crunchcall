import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import DictateBarApp from './DictateBarApp.tsx'

// The Electron shell hides the OS title bar, so the app reserves a window band
// for dragging and for the native caption buttons. Set it before the first paint.
if (typeof window !== 'undefined' && window.crunchcall) {
  document.documentElement.dataset.desktop = 'true'
}

const dictateBar = window.location.hash === '#dictate-bar'

createRoot(document.getElementById('root')!).render(
  <StrictMode>{dictateBar ? <DictateBarApp /> : <App />}</StrictMode>,
)
