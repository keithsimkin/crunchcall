import { useEffect, useState } from 'react'
import { WINDOWS_INSTALLER_URL } from './download'
import { SiteShell } from './SiteShell'
import { SUPPORT_EMAIL } from './legalCopy'
import {
  accountRequest,
  authConfig,
  captureAuthError,
  captureAuthHash,
  consumeAuthToken,
  hasAuthCallback,
  readSession,
  sendMagicLink,
  takeAuthError,
  type AuthSession,
} from './siteAuth'

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

function readBootNote(): { message: string; kind: 'ok' | 'error' | 'info' } {
  if (typeof window === 'undefined') return { message: '', kind: 'info' }
  const fromCallback = captureAuthError()
  if (fromCallback) return { message: fromCallback.message, kind: 'error' }
  const stashed = takeAuthError()
  if (stashed) return { message: stashed, kind: 'error' }
  return { message: '', kind: 'info' }
}

export function BuyPage() {
  const start = initialState()
  const [session, setSession] = useState<AuthSession | null>(start.session)
  const [phase, setPhase] = useState<BuyState>(start.session && start.phase === 'form' ? 'ready' : start.phase)
  const [email, setEmail] = useState('')
  const [boot] = useState(readBootNote)
  const [note, setNote] = useState(boot.message)
  const [noteKind, setNoteKind] = useState<'ok' | 'error' | 'info'>(boot.kind)
  const [busy, setBusy] = useState(false)
  const [signingIn, setSigningIn] = useState(() => typeof window !== 'undefined' && hasAuthCallback() && !readSession())
  const ready = authConfig().ready || phase === 'sent' || phase === 'ready' || phase === 'owned'
  const noteClass = noteKind === 'error' ? 'site-pass-note is-error' : noteKind === 'ok' ? 'site-pass-note is-ok' : 'site-pass-note'

  useEffect(() => {
    let cancel = false
    void consumeAuthToken().then(({ session: next, error }) => {
      if (cancel) return
      setSigningIn(false)
      if (error) {
        setNoteKind('error')
        setNote(error)
        setPhase('form')
        return
      }
      if (next) {
        setSession(next)
        setPhase('ready')
      }
    })
    return () => {
      cancel = true
    }
  }, [])

  async function sendLink() {
    setBusy(true)
    setNote('')
    setNoteKind('info')
    const result = await sendMagicLink(email.trim(), `${window.location.origin}/buy`)
    setBusy(false)
    if (!result.ok) {
      setNoteKind('error')
      setNote(result.reason === 'config' ? 'Sign-in is not set up on this site yet.' : 'The email could not be sent. Try again in a moment.')
      return
    }
    setNoteKind('ok')
    setPhase('sent')
  }

  async function continueToPayment() {
    if (!session || session.access_token === 'preview') {
      setPhase('owned')
      return
    }
    setBusy(true)
    setNote('')
    setNoteKind('info')
    const { response, payload } = await accountRequest('/api/checkout', session, { method: 'POST' })
    setBusy(false)
    if (response.status === 401) {
      setSession(null)
      setPhase('form')
      setNoteKind('error')
      setNote('That sign-in expired. Request a new link.')
      return
    }
    if (!payload || payload.ok !== true) {
      setNoteKind('error')
      setNote('Payment could not start. Try again in a moment.')
      return
    }
    if (payload.next === 'account') {
      setPhase('owned')
      return
    }
    if (typeof payload.url === 'string') window.location.assign(payload.url)
  }

  if (signingIn && !session) {
    return (
      <SiteShell tone="auth">
        <div className="site-login">
          <section className="site-pass">
            <h1>Signing you in…</h1>
            <p className="site-pass-lead">One moment while we continue to checkout.</p>
          </section>
        </div>
      </SiteShell>
    )
  }

  return (
    <SiteShell tone="auth">
      <div className="site-login">
        <section className="site-pass">
          {phase === 'sent' ? (
            <>
              <h1>Check your inbox</h1>
              <p className="site-pass-lead">
                We emailed a sign-in link{email ? ` to ${email}` : ''}. Open it to continue to checkout.
              </p>
              <p className="site-pass-note is-ok">
                Sent from hello@annotated.click. If you do not see it in a minute, check your spam or junk folder.
              </p>
              <button
                type="button"
                className="site-pass-go"
                disabled={busy || !email.trim()}
                onClick={() => void sendLink()}
              >
                {busy ? 'Sending…' : 'Send the email again'}
              </button>
              <p className="site-pass-help">
                Still nothing?{' '}
                <a href={`mailto:${SUPPORT_EMAIL}?subject=annotated%20buy%20help`}>Email us</a>
              </p>
            </>
          ) : null}
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
          {phase === 'ready' ? (
            <>
              <h1>Continue to checkout</h1>
              <p className="site-pass-lead">You are signed in. One payment covers this Windows PC.</p>
              <button type="button" className="site-pass-go" disabled={busy} onClick={() => void continueToPayment()}>
                {busy ? 'Opening checkout…' : 'Continue to checkout'}
              </button>
            </>
          ) : null}
          {phase === 'form' ? (
            <form
              onSubmit={(event) => {
                event.preventDefault()
                void sendLink()
              }}
            >
              <h1>Buy Unlock</h1>
              <p className="site-pass-lead">Hey — enter your email and we will send a sign-in link. No password.</p>
              <label htmlFor="buy-email">Email</label>
              <input
                id="buy-email"
                type="email"
                autoComplete="email"
                required
                placeholder="you@company.com"
                value={email}
                disabled={!ready || busy}
                onChange={(event) => setEmail(event.target.value)}
              />
              <p className="site-pass-help">
                Having trouble?{' '}
                <a href={`mailto:${SUPPORT_EMAIL}?subject=annotated%20buy%20help`}>Email us</a>
              </p>
              <button type="submit" className="site-pass-go" disabled={busy || !authConfig().ready}>
                {busy ? 'Sending…' : 'Sign in to buy'}
              </button>
            </form>
          ) : null}
          {note ? (
            <p className={noteClass} role={noteKind === 'error' ? 'alert' : 'status'}>
              {note}
            </p>
          ) : null}
          {!authConfig().ready && phase === 'form' ? (
            <p className="site-pass-note is-error">Sign-in is not set up on this site yet.</p>
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
