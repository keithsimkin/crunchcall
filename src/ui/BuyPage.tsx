import { useEffect, useState } from 'react'
import { WINDOWS_INSTALLER_URL } from './download'
import { SiteShell } from './SiteShell'
import { SUPPORT_EMAIL } from './legalCopy'
import {
  captureAuthError,
  captureAuthHash,
  consumeAuthToken,
  readSession,
  takeAuthError,
  type AuthSession,
} from './siteAuth'

type BuyPhase = 'opening' | 'owned' | 'error'

function previewPhase(): BuyPhase | null {
  if (typeof window === 'undefined') return null
  const preview = new URLSearchParams(window.location.search).get('preview')
  if (preview === 'owned') return 'owned'
  if (preview === 'error') return 'error'
  return null
}

function readBootNote(): string {
  if (typeof window === 'undefined') return ''
  const fromCallback = captureAuthError()
  if (fromCallback) return fromCallback.message
  return takeAuthError() || ''
}

async function requestCheckout(session: AuthSession | null) {
  const headers = new Headers()
  if (session?.access_token && session.access_token !== 'preview') {
    headers.set('authorization', `Bearer ${session.access_token}`)
  }
  const response = await fetch('/api/checkout', { method: 'POST', headers })
  const payload = await response.json().catch(() => null)
  return { response, payload }
}

function applyCheckoutResult(
  payload: { ok?: boolean; next?: string; url?: string } | null,
  setPhase: (phase: BuyPhase) => void,
  setNote: (note: string) => void,
) {
  if (!payload || payload.ok !== true) {
    setPhase('error')
    setNote('Payment could not start. Try again in a moment.')
    return
  }
  if (payload.next === 'account') {
    setPhase('owned')
    return
  }
  if (typeof payload.url === 'string') {
    window.location.assign(payload.url)
    return
  }
  setPhase('error')
  setNote('Payment could not start. Try again in a moment.')
}

export function BuyPage() {
  const preview = previewPhase()
  const [phase, setPhase] = useState<BuyPhase>(preview || 'opening')
  const [note, setNote] = useState(() => (preview === 'error' ? 'Payment could not start. Try again in a moment.' : readBootNote()))
  const [busy, setBusy] = useState(false)

  async function openCheckout(session: AuthSession | null) {
    setBusy(true)
    setPhase('opening')
    setNote('')
    try {
      const { payload } = await requestCheckout(session)
      applyCheckoutResult(payload, setPhase, setNote)
    } catch {
      setPhase('error')
      setNote('Payment could not start. Try again in a moment.')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (preview) return
    let live = true
    void (async () => {
      const { session: fromLink, error } = await consumeAuthToken()
      if (!live) return
      if (error) {
        // Still open guest checkout; account recovery stays on /account.
        setNote(error)
      }
      const session = fromLink || captureAuthHash() || readSession()
      setBusy(true)
      try {
        const { payload } = await requestCheckout(session)
        if (!live) return
        applyCheckoutResult(payload, setPhase, setNote)
      } catch {
        if (!live) return
        setPhase('error')
        setNote('Payment could not start. Try again in a moment.')
      } finally {
        if (live) setBusy(false)
      }
    })()
    return () => {
      live = false
    }
  }, [preview])

  return (
    <SiteShell tone="auth">
      <div className="site-login">
        <section className="site-pass">
          {phase === 'owned' ? (
            <>
              <h1>You already have Unlock</h1>
              <p className="site-pass-lead">This email already has a license. Open your account to copy the key.</p>
              <div className="site-desk-actions">
                <a className="is-primary" href="/account">
                  Open your account
                </a>
              </div>
            </>
          ) : null}
          {phase === 'opening' ? (
            <>
              <h1>Opening checkout…</h1>
              <p className="site-pass-lead">
                You are headed to the payment page. Enter your email and card there — no sign-in first.
              </p>
              <button type="button" className="site-pass-go" disabled={busy} onClick={() => void openCheckout(readSession())}>
                {busy ? 'Opening…' : 'Continue to payment'}
              </button>
            </>
          ) : null}
          {phase === 'error' ? (
            <>
              <h1>Could not open checkout</h1>
              <p className="site-pass-lead">Try again, or email us if it keeps failing.</p>
              <button type="button" className="site-pass-go" disabled={busy} onClick={() => void openCheckout(readSession())}>
                {busy ? 'Opening…' : 'Try payment again'}
              </button>
              <p className="site-pass-help">
                Need help?{' '}
                <a href={`mailto:${SUPPORT_EMAIL}?subject=annotated%20buy%20help`}>Email us</a>
              </p>
            </>
          ) : null}
          {note ? (
            <p className={phase === 'error' ? 'site-pass-note is-error' : 'site-pass-note'} role={phase === 'error' ? 'alert' : 'status'}>
              {note}
            </p>
          ) : null}
          <a className="site-pass-download" href={WINDOWS_INSTALLER_URL}>
            Download annotated for Windows
          </a>
          <p className="site-pass-foot">
            Already bought? <a href="/account">Open your account</a>
          </p>
        </section>

        <aside className="site-login-side" aria-hidden="true">
          <div className="site-bubble" />
          <div className="site-block" />
        </aside>
      </div>
    </SiteShell>
  )
}
