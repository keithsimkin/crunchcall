import { useEffect, useState } from 'react'
import { publicAsset } from './publicAsset'

const apps = [
  { id: 'zoom', name: 'Zoom', src: publicAsset('logos/zoom-mark.svg') },
  { id: 'meet', name: 'Google Meet', src: publicAsset('logos/meet.svg') },
  { id: 'teams', name: 'Teams', src: publicAsset('logos/teams.svg') },
  { id: 'webex', name: 'Webex', src: publicAsset('logos/webex.svg') },
  { id: 'slack', name: 'Slack', src: publicAsset('logos/slack.svg') },
  { id: 'discord', name: 'Discord', src: publicAsset('logos/discord.svg') },
] as const

const step = 48

export function AppReel() {
  const [index, setIndex] = useState(0)
  const [animate, setAnimate] = useState(true)

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    if (media.matches) return
    const id = window.setInterval(() => setIndex((current) => current + 1), 1900)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    if (index < apps.length) return
    const id = window.setTimeout(() => {
      setAnimate(false)
      setIndex(0)
    }, 460)
    return () => window.clearTimeout(id)
  }, [index])

  useEffect(() => {
    if (animate) return
    const id = window.requestAnimationFrame(() => setAnimate(true))
    return () => window.cancelAnimationFrame(id)
  }, [animate])

  const track = [...apps, ...apps.slice(0, 3)]

  return (
    <span className="app-reel">
      <span className="sr">Works beside {apps.map((app) => app.name).join(', ')}.</span>
      <span className="reel-window" aria-hidden="true">
        <span
          className={animate ? 'reel-track' : 'reel-track snap'}
          style={{ transform: `translateX(-${index * step}px)` }}
        >
          {track.map((app, i) => (
            <span key={`${app.id}-${i}`} className={`app-badge badge-${app.id}`}>
              <img src={app.src} alt="" width={22} height={22} decoding="async" />
            </span>
          ))}
        </span>
      </span>
    </span>
  )
}
