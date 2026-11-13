import { useState } from 'react'
import { SiteKicker, SiteShell } from './SiteShell'
import { accountRequest, authConfig, captureAuthHash, readSession, sendMagicLink, type AuthSession } from './siteAuth'

type BuyState = 'form' | 'sent' | 'ready' | 'owned'

function initialState(): { session: AuthSession | null; phase: BuyState } {
  if (typeof window !== 'undefined') {
    const preview = new URLSearchParams(window.location.search).get('preview')
    if (preview === 'sent') return { session: null, phase: 'sent' }
    if (preview === 'signed') return { session: { access_token: 'preview', refresh_token: '', expires_at: 0 }, phase: 'ready' }
    if (preview === 'owned') return { session: { access_token: 'preview', refresh_token: '', expires_at: 0 }, phase: 'owned' }
  }
  return { session: captureAuthHash() || readSession(), phase: 'form' }
}

export function BuyPage() {
  const start = initialState()
  const [session, setSession] = useState<AuthSession | null>(start.session)
  const [phase, setPhase] = useState<BuyState>(start.session && start.phase === 'form' ? 'ready' : start.phase)
  const [email, setEmail] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const ready = authConfig().ready || phase === 'sent' || phase === 'ready' || phase === 'owned'

  async function sendLink() {
    setBusy(true)
    setNote('')
    const result = await sendMagicLink(email.trim(), 'https://annotated.click/buy')
    setBusy(false)
    if (!result.ok) {
      setNote(result.reason === 'config' ? 'Sign-in is not set up on this site yet.' : 'The email could not be sent. Try again in a moment.')
      return
    }
    setPhase('sent')
  }

  async function continueToPayment() {
    if (!session || session.access_token === 'preview') {
      setPhase('owned')
      return
    }
    setBusy(true)
    setNote('')
    const { response, payload } = await accountRequest('/api/checkout', session, { method: 'POST' })
    setBusy(false)
    if (response.status === 401) {
      setSession(null)
      setPhase('form')
      setNote('That sign-in expired. Request a new link.')
      return
    }
    if (!payload || payload.ok !== true) {
      setNote('Payment could not start. Try again in a moment.')
      return
    }
    if (payload.next === 'account') {
      setPhase('owned')
      return
    }
    if (typeof payload.url === 'string') window.location.assign(payload.url)
  }

  return (
    <SiteShell>
      <SiteKicker>Unlock</SiteKicker>
      <h1>Get annotated.</h1>
      <p className="site-lead">$35 once, one Windows PC. Local notes stay free.</p>
      <section className="lp-feature-card site-card">
        {phase === 'sent' ? (
          <>
            <h2>Check your email.</h2>
            <p>The sign-in link is on its way. It opens this page again, and then you can continue to checkout.</p>
          </>
        ) : null}
        {phase === 'owned' ? (
          <>
            <h2>You already have Unlock.</h2>
            <p>This email has a license. Open your account to copy the key and download the app.</p>
            <div className="site-actions">
              <a className="lp-btn lp-btn-dark" href="/account">
                Open your account
              </a>
            </div>
          </>
        ) : null}
        {phase === 'ready' ? (
          <>
            <h2>Continue to checkout.</h2>
            <p>You are signed in. One payment covers this Windows PC.</p>
            <div className="site-actions">
              <button type="button" className="lp-btn lp-btn-dark" disabled={busy} onClick={() => void continueToPayment()}>
                {busy ? 'Opening checkout…' : 'Continue to checkout'}
              </button>
            </div>
          </>
        ) : null}
        {phase === 'form' ? (
          <form
            onSubmit={(event) => {
              event.preventDefault()
              void sendLink()
            }}
          >
            <h2>Sign in to buy.</h2>
            <p>We email a link. There is no password.</p>
            <label htmlFor="buy-email">Email</label>
            <input
              id="buy-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              disabled={!ready || busy}
              onChange={(event) => setEmail(event.target.value)}
            />
            <div className="site-actions">
              <button type="submit" className="lp-btn lp-btn-dark" disabled={busy || !authConfig().ready}>
                {busy ? 'Sending…' : 'Email me a sign-in link'}
              </button>
            </div>
          </form>
        ) : null}
        {note ? <p className="site-note">{note}</p> : null}
        {!authConfig().ready && phase === 'form' ? <p className="site-note">Sign-in is not set up on this site yet.</p> : null}
      </section>
      <div className="lp-stats site-trust">
        <article>
          <strong>$35</strong>
          <span>One-time payment</span>
        </article>
        <article>
          <strong>On-device</strong>
          <span>Notes stay on this PC</span>
        </article>
        <article>
          <strong>No bot</strong>
          <span>Nothing joins the call</span>
        </article>
      </div>
    </SiteShell>
  )
}
