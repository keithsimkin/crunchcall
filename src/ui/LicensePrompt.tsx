import { useState } from 'react'
import { PURCHASE_URL, REDEEM_URL } from './licenseGate'
import './licenseGate.css'

function openSite(url: string) {
  const open = window.crunchcall?.openExternal
  if (open) {
    void open(url)
    return
  }
  window.open(url, '_blank', 'noopener,noreferrer')
}

export function LicensePrompt({
  refresh,
  soft = false,
  onDismiss,
}: {
  refresh: () => Promise<unknown>
  soft?: boolean
  onDismiss?: () => void
}) {
  const [token, setToken] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [phase, setPhase] = useState<'idle' | 'checking' | 'ok' | 'rejected'>('idle')

  async function activate() {
    const activateLicense = window.crunchcall?.activateLicense
    if (!activateLicense) return
    setBusy(true)
    setPhase('checking')
    setError('')
    try {
      const result = await activateLicense(token.trim())
      if (!result.ok) {
        setPhase('rejected')
        setError(result.message)
        return
      }
      setPhase('ok')
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={soft ? 'license-gate soft' : 'license-gate'} role={soft ? 'dialog' : undefined} aria-modal={soft || undefined}>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void activate()
        }}
      >
        <h1>{soft ? 'Unlock to continue' : 'Add your license'}</h1>
        <p>
          {soft
            ? 'You can keep browsing. Paste a license when you want live cues and Unlock features.'
            : 'Paste the key from your account or from AppSumo. annotated checks it on this PC.'}
        </p>
        <textarea
          aria-label="License"
          rows={2}
          spellCheck={false}
          autoComplete="off"
          value={token}
          disabled={busy}
          placeholder="annotated1…"
          onChange={(event) => {
            setToken(event.target.value)
            if (phase !== 'idle') {
              setPhase('idle')
              setError('')
            }
          }}
        />
        {phase === 'checking' ? (
          <p className="license-status is-checking" role="status" aria-live="polite">
            Checking license…
          </p>
        ) : null}
        {phase === 'ok' ? (
          <p className="license-status is-ok" role="status" aria-live="polite">
            License activated on this PC.
          </p>
        ) : null}
        {phase === 'rejected' && error ? (
          <p className="license-status is-rejected" role="alert">
            {error}
          </p>
        ) : null}
        <button type="submit" className="btn primary" disabled={busy || !token.trim()}>
          {busy && phase === 'checking' ? 'Checking…' : phase === 'ok' ? 'Activated' : 'Activate'}
        </button>
        <div className="license-links">
          <a
            href={PURCHASE_URL}
            onClick={(event) => {
              event.preventDefault()
              openSite(PURCHASE_URL)
            }}
          >
            Get a license
          </a>
          <a
            href={REDEEM_URL}
            onClick={(event) => {
              event.preventDefault()
              openSite(REDEEM_URL)
            }}
          >
            I have an AppSumo code
          </a>
          {soft && onDismiss ? (
            <button type="button" className="text-btn" onClick={onDismiss}>
              Keep browsing
            </button>
          ) : null}
        </div>
      </form>
    </div>
  )
}
