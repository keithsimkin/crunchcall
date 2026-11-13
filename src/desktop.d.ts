import type { CalendarEvent } from './features/calendar/ics'

export type CalendarProvider = 'google' | 'microsoft'

export type AccountCalendar = { id: string; name: string; checked?: boolean }

export type CalendarFetchResult = { ok: true; text: string } | { ok: false; error: string }

export type CalendarConnectResult =
  | { ok: true; provider: CalendarProvider; account: string; calendars: AccountCalendar[] }
  | { ok: false; error: string; cancelled?: boolean }

export type CalendarSyncResult = { ok: true; events: CalendarEvent[] } | { ok: false; error: string }

export type CalendarSignIn = {
  configured: { google: boolean; microsoft: boolean }
  connected: { google: string | null; microsoft: string | null }
}

export type CalendarNotifyPayload = {
  instanceKey: string
  title: string
  body: string
}

export type AppCommand = 'dashboard' | 'meeting' | 'calendar' | 'projects' | 'settings' | 'updates'

export type UpdateStatus = {
  phase: 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'downloaded'
  version: string
  percent: number
}

export type LicenseAuthenticity = 'development' | 'genuine' | 'unsigned' | 'tampered' | 'untrusted' | 'unknown'

export type LicenseStatus = {
  tier: 'free' | 'unlock'
  email: string
  order: string
  license: 'none' | 'valid' | 'invalid'
  authenticity: LicenseAuthenticity
  signer: string
  detail: string
  seat?: 'open' | 'active' | 'inactive' | 'blocked'
  seatDetail?: string
}

export type LicenseActivateResult = { ok: true; status: LicenseStatus } | { ok: false; message: string }

export type AppNotice = {
  title: string
  body?: string
  url?: string
  focus?: boolean
}

export type OverlayCue = { label: string; message: string }

export type OverlayLine = { id: string; speaker: string; text: string }

export type OverlayPosition = 'center' | 'top-right' | 'top-left' | 'bottom-center'

export type OverlaySession = {
  meetingId: string
  title: string
  elapsed: string
  listening: boolean
  opacity: number
  position: OverlayPosition
  cue: OverlayCue | null
  lines: OverlayLine[]
}

export type OverlayAction = 'open' | 'end' | 'pause' | 'resume' | 'dismiss'

declare global {
  const __CRUNCHCALL_VERSION__: string
  interface Window {
    crunchcall?: {
      fetchCalendar: (url: string) => Promise<CalendarFetchResult>
      calendarSignIn: () => Promise<CalendarSignIn>
      connectCalendar: (provider: CalendarProvider) => Promise<CalendarConnectResult>
      calendarChoices: (provider: CalendarProvider) => Promise<CalendarConnectResult>
      syncCalendar: (
        provider: CalendarProvider,
        calendars: { id: string; name: string }[],
        range: { start: number; end: number },
      ) => Promise<CalendarSyncResult>
      disconnectCalendar: (provider: CalendarProvider) => Promise<void>
      cancelCalendarSignIn: () => Promise<void>
      notify: (payload: CalendarNotifyPayload) => Promise<void>
      setWatching: (on: boolean) => Promise<void>
      setChrome: (theme: 'light' | 'dark') => Promise<void>
      onStart: (callback: (instanceKey: string) => void) => () => void
      pasteDictation?: (text: string) => Promise<void>
      hideDictateBar?: () => Promise<void>
      setDictateShortcut?: (payload: {
        chord: { ctrl: boolean; shift: boolean; alt: boolean; meta: boolean; key: string }
        mode: 'toggle' | 'hold'
      }) => Promise<{ ok: boolean; accelerator?: string; mode?: string }>
      onDictateHotkey?: (callback: (phase: 'start' | 'stop') => void) => () => void
      engine?: (
        method: string,
        params?: Record<string, unknown>,
      ) => Promise<
        | { ok: true; result: unknown }
        | { ok: false; error: { code: string; message: string } | string }
      >
      armLoopback?: () => Promise<void>
      setOverlaySession?: (session: OverlaySession | null) => Promise<{ ok: boolean; active?: boolean }>
      setOverlay?: (cue: { label: string; message: string } | null) => Promise<void>
      setOverlayExpanded?: (expanded: boolean) => Promise<{ ok: boolean; expanded?: boolean }>
      overlayAction?: (action: OverlayAction) => Promise<{ ok: boolean }>
      onOverlaySession?: (callback: (session: OverlaySession | null) => void) => () => void
      onOverlayExpanded?: (callback: (expanded: boolean) => void) => () => void
      onOverlay?: (callback: (cue: { label: string; message: string } | null) => void) => () => void
      onOverlayAction?: (callback: (action: OverlayAction) => void) => () => void
      openAtLogin?: () => Promise<boolean>
      setOpenAtLogin?: (on: boolean) => Promise<void>
      openExternal?: (url: string) => Promise<void>
      openCalendarHelp?: (provider: 'google' | 'outlook' | 'apple') => Promise<void>
      licenseStatus?: () => Promise<LicenseStatus>
      activateLicense?: (token: string) => Promise<LicenseActivateResult>
      deactivateLicense?: () => Promise<LicenseActivateResult>
      clearLicense?: () => Promise<LicenseStatus>
      buyLicense?: () => Promise<void>
      openAccount?: () => Promise<void>
      updateStatus?: () => Promise<UpdateStatus>
      installUpdate?: () => Promise<UpdateStatus>
      onUpdate?: (callback: (status: UpdateStatus) => void) => () => void
      announce?: (payload: AppNotice) => Promise<void>
      settleUpdateCheck?: () => Promise<void>
      onAppCommand?: (callback: (command: AppCommand) => void) => () => void
    }
  }
}

export {}
