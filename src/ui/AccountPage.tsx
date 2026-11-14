import { useEffect, useState } from 'react'
import { WINDOWS_INSTALLER_URL } from './download'
import { SiteShell } from './SiteShell'
import { SUPPORT_EMAIL } from './legalCopy'
import {
  accountRequest,
  authConfig,
  captureAuthError,
  captureAuthHash,
  clearSession,
  consumeAuthToken,
  hasAuthCallback,
  readSession,
  sendMagicLink,
  takeAuthError,
  type AuthSession,
} from './siteAuth'

type Order = { order: string; license: string; maxDevices: number | null }
type Activation = { order: string; deviceId: string; label: string }

function maskKey(license: string) {
  if (license.length < 16) return '•••• •••• ••••'
  return `${license.slice(0, 12)}…${license.slice(-4)}`
}

function previewAccount(): { email: string; orders: Order[]; activations: Activation[] } | null {
  if (typeof window === 'undefined') return null
  const preview = new URLSearchParams(window.location.search).get('preview')
  if (preview === 'empty') return { email: 'buyer@example.com', orders: [], activations: [] }
  if (preview === 'keys') {
    return {
      email: 'buyer@example.com',
      orders: [
        { order: 'pay_order1234', license: 'annotated1.preview-key-value.signature', maxDevices: 1 },
        { order: 'appsumo_ANN-TEST-CODE-0001', license: 'annotated1.appsumo-preview.signature', maxDevices: 1 },
      ],
      activations: [{ order: 'pay_order1234', deviceId: 'ab'.repeat(32), label: 'Office PC' }],
    }
  }
  return null
}

function initialSession(): AuthSession | null {
  if (previewAccount()) return { access_token: 'preview', refresh_token: '', expires_at: 0 }
  if (typeof window === 'undefined') return null
  return captureAuthHash() || readSession()
}

function readBootNote(): { message: string; kind: 'ok' | 'error' | 'info' } {
  if (typeof window === 'undefined') return { message: '', kind: 'info' }
  const fromCallback = captureAuthError()
  if (fromCallback) return { message: fromCallback.message, kind: 'error' }
  const stashed = takeAuthError()
  if (stashed) return { message: stashed, kind: 'error' }
  return { message: '', kind: 'info' }
}

export function AccountPage() {
  const preview = previewAccount()
  const [session, setSession] = useState<AuthSession | null>(initialSession)
  const [email, setEmail] = useState('')
  const [accountEmail, setAccountEmail] = useState(preview?.email ?? '')
  const [orders, setOrders] = useState<Order[] | null>(preview ? preview.orders : null)
  const [activations, setActivations] = useState<Activation[]>(preview?.activations ?? [])
  const [revealed, setRevealed] = useState<Record<string, boolean>>({})
  const [copied, setCopied] = useState('')
  const [boot] = useState(readBootNote)
  const [note, setNote] = useState(boot.message)
  const [noteKind, setNoteKind] = useState<'ok' | 'error' | 'info'>(boot.kind)
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [signingIn, setSigningIn] = useState(() => typeof window !== 'undefined' && hasAuthCallback() && !readSession())

  useEffect(() => {
    let cancel = false
    void consumeAuthToken().then(({ session: next, error }) => {
      if (cancel) return
      setSigningIn(false)
      if (error) {
        setNoteKind('error')
        setNote(error)
        return
      }
      if (next) setSession(next)
    })
    return () => {
      cancel = true
    }
  }, [])

  useEffect(() => {
    if (!session || session.access_token === 'preview') return
    let cancel = false
    void accountRequest('/api/account', session).then(({ response, payload }) => {
      if (cancel) return
      if (response.status === 401) {
        clearSession()
        setSession(null)
        setOrders(null)
        return
      }
      if (!payload || payload.ok !== true) {
        setNoteKind('error')
        setNote('The account could not be loaded. Refresh and try again.')
        setOrders([])
        return
      }
      setAccountEmail(typeof payload.email === 'string' ? payload.email : '')
      setOrders(Array.isArray(payload.orders) ? payload.orders : [])
      setActivations(Array.isArray(payload.activations) ? payload.activations : [])
    })
    return () => {
      cancel = true
    }
  }, [session])

  async function sendLink() {
    setBusy(true)
    setNote('')
    setNoteKind('info')
    const redirectTo = `${window.location.origin}/account`
    const result = await sendMagicLink(email.trim(), redirectTo)
    setBusy(false)
    if (!result.ok) {
      setNoteKind('error')
      setNote(result.reason === 'config' ? 'Sign-in is not set up on this site yet.' : 'The email could not be sent. Try again in a moment.')
      return
    }
    setNoteKind('ok')
    setSent(true)
  }

  async function copy(license: string) {
    try {
      await navigator.clipboard.writeText(license)
      setCopied(license)
    } catch {
      setNote('Select the key and copy it.')
    }
  }

  async function deactivate(order: string, deviceId: string) {
    if (!session || session.access_token === 'preview') {
      setActivations((current) => current.filter((row) => !(row.order === order && row.deviceId === deviceId)))
      return
    }
    setNote('')
    const { payload } = await accountRequest('/api/account/deactivate', session, {
      method: 'POST',
      body: JSON.stringify({ orderId: order, deviceId }),
    })
    if (!payload || payload.ok !== true) {
      setNote('That PC could not be deactivated. Try again in a moment.')
      return
    }
    setActivations((current) => current.filter((row) => !(row.order === order && row.deviceId === deviceId)))
  }

  function signOut() {
    clearSession()
    setSession(null)
    setOrders(null)
    setAccountEmail('')
  }

  const signedIn = Boolean(session)
  const dodo = (orders || []).filter((order) => !order.order.startsWith('appsumo_'))
  const codes = (orders || []).filter((order) => order.order.startsWith('appsumo_'))
  const noteClass = noteKind === 'error' ? 'site-pass-note is-error' : noteKind === 'ok' ? 'site-pass-note is-ok' : 'site-pass-note'

  if (signingIn && !signedIn) {
    return (
      <SiteShell tone="auth">
        <div className="site-login">
          <section className="site-pass">
            <h1>Signing you in…</h1>
            <p className="site-pass-lead">One moment while we open your account.</p>
          </section>
        </div>
      </SiteShell>
    )
  }

  if (!signedIn) {
    return (
      <SiteShell tone="auth">
        <div className="site-login">
          <section className="site-pass">
            {sent ? (
              <>
                <h1>Check your inbox</h1>
                <p className="site-pass-lead">
                  We emailed a sign-in link{email ? ` to ${email}` : ''}. Open it to land back here with your
                  licenses.
                </p>
                <p className="site-pass-note is-ok">
                  Sent from hello@annotated.click. If you do not see it in a minute, check your spam or junk
                  folder.
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
                  <a href={`mailto:${SUPPORT_EMAIL}?subject=annotated%20sign-in%20help`}>Email us</a>
                </p>
              </>
            ) : (
              <form
                onSubmit={(event) => {
                  event.preventDefault()
                  void sendLink()
                }}
              >
                <h1>Account login</h1>
                <p className="site-pass-lead">Hey — enter your email to sign in to your annotated account.</p>
                <label htmlFor="account-email">Email</label>
                <input
                  id="account-email"
                  type="email"
                  autoComplete="email"
                  required
                  placeholder="you@company.com"
                  value={email}
                  disabled={busy}
                  onChange={(event) => setEmail(event.target.value)}
                />
                <p className="site-pass-help">
                  No password. Having trouble?{' '}
                  <a href={`mailto:${SUPPORT_EMAIL}?subject=annotated%20sign-in%20help`}>Email us</a>
                </p>
                <button type="submit" className="site-pass-go" disabled={busy || !authConfig().ready}>
                  {busy ? 'Sending…' : 'Sign in'}
                </button>
              </form>
            )}
            {note ? (
              <p className={noteClass} role={noteKind === 'error' ? 'alert' : 'status'}>
                {note}
              </p>
            ) : null}
            {!authConfig().ready && !sent ? <p className="site-pass-note is-error">Sign-in is not set up on this site yet.</p> : null}
            <a className="site-pass-download" href={WINDOWS_INSTALLER_URL}>
              Download annotated for Windows
            </a>
            <p className="site-pass-foot">
              Don&apos;t have an account? <a href="/buy">Buy Unlock</a>
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

  return (
    <SiteShell tone="desk" email={accountEmail || undefined} onSignOut={signOut}>
      <div className="site-desk">
        <header className="site-desk-head">
          <h1>Your keys</h1>
          <p>One purchase is one Windows PC. Each AppSumo code is another.</p>
        </header>

        <section className="site-desk-card">
          <h2>Windows</h2>
          <p>The signed installer. Notes stay on that PC.</p>
          <div className="site-desk-actions">
            <a className="is-primary" href={WINDOWS_INSTALLER_URL}>
              Download annotated
            </a>
          </div>
        </section>

        {orders === null ? <p className="site-desk-note">Loading your licenses…</p> : null}

        {orders && orders.length === 0 ? (
          <section className="site-desk-card">
            <h2>No license yet</h2>
            <p>Buy Unlock once, or redeem an AppSumo code.</p>
            <div className="site-desk-actions">
              <a className="is-primary" href="/buy">
                Buy Unlock
              </a>
              <a className="is-quiet" href="/redeem">
                Redeem a code
              </a>
            </div>
          </section>
        ) : null}

        {dodo.map((order) => (
          <LicenseCard
            key={order.order}
            title="Unlock"
            order={order}
            activations={activations.filter((row) => row.order === order.order)}
            revealed={Boolean(revealed[order.order])}
            copied={copied === order.license}
            onReveal={() => setRevealed((current) => ({ ...current, [order.order]: !current[order.order] }))}
            onCopy={() => void copy(order.license)}
            onDeactivate={(deviceId) => void deactivate(order.order, deviceId)}
          />
        ))}
        {codes.map((order) => (
          <LicenseCard
            key={order.order}
            title="AppSumo"
            order={order}
            activations={activations.filter((row) => row.order === order.order)}
            revealed={Boolean(revealed[order.order])}
            copied={copied === order.license}
            onReveal={() => setRevealed((current) => ({ ...current, [order.order]: !current[order.order] }))}
            onCopy={() => void copy(order.license)}
            onDeactivate={(deviceId) => void deactivate(order.order, deviceId)}
          />
        ))}
        {note ? <p className="site-desk-note">{note}</p> : null}
      </div>
    </SiteShell>
  )
}

function LicenseCard({
  title,
  order,
  activations,
  revealed,
  copied,
  onReveal,
  onCopy,
  onDeactivate,
}: {
  title: string
  order: Order
  activations: Activation[]
  revealed: boolean
  copied: boolean
  onReveal: () => void
  onCopy: () => void
  onDeactivate: (deviceId: string) => void
}) {
  const active = activations.length > 0
  return (
    <section className="site-desk-card">
      <h2>{title}</h2>
      <p>{order.maxDevices === 1 ? 'One Windows PC.' : 'On this account.'}</p>
      <label htmlFor={`key-${order.order}`}>License key</label>
      <textarea id={`key-${order.order}`} className="site-key" readOnly value={revealed ? order.license : maskKey(order.license)} />
      <p className="site-desk-meta">
        {active ? `Active on ${activations.length === 1 ? '1 PC' : `${activations.length} PCs`}` : 'Not active on a PC yet'}
      </p>
      <div className="site-desk-actions">
        <button type="button" className="is-primary" onClick={onCopy}>
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button type="button" className="is-quiet" onClick={onReveal}>
          {revealed ? 'Hide' : 'Reveal'}
        </button>
      </div>
      {activations.map((row) => (
        <div className="site-desk-device" key={row.deviceId}>
          <span>{row.label || 'This PC'}</span>
          <button type="button" className="is-quiet" onClick={() => onDeactivate(row.deviceId)}>
            Deactivate
          </button>
        </div>
      ))}
    </section>
  )
}
