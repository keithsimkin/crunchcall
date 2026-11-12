import { useEffect, useState } from 'react'
import {
  accountChoices,
  beginAccountConnect,
  cancelAccountConnect,
  disconnectAccount,
  readCalendarSignIn,
  watchAccount,
  type AccountCalendar,
  type CalendarProvider,
  type CalendarSignIn,
} from '../features/calendar/store'
import { useCalendarClock } from './useCalendar'

type Picker = {
  provider: CalendarProvider
  account: string
  calendars: Array<AccountCalendar & { checked?: boolean }>
  chosen: Record<string, boolean>
}

export function AccountConnect({ plain = false }: { plain?: boolean }) {
  const desktop = typeof window !== 'undefined' && !!window.crunchcall?.connectCalendar
  const { calendar } = useCalendarClock()
  const [signIn, setSignIn] = useState<CalendarSignIn | null>(null)
  const [busy, setBusy] = useState<CalendarProvider | null>(null)
  const [signingIn, setSigningIn] = useState(false)
  const [picker, setPicker] = useState<Picker | null>(null)

  useEffect(() => {
    if (!desktop) return
    let live = true
    void readCalendarSignIn().then((next) => {
      if (live) setSignIn(next)
    })
    return () => {
      live = false
    }
  }, [desktop, calendar.error, calendar.syncedAt])

  if (!desktop) return null

  async function reload() {
    setSignIn(await readCalendarSignIn())
  }

  function openPicker(provider: CalendarProvider, account: string, calendars: Picker['calendars']) {
    const saved =
      calendar.source?.kind === 'account' && calendar.source.provider === provider ? calendar.source.calendars : null
    const chosen: Record<string, boolean> = {}
    for (const item of calendars) {
      chosen[item.id] = saved ? saved.some((entry) => entry.id === item.id) : item.checked === true
    }
    if (!Object.values(chosen).some(Boolean) && calendars[0]) chosen[calendars[0].id] = true
    setPicker({ provider, account, calendars, chosen })
  }

  async function connect(provider: CalendarProvider) {
    setBusy(provider)
    setSigningIn(true)
    setPicker(null)
    try {
      const result = await beginAccountConnect(provider)
      if (result.ok) openPicker(result.provider, result.account, result.calendars)
      await reload()
    } finally {
      setBusy(null)
      setSigningIn(false)
    }
  }

  async function choose(provider: CalendarProvider) {
    setBusy(provider)
    try {
      const result = await accountChoices(provider)
      if (result.ok) openPicker(provider, result.account, result.calendars)
    } finally {
      setBusy(null)
    }
  }

  async function confirm() {
    if (!picker) return
    const selected = picker.calendars.filter((item) => picker.chosen[item.id])
    setBusy(picker.provider)
    try {
      await watchAccount(picker.provider, picker.account, selected)
      if (selected.length > 0) setPicker(null)
      await reload()
    } finally {
      setBusy(null)
    }
  }

  async function disconnect(provider: CalendarProvider) {
    setBusy(provider)
    try {
      await disconnectAccount(provider)
      if (picker?.provider === provider) setPicker(null)
      await reload()
    } finally {
      setBusy(null)
    }
  }

  const ready = signIn?.configured
  const showSetupNote = signIn !== null && !ready?.google && !ready?.microsoft

  return (
    <div className={plain ? 'cal-connect' : 'cal-block'}>
      <p className="set-label">Google or Outlook</p>
      <p className="help">
        {showSetupNote
          ? 'Sign-in is not set up in this copy yet. A private calendar link still works.'
          : 'Sign in once. annotated reads the calendars you pick and keeps that permission on this PC.'}
      </p>
      <div className="cal-actions">
        {ready?.google && !signIn?.connected.google ? (
          <button type="button" className="btn small primary" disabled={busy !== null} onClick={() => void connect('google')}>
            {busy === 'google' && signingIn ? 'Waiting for Google…' : 'Connect Google'}
          </button>
        ) : null}
        {ready?.microsoft && !signIn?.connected.microsoft ? (
          <button type="button" className="btn small primary" disabled={busy !== null} onClick={() => void connect('microsoft')}>
            {busy === 'microsoft' && signingIn ? 'Waiting for Outlook…' : 'Connect Outlook'}
          </button>
        ) : null}
        {signingIn ? (
          <button type="button" className="btn small ghost" onClick={() => void cancelAccountConnect()}>
            Cancel
          </button>
        ) : null}
      </div>
      {signIn?.connected.google ? (
        <AccountRow
          label="Google"
          account={signIn.connected.google}
          busy={busy !== null}
          onChoose={() => void choose('google')}
          onDisconnect={() => void disconnect('google')}
        />
      ) : null}
      {signIn?.connected.microsoft ? (
        <AccountRow
          label="Outlook"
          account={signIn.connected.microsoft}
          busy={busy !== null}
          onChoose={() => void choose('microsoft')}
          onDisconnect={() => void disconnect('microsoft')}
        />
      ) : null}
      {picker ? (
        <div className="cal-connect">
          <p className="help">
            Choose which {picker.provider === 'google' ? 'Google' : 'Outlook'} calendars to watch for {picker.account}.
          </p>
          <ul className="cal-picks">
            {picker.calendars.map((item) => (
              <li key={item.id}>
                <label className="cal-pick">
                  <input
                    type="checkbox"
                    checked={picker.chosen[item.id] === true}
                    onChange={() =>
                      setPicker((current) =>
                        current
                          ? { ...current, chosen: { ...current.chosen, [item.id]: !current.chosen[item.id] } }
                          : current,
                      )
                    }
                  />
                  <span>{item.name}</span>
                </label>
              </li>
            ))}
          </ul>
          <div className="cal-actions">
            <button type="button" className="btn small primary" disabled={busy !== null} onClick={() => void confirm()}>
              {busy === picker.provider && !signingIn ? 'Syncing…' : 'Sync these'}
            </button>
            <button type="button" className="btn small ghost" disabled={busy !== null} onClick={() => setPicker(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function AccountRow({
  label,
  account,
  busy,
  onChoose,
  onDisconnect,
}: {
  label: string
  account: string
  busy: boolean
  onChoose: () => void
  onDisconnect: () => void
}) {
  return (
    <div className="cal-account">
      <p>
        {label} · {account}
      </p>
      <div className="cal-actions">
        <button type="button" className="btn small ghost" disabled={busy} onClick={onChoose}>
          Choose calendars
        </button>
        <button type="button" className="btn small ghost" disabled={busy} onClick={onDisconnect}>
          Disconnect
        </button>
      </div>
    </div>
  )
}
