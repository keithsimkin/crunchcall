import { useState } from 'react'
import { accountRequest, authConfig, captureAuthHash, readSession, sendMagicLink, type AuthSession } from './siteAuth'
import './account.css'

export function BuyPage() {
  const [session, setSession] = useState<AuthSession | null>(() => captureAuthHash() || readSession())
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const ready = authConfig().ready

  async function sendLink() {
    setBusy(true)
    setError('')
    setMessage('')
    const result = await sendMagicLink(email.trim(), 'https://annotated.click/buy')
    setBusy(false)
    if (!result.ok) {
      setError(result.reason === 'config' ? 'Sign-in is not set up on this site yet.' : 'The email could not be sent. Try again.')
      return
    }
    setMessage('Check that inbox for a sign-in link. It brings you back here.')
  }

  async function continueToPayment() {
    if (!session) return
    setBusy(true)
    setError('')
    const { response, payload } = await accountRequest('/api/checkout', session, { method: 'POST' })
    setBusy(false)
    if (response.status === 401) {
      setSession(null)
      setError('That sign-in expired. Request a new link.')
      return
    }
    if (!payload || payload.ok !== true) {
      setError('Payment could not start. Try again in a moment.')
      return
    }
    if (payload.next === 'account') {
      window.location.assign('/account')
      return
    }
    if (typeof payload.url === 'string') window.location.assign(payload.url)
  }

  return (
    <div className="account-page">
      <main>
        <h1>Buy annotated</h1>
        <p className="lede">Unlock is $35, once, for one Windows PC. Local notes stay free.</p>
        {!ready ? <p className="alert">Sign-in is not set up on this site yet.</p> : null}
        {!session ? (
          <form
            onSubmit={(event) => {
              event.preventDefault()
              void sendLink()
            }}
          >
            <label htmlFor="email">Email</label>
            <input id="email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
            <button type="submit" disabled={busy || !ready}>
              Email me a sign-in link
            </button>
            {message ? <p>{message}</p> : null}
            {error ? <p className="alert">{error}</p> : null}
          </form>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault()
              void continueToPayment()
            }}
          >
            <p>You are signed in. Continue to payment, or open the account if you already bought Unlock.</p>
            <button type="submit" disabled={busy}>
              Continue to payment
            </button>
            {error ? <p className="alert">{error}</p> : null}
          </form>
        )}
      </main>
    </div>
  )
}
