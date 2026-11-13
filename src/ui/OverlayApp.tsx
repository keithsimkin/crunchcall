import { useEffect, useState } from 'react'
import '../App.css'
import type { OverlaySession } from '../desktop'
import { productLive } from './fixtures'
import { LogoMark } from './icons'
import { clampOverlayOpacity } from './settingsState'
import { useTheme } from './theme'

function demoSessionFromUrl(): OverlaySession | null {
  try {
    const search = new URLSearchParams(window.location.search)
    const hash = window.location.hash
    const hashQuery = hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : ''
    const params = new URLSearchParams(search.toString() || hashQuery)
    if (params.get('demo') !== '1' && params.get('demo') !== 'force') return null
    const cue = productLive.cues[0]
    const opacityRaw = Number(params.get('opacity'))
    return {
      meetingId: 'live-product',
      title: productLive.title,
      elapsed: productLive.elapsed,
      listening: true,
      opacity: clampOverlayOpacity(Number.isFinite(opacityRaw) && opacityRaw > 1 ? opacityRaw / 100 : opacityRaw || 0.94),
      position: 'center',
      cue: cue ? { label: cue.label, message: cue.message } : null,
      lines: productLive.lines.slice(-3).map((line) => ({
        id: line.id,
        speaker: line.speaker,
        text: line.text,
      })),
    }
  } catch {
    return null
  }
}

export default function OverlayApp() {
  useTheme()
  const [session, setSession] = useState<OverlaySession | null>(() => demoSessionFromUrl())
  const [expanded, setExpanded] = useState(() => Boolean(demoSessionFromUrl()?.cue))

  useEffect(() => {
    const stopSession = window.crunchcall?.onOverlaySession?.((next) => {
      setSession(next)
      if (!next) {
        setExpanded(false)
        return
      }
      if (next.cue) {
        setExpanded(true)
        void window.crunchcall?.setOverlayExpanded?.(true)
      }
    })
    const stopExpanded = window.crunchcall?.onOverlayExpanded?.((next) => setExpanded(next))
    return () => {
      stopSession?.()
      stopExpanded?.()
    }
  }, [])

  async function toggleExpanded() {
    const next = !expanded
    setExpanded(next)
    await window.crunchcall?.setOverlayExpanded?.(next)
  }

  async function act(action: 'open' | 'end' | 'pause' | 'resume' | 'dismiss') {
    await window.crunchcall?.overlayAction?.(action)
  }

  if (!session) return null

  const opacity = clampOverlayOpacity(session.opacity ?? 0.94)

  return (
    <div
      className={expanded ? 'meeting-nub-root expanded' : 'meeting-nub-root'}
      data-desktop="true"
      style={{ ['--nub-opacity' as string]: String(opacity) }}
    >
      <aside className={session.listening ? 'meeting-nub listening' : 'meeting-nub'} aria-label="Live meeting">
        <button type="button" className="meeting-nub-main" onClick={() => void toggleExpanded()}>
          <span className="meeting-nub-brand" aria-hidden="true">
            <LogoMark size={18} />
            <span className={session.listening ? 'live-dot' : 'live-dot paused'} />
          </span>
          <span className="meeting-nub-copy">
            <strong>{session.title}</strong>
            <span>
              {session.listening ? 'Listening' : 'Paused'}
              <span aria-hidden="true"> · </span>
              {session.elapsed}
            </span>
          </span>
          <span className="meeting-nub-chevron" aria-hidden="true">
            {expanded ? '▾' : '▸'}
          </span>
        </button>

        {expanded ? (
          <div className="meeting-nub-body">
            {session.cue ? (
              <div className="meeting-nub-cue">
                <p className="overlay-kicker">Live cue</p>
                <p className="overlay-kind">{session.cue.label}</p>
                <p className="overlay-msg">{session.cue.message}</p>
              </div>
            ) : (
              <p className="meeting-nub-empty">
                {session.listening ? 'Cues land here mid-call.' : 'Paused. Resume when you want annotated to listen again.'}
              </p>
            )}

            {session.lines.length > 0 ? (
              <ul className="meeting-nub-lines" aria-label="Recent lines">
                {session.lines.map((line) => (
                  <li key={line.id}>
                    <strong>{line.speaker}</strong>
                    <span>{line.text}</span>
                  </li>
                ))}
              </ul>
            ) : null}

            <p className="overlay-safe">Not on your screen share</p>

            <div className="meeting-nub-actions">
              <button type="button" className="btn ghost small" onClick={() => void act('open')}>
                Open
              </button>
              {session.listening ? (
                <button type="button" className="btn ghost small" onClick={() => void act('pause')}>
                  Pause
                </button>
              ) : (
                <button type="button" className="btn primary small" onClick={() => void act('resume')}>
                  Resume
                </button>
              )}
              <button type="button" className="btn danger small" onClick={() => void act('end')}>
                End
              </button>
              <button type="button" className="text-btn" onClick={() => void act('dismiss')}>
                Hide
              </button>
            </div>
          </div>
        ) : null}
      </aside>
    </div>
  )
}
