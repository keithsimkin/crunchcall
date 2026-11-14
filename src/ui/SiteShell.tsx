import { useEffect, useState, type ReactNode } from 'react'
import { LogoMark } from './icons'
import './LandingPage.css'
import './siteShell.css'

function KickerMark() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <path
        d="M7 1.1c.35 1.9 1 3 2.6 3.6C8 5.3 7.35 6.4 7 8.3 6.65 6.4 6 5.3 4.4 4.7 6 4.1 6.65 3 7 1.1Z"
        fill="currentColor"
      />
      <path
        d="M11.1 7.2c.2 1.05.55 1.6 1.4 1.9-.85.3-1.2.85-1.4 1.9-.2-1.05-.55-1.6-1.4-1.9.85-.3 1.2-.85 1.4-1.9Z"
        fill="currentColor"
      />
    </svg>
  )
}

export function SiteKicker({ children }: { children: ReactNode }) {
  return (
    <p className="lp-kicker">
      <KickerMark />
      {children}
    </p>
  )
}

export function SiteShell({
  children,
  email,
  onSignOut,
}: {
  children: ReactNode
  email?: string
  onSignOut?: () => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    const body = document.body
    const prev = body.style.backgroundColor
    body.style.backgroundColor = '#f5f5f3'
    return () => {
      body.style.backgroundColor = prev
    }
  }, [])

  return (
    <div className="landing">
      <div className="lp-navwrap">
        <header className={menuOpen ? 'lp-nav open' : 'lp-nav'}>
          <a className="lp-brand" href="/">
            <LogoMark />
            annotated
          </a>
          <button
            type="button"
            className="lp-menu"
            aria-expanded={menuOpen}
            aria-controls="site-sections"
            onClick={() => setMenuOpen((open) => !open)}
          >
            Menu
          </button>
          <nav id="site-sections" aria-label="Page">
            <a href="/#product">Features</a>
            <a href="/#pricing">Pricing</a>
            {email ? <span className="site-who">{email}</span> : null}
            {onSignOut ? (
              <button type="button" className="site-signout" onClick={onSignOut}>
                Sign out
              </button>
            ) : null}
          </nav>
          <a className="lp-nav-cta" href="/#app">
            Open the app
          </a>
        </header>
      </div>
      <main className="site-main">{children}</main>
      <div className="lp-feature-scene site-fern" aria-hidden="true" />
    </div>
  )
}
