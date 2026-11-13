import { useEffect, useState } from 'react'
import { WINDOWS_INSTALLER_URL } from './download'
import { SiteKicker, SiteShell } from './SiteShell'
import {
  accountRequest,
  authConfig,
  captureAuthHash,
  clearSession,
  readSession,
  sendMagicLink,
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

export function AccountPage() {
  const preview = previewAccount()
  const [session, setSession] = useState<AuthSession | null>(initialSession)
  const [email, setEmail] = useState('')
  const [accountEmail, setAccountEmail] = useState(preview?.email ?? '')
  const [orders, setOrders] = useState<Order[] | null>(preview ? preview.orders : null)
  const [activations, setActivations] = useState<Activation[]>(preview?.activations ?? [])
  const [revealed, setRevealed] = useState<Record<string, boolean>>({})
  const [copied, setCopied] = useState('')
  const [note, setNote] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)

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
    const result = await sendMagicLink(email.trim(), 'https://annotated.click/account')
    setBusy(false)
    if (!result.ok) {
      setNote(result.reason === 'config' ? 'Sign-in is not set up on this site yet.' : 'The email could not be sent. Try again in a moment.')
      return
    }
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

  return (
    <SiteShell email={signedIn ? accountEmail || undefined : undefined} onSignOut={signedIn ? signOut : undefined}>
      <SiteKicker>Account</SiteKicker>
      <h1>Your annotated.</h1>
      <p className="site-lead">One purchase is one Windows PC. Each AppSumo code is another.</p>

      {!signedIn ? (
        <section className="lp-feature-card site-card">
          {sent ? (
            <>
              <h2>Check your email.</h2>
              <p>The sign-in link opens this page with your keys.</p>
            </>
          ) : (
            <form
              onSubmit={(event) => {
                event.preventDefault()
                void sendLink()
              }}
            >
              <h2>Sign in to buy.</h2>
              <p>We email a link. There is no password.</p>
              <label htmlFor="account-email">Email</label>
              <input
                id="account-email"
                type="email"
                autoComplete="email"
                required
                value={email}
                disabled={busy}
                onChange={(event) => setEmail(event.target.value)}
              />
              <div className="site-actions">
                <button type="submit" className="lp-btn lp-btn-dark" disabled={busy || !authConfig().ready}>
                  {busy ? 'Sending…' : 'Email me a sign-in link'}
                </button>
              </div>
            </form>
          )}
          {note ? <p className="site-note">{note}</p> : null}
          {!authConfig().ready && !sent ? <p className="site-note">Sign-in is not set up on this site yet.</p> : null}
        </section>
      ) : (
        <>
          <section className="lp-feature-card site-card site-download">
            <div>
              <h2>Windows</h2>
              <p>The signed installer. Notes stay on that PC.</p>
            </div>
            <a className="lp-btn lp-btn-dark" href={WINDOWS_INSTALLER_URL}>
              Download annotated for Windows
            </a>
          </section>
          {orders === null ? <p className="site-note">Loading your licenses…</p> : null}
          {orders && orders.length === 0 ? (
            <section className="lp-feature-card site-card">
              <h2>No license yet.</h2>
              <p>Buy Unlock once, or redeem an AppSumo code.</p>
              <div className="site-actions">
                <a className="lp-btn lp-btn-dark" href="/buy">
                  Buy Unlock
                </a>
                <a className="lp-btn lp-btn-ghost" href="/redeem">
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
              compact
              order={order}
              activations={activations.filter((row) => row.order === order.order)}
              revealed={Boolean(revealed[order.order])}
              copied={copied === order.license}
              onReveal={() => setRevealed((current) => ({ ...current, [order.order]: !current[order.order] }))}
              onCopy={() => void copy(order.license)}
              onDeactivate={(deviceId) => void deactivate(order.order, deviceId)}
            />
          ))}
          {note ? <p className="site-note">{note}</p> : null}
        </>
      )}
    </SiteShell>
  )
}

function LicenseCard({
  title,
  compact,
  order,
  activations,
  revealed,
  copied,
  onReveal,
  onCopy,
  onDeactivate,
}: {
  title: string
  compact?: boolean
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
    <section className={compact ? 'lp-feature-card site-card site-keycard is-code' : 'lp-feature-card site-card site-keycard'}>
      <h2>{title}</h2>
      <p>{order.maxDevices === 1 ? 'One Windows PC.' : 'On this account.'}</p>
      <label htmlFor={`key-${order.order}`}>License key</label>
      <textarea id={`key-${order.order}`} className="site-key" readOnly value={revealed ? order.license : maskKey(order.license)} />
      <div className="site-meta">
        <span>{active ? `Active on ${activations.length === 1 ? '1 PC' : `${activations.length} PCs`}` : 'Not active on a PC yet'}</span>
      </div>
      <div className="site-actions">
        <button type="button" className="lp-btn lp-btn-dark" onClick={onCopy}>
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button type="button" className="lp-btn lp-btn-ghost" onClick={onReveal}>
          {revealed ? 'Hide' : 'Reveal'}
        </button>
      </div>
      {activations.map((row) => (
        <div className="site-device" key={row.deviceId}>
          <span>{row.label || 'This PC'}</span>
          <button type="button" className="lp-btn lp-btn-ghost" onClick={() => onDeactivate(row.deviceId)}>
            Deactivate
          </button>
        </div>
      ))}
    </section>
  )
}
