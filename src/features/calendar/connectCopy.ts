import type { CalendarSignIn } from './store'

export function accountConnectCopy(signIn: CalendarSignIn | null): {
  title: string
  help: string
  showGoogle: boolean
  showMicrosoft: boolean
} {
  const showGoogle = Boolean(signIn?.configured.google)
  const showMicrosoft = Boolean(signIn?.configured.microsoft)
  if (showGoogle && showMicrosoft) {
    return {
      title: 'Google or Outlook',
      help: 'Sign in once. annotated reads the calendars you pick and keeps that permission on this PC.',
      showGoogle: true,
      showMicrosoft: true,
    }
  }
  if (showGoogle) {
    return {
      title: 'Google',
      help: 'Sign in once with Google. annotated reads the calendars you pick and keeps that permission on this PC.',
      showGoogle: true,
      showMicrosoft: false,
    }
  }
  if (showMicrosoft) {
    return {
      title: 'Outlook',
      help: 'Sign in once with Outlook. annotated reads the calendars you pick and keeps that permission on this PC.',
      showGoogle: false,
      showMicrosoft: true,
    }
  }
  if (!signIn) {
    return {
      title: 'Calendar sign-in',
      help: 'Sign in once. annotated reads the calendars you pick and keeps that permission on this PC.',
      showGoogle: false,
      showMicrosoft: false,
    }
  }
  return {
    title: 'Calendar sign-in',
    help: 'Sign-in is not set up in this copy yet. A private calendar link still works.',
    showGoogle: false,
    showMicrosoft: false,
  }
}

export function calendarIntro(desktop: boolean, signIn: CalendarSignIn | null): string {
  if (!desktop) {
    return 'Paste a private calendar link, or import a file. A webcal link is fine. Google sign-in is in the desktop app.'
  }
  const google = Boolean(signIn?.configured.google)
  const microsoft = Boolean(signIn?.configured.microsoft)
  if (google && microsoft) {
    return 'Sign in with Google or Outlook, or paste a private link from Apple. annotated reads the meetings on this PC and asks before it turns on.'
  }
  if (microsoft) {
    return 'Sign in with Outlook, or paste a private link. annotated reads the meetings on this PC and asks before it turns on.'
  }
  if (google) {
    return 'Sign in with Google, or paste a private link from Apple, Outlook, or another calendar. annotated reads the meetings on this PC and asks before it turns on.'
  }
  return 'Paste a private calendar link, or import an .ics file. annotated reads the meetings on this PC and asks before it turns on.'
}

export function calendarLinkHelp(desktop: boolean): string {
  if (desktop) return 'Private address from Apple, Outlook, or another calendar. A webcal link is fine.'
  return 'Private address from Google, Outlook, or Apple. If the browser blocks it, import an .ics file. Google sign-in is in the desktop app.'
}

export function calendarEmptyHint(desktop: boolean, signIn: CalendarSignIn | null): string {
  if (!desktop) return 'Add a calendar link, or import an .ics file.'
  const google = Boolean(signIn?.configured.google)
  const microsoft = Boolean(signIn?.configured.microsoft)
  if (google && microsoft) return 'Connect Google or Outlook, or add a calendar link.'
  if (google) return 'Connect Google, or add a calendar link.'
  if (microsoft) return 'Connect Outlook, or add a calendar link.'
  return 'Add a calendar link, or import an .ics file.'
}

export function meetingsCalendarEmpty(desktop: boolean, signIn: CalendarSignIn | null): string {
  if (!desktop) return 'Add a private link under Calendar, or import an .ics file.'
  const google = Boolean(signIn?.configured.google)
  const microsoft = Boolean(signIn?.configured.microsoft)
  if (google && microsoft) return 'Connect Google or Outlook under Calendar, or add a private link.'
  if (google) return 'Connect Google under Calendar, or add a private link.'
  if (microsoft) return 'Connect Outlook under Calendar, or add a private link.'
  return 'Add a private link under Calendar, or import an .ics file.'
}
