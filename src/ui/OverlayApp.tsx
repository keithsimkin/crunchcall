import { useEffect, useState } from 'react'
import '../App.css'

type Cue = { label: string; message: string }

export default function OverlayApp() {
  const [cue, setCue] = useState<Cue | null>(null)

  useEffect(() => {
    return window.crunchcall?.onOverlay?.((next) => {
      if (!next || !next.message) {
        setCue(null)
        return
      }
      setCue({ label: next.label || 'Live cue', message: next.message })
    })
  }, [])

  if (!cue) return null

  return (
    <aside className="overlay" aria-label="Live cue">
      <p className="overlay-kicker">Live cue</p>
      <p className="overlay-kind">{cue.label}</p>
      <p className="overlay-msg">{cue.message}</p>
      <p className="overlay-safe">Not on your screen share</p>
    </aside>
  )
}
