import { useEffect, type ReactNode } from 'react'
import { WINDOWS_INSTALLER_URL } from './download'
import { DownloadIcon, LogoMark } from './icons'
import { SUPPORT_EMAIL } from './legalCopy'
import './LandingPage.css'
import './siteShell.css'

export function SiteShell({
  children,
  email,
  onSignOut,
  tone = 'auth',
}: {
  children: ReactNode
  email?: string
  onSignOut?: () => void
  tone?: 'auth' | 'desk'
}) {
  useEffect(() => {
    const body = document.body
    const prev = body.style.backgroundColor
    body.style.backgroundColor = '#eef1ea'
    return () => {
      body.style.backgroundColor = prev
    }
  }, [])

  return (
    <div className={`site-stage site-stage-${tone}`}>
      <div className="site-doodle site-doodle-a" aria-hidden="true" />
      <div className="site-doodle site-doodle-b" aria-hidden="true" />
      <div className="site-doodle site-doodle-c" aria-hidden="true" />

      <header className="site-rail">
        <div className="site-rail-brand">
          <a className="site-rail-logo" href="/">
            <LogoMark size={26} />
            annotated
          </a>
          <a className="site-rail-mail" href={`mailto:${SUPPORT_EMAIL}`}>
            {SUPPORT_EMAIL}
            <span aria-hidden="true">→</span>
          </a>
        </div>
        <div className="site-rail-end">
          {email ? <span className="site-rail-who">{email}</span> : null}
          {onSignOut ? (
            <>
              <a className="site-rail-download" href={WINDOWS_INSTALLER_URL}>
                <DownloadIcon />
                Download
              </a>
              <button type="button" className="site-rail-text" onClick={onSignOut}>
                Sign out
              </button>
            </>
          ) : (
            <>
              <a className="site-rail-download" href={WINDOWS_INSTALLER_URL}>
                <DownloadIcon />
                Download
              </a>
              <a className="site-rail-cta" href="/account">
                Sign in
              </a>
            </>
          )}
        </div>
      </header>

      <main className="site-board">{children}</main>

      <footer className="site-copyfoot">
        <p>
          © 2026 annotated
          <span aria-hidden="true"> · </span>
          <a href="/#pricing">Pricing</a>
          <span aria-hidden="true"> · </span>
          <a href={`mailto:${SUPPORT_EMAIL}`}>Support</a>
        </p>
      </footer>
    </div>
  )
}
