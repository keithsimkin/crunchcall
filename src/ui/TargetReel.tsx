import { useEffect, useState } from 'react'
import { publicAsset } from './publicAsset'

const targets = [
  { id: 'chrome', name: 'Chrome', src: publicAsset('logos/chrome.svg') },
  { id: 'cursor', name: 'Cursor', src: publicAsset('logos/cursor.png') },
  { id: 'firefox', name: 'Firefox', src: publicAsset('logos/firefox.svg') },
  { id: 'chatgpt', name: 'ChatGPT', src: publicAsset('logos/chatgpt.svg') },
  { id: 'safari', name: 'Safari', src: publicAsset('logos/safari.svg') },
  { id: 't3', name: 'T3', src: publicAsset('logos/t3.svg') },
  { id: 'claude', name: 'Claude', src: publicAsset('logos/claude.svg') },
  { id: 'vscode', name: 'VS Code', src: publicAsset('logos/vscode.svg') },
  { id: 'gemini', name: 'Gemini', src: publicAsset('logos/gemini.svg') },
] as const

const step = 48
const visible = 4

export function TargetReel() {
  const [index, setIndex] = useState(0)
  const [animate, setAnimate] = useState(true)

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    if (media.matches) return
    const id = window.setInterval(() => setIndex((current) => current + 1), 1900)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    if (index < targets.length) return
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

  const track = [...targets, ...targets.slice(0, visible)]

  return (
    <span className="app-reel target-reel">
      <span className="sr">
        Dictate into {targets.map((target) => target.name).join(', ')}, and anywhere else on this PC.
      </span>
      <span className="reel-window target-window" aria-hidden="true">
        <span
          className={animate ? 'reel-track' : 'reel-track snap'}
          style={{ transform: `translateX(-${index * step}px)` }}
        >
          {track.map((target, i) => (
            <span key={`${target.id}-${i}`} className={`app-badge badge-${target.id}`} title={target.name}>
              <img src={target.src} alt="" width={22} height={22} decoding="async" />
            </span>
          ))}
        </span>
      </span>
    </span>
  )
}
