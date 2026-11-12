import { useState } from 'react'
import { blankLive, productLive } from './fixtures'

type LiveScreenProps = {
  fresh: boolean
  title?: string
  onBack: () => void
  onEnd: () => void
}

export function LiveScreen({ fresh, title, onBack, onEnd }: LiveScreenProps) {
  const session = fresh ? blankLive : productLive
  const heading = title || session.title
  const [mic, setMic] = useState(false)
  const [overlayOn, setOverlayOn] = useState(true)
  const leadCue = session.cues[0]

  return (
    <section aria-labelledby="live-title">
      <div className="page-head">
        <div>
          <h1 id="live-title" className="page-title">
            {heading}
          </h1>
          <p className="lede">Live · {session.device}</p>
        </div>
        <div className="head-actions">
          <button type="button" className="btn ghost" onClick={onBack}>
            Meetings
          </button>
          <button type="button" className="btn primary" onClick={onEnd}>
            End meeting
          </button>
        </div>
      </div>

      <div className="live-status">
        <span className="live-dot" aria-hidden="true" />
        <div>
          <p className="elapsed">{session.elapsed}</p>
          <p className="muted">Listening · {session.device}</p>
        </div>
        <div className="wave" aria-hidden="true">
          {Array.from({ length: 22 }, (_, index) => (
            <span key={index} />
          ))}
        </div>
      </div>

      <div className="live-grid">
        <section className="panel" aria-label="Transcript">
          <div className="panel-h">
            <h2>Transcript</h2>
            <span className="muted">{session.lines.length === 0 ? 'Waiting' : `${session.lines.length} lines`}</span>
          </div>
          {session.lines.length === 0 ? (
            <p className="empty tight">Speech shows up here as the call goes. It stays on this machine.</p>
          ) : (
            <ol className="transcript">
              {session.lines.map((line) => (
                <li key={line.id} className={line.you ? 'utter you' : 'utter'}>
                  <time>{line.at}</time>
                  <p>
                    <strong>{line.speaker}</strong>
                    <span>{line.text}</span>
                  </p>
                </li>
              ))}
            </ol>
          )}
        </section>

        <div className="cue-col">
          {overlayOn && leadCue ? (
            <aside className="overlay" aria-label="Live cue">
              <div className="overlay-top">
                <p className="overlay-kicker">Live cue</p>
                <button type="button" onClick={() => setOverlayOn(false)} aria-label="Dismiss cue">
                  ×
                </button>
              </div>
              <p className="overlay-kind">{leadCue.label}</p>
              <p className="overlay-msg">{leadCue.message}</p>
              <p className="overlay-safe">Not on your screen share</p>
            </aside>
          ) : null}
          <section className="panel" aria-label="Cues">
            <div className="panel-h">
              <h2>Cues</h2>
              {!overlayOn && leadCue ? (
                <button type="button" className="text-btn" onClick={() => setOverlayOn(true)}>
                  Show cue
                </button>
              ) : null}
            </div>
            {session.cues.length === 0 ? (
              <p className="empty tight">Cues land here mid-call. They stay off your screen share.</p>
            ) : (
              <ul className="cue-list">
                {session.cues.map((cue) => (
                  <li key={cue.id} className="cue">
                    <p className="cue-kind">{cue.label}</p>
                    <p>{cue.message}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      <div className="live-bar">
        <button
          type="button"
          className={mic ? 'chip on' : 'chip'}
          aria-pressed={mic}
          onClick={() => setMic((value) => !value)}
        >
          Mic mix {mic ? 'on' : 'off'}
        </button>
        <span className="muted">{session.elapsed} on {session.device}</span>
      </div>
    </section>
  )
}
