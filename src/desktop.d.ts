export type CalendarFetchResult = { ok: true; text: string } | { ok: false; error: string }

export type CalendarNotifyPayload = {
  instanceKey: string
  title: string
  body: string
}

declare global {
  const __CRUNCHCALL_VERSION__: string
  interface Window {
    crunchcall?: {
      fetchCalendar: (url: string) => Promise<CalendarFetchResult>
      notify: (payload: CalendarNotifyPayload) => Promise<void>
      setWatching: (on: boolean) => Promise<void>
      setChrome: (theme: 'light' | 'dark') => Promise<void>
      onStart: (callback: (instanceKey: string) => void) => () => void
      pasteDictation?: (text: string) => Promise<void>
      hideDictateBar?: () => Promise<void>
      onDictateHotkey?: (callback: (phase: 'start' | 'stop') => void) => () => void
      engine?: (
        method: string,
        params?: Record<string, unknown>,
      ) => Promise<
        | { ok: true; result: unknown }
        | { ok: false; error: { code: string; message: string } | string }
      >
      openExternal?: (url: string) => Promise<void>
    }
  }
}

export {}
