import { useEffect, useState } from 'react'
import { WINDOWS_INSTALLER_URL } from './download'
import {
  accountRequest,
  authConfig,
  captureAuthHash,
  clearSession,
  readSession,
  sendMagicLink,
  type AuthSession,
} from './siteAuth'
import './account.css'

type Order = { order: string; license: string; maxDevices: number | null }
type Activation = { order: string; deviceId: string; label: string }

export function AccountPage() {
  const [session, setSession] = useState<AuthSession | null>(() => captureAuthHash() || readSession())
  const [email, setEmail] = useState('')
  const [orders, setOrders] = useState<Order[]>([])
  const [activations, setActivations] = useState<Activation[]>([])
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [copied, setCopied] = useState('')
  const ready = authConfig().ready

  useEffect(() => {
    if (!session) return
    let cancel = false
    void accountRequest('/api/account', session).then(({ response, payload }) => {
      if (cancel) return
      if (response.status === 401) {
        clearSession()
        setSession(null)
        return
      }
      if (!payload || payload.ok !== true) {
        setError('The account could not be loaded.')
        return
      }
      setOrders(Array.isArray(payload.orders) ? payload.orders : [])
      setActivations(Array.isArray(payload.activations) ? payload.activations : [])
    })
    return () => {
      cancel = true
    }
  }, [session])

  async function sendLink() {
    setError('')
    const result = await sendMagicLink(email.trim(), 'https://annotated.click/account')
    if (!result.ok) {
      setError(result.reason === 'config' ? 'Sign-in is not set up on this site yet.' : 'The email could not be sent. Try again.')
      return
    }
    setMessage('Check that inbox for a sign-in link.')
  }

  async function copy(license: string) {
    try {
      await navigator.clipboard.writeText(license)
      setCopied(license)
    } catch {
      setCopied('')
    }
  }

  async function deactivate(order: string, deviceId: string) {
    if (!session) return
    setError('')
    const { payload } = await accountRequest('/api/account/deactivate', session, {
      method: 'POST',
      body: JSON.stringify({ orderId: order, deviceId }),
    })
    if (!payload || payload.ok !== true) {
      setError('That PC could not be deactivated. Try again.')
      return
    }
    setActivations((current) => current.filter((row) => !(row.order === order && row.deviceId === deviceId)))
  }

  return (
    <div className="account-page">
      <main>
        <h1>Your annotated account</h1>
        <p className="lede">One Dodo purchase is one license and one Windows PC. Each AppSumo code is its own key.</p>
        <a className="download" href={WINDOWS_INSTALLER_URL}>
          Download annotated for Windows
        </a>
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
            <button type="submit" disabled={!ready}>
              Email me a sign-in link
            </button>
            {message ? <p>{message}</p> : null}
            {error ? <p className="alert">{error}</p> : null}
          </form>
        ) : (
          <>
            {orders.length === 0 ? <p>No license is on this email yet.</p> : null}
            {orders.map((order) => (
              <article key={order.order}>
                <label htmlFor={`key-${order.order}`}>{order.order.startsWith('appsumo_') ? 'AppSumo key' : 'Unlock key'}</label>
                <textarea id={`key-${order.order}`} rows={2} readOnly value={order.license} />
                <button type="button" className="ghost" onClick={() => void copy(order.license)}>
                  {copied === order.license ? 'Copied' : 'Copy key'}
                </button>
                {activations
                  .filter((row) => row.order === order.order)
                  .map((row) => (
                    <div className="device" key={row.deviceId}>
                      <span>{row.label || 'This PC'}</span>
                      <button type="button" className="ghost" onClick={() => void deactivate(order.order, row.deviceId)}>
                        Deactivate
                      </button>
                    </div>
                  ))}
              </article>
            ))}
            {error ? <p className="alert">{error}</p> : null}
            <button
              type="button"
              className="ghost"
              onClick={() => {
                clearSession()
                setSession(null)
              }}
            >
              Sign out
            </button>
          </>
        )}
      </main>
    </div>
  )
}
