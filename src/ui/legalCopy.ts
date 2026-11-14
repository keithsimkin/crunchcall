export type LegalKind = 'privacy' | 'terms'

export type LegalSection = { heading: string; body: string[] }

export type LegalDoc = {
  title: string
  updated: string
  sections: LegalSection[]
}

export const SUPPORT_EMAIL = 'hello@annotated.click'

export const legalCopy: Record<LegalKind, LegalDoc> = {
  privacy: {
    title: 'Privacy policy',
    updated: 'November 14, 2026',
    sections: [
      {
        heading: 'What annotated is',
        body: [
          'annotated is a Windows meeting notepad. Capture, transcription, and the first draft of your notes are designed to stay on this PC unless you choose otherwise.',
        ],
      },
      {
        heading: 'What stays on your PC',
        body: [
          'Meeting audio, transcripts, notes, and search indexes are stored locally on the machine where you run the app.',
          'No meeting bot joins your calls. The app listens on this PC.',
        ],
      },
      {
        heading: 'Optional cloud features',
        body: [
          'If you add a Claude or OpenAI key, that provider may receive the text you send for notes or Ask. Audio does not go with those text requests.',
          'If you pick a cloud speech engine, that provider receives microphone audio while that engine is selected. The app tells you when audio leaves this PC.',
          'API keys you enter are kept in Windows Credential Manager on this PC.',
        ],
      },
      {
        heading: 'Website and purchase',
        body: [
          'On annotated.click, buying Unlock or opening your account uses an email magic link. We store the email, license keys, and related order records needed to fulfill and support that purchase.',
          'Payment is processed by our payment provider. We do not store your full card number on annotated.click.',
        ],
      },
      {
        heading: 'Free trial and this PC',
        body: [
          'The desktop app may start a seven-day free trial. To keep that trial to one PC, the app sends a one-way hash of a Windows machine identifier (not the raw id) to annotated.click when the trial starts.',
          'That hash is stored so a reinstall on the same PC does not start a new trial. Meeting audio and notes are not part of that request.',
        ],
      },
      {
        heading: 'Contact',
        body: [`Questions about this policy: ${SUPPORT_EMAIL}`],
      },
    ],
  },
  terms: {
    title: 'Terms of service',
    updated: 'November 14, 2026',
    sections: [
      {
        heading: 'The product',
        body: [
          'annotated is a Windows desktop app sold by annotated.click. The marketing site and account pages are part of the same service.',
        ],
      },
      {
        heading: 'License',
        body: [
          'Unlock is a paid license for the annotated app on Windows. Unless a plan says otherwise, a standard Unlock key is for one PC.',
          'A seven-day free trial may be offered. After the trial, continued use of paid features requires a valid license.',
          'You may not resell, share, or redistribute license keys except as we expressly allow (for example a two-key purchase for two PCs).',
        ],
      },
      {
        heading: 'Your responsibilities',
        body: [
          'You are responsible for how you use the app, including complying with laws and with the policies of any meeting platform you use.',
          'If you bring your own API keys, you are responsible for those providers’ terms and usage.',
        ],
      },
      {
        heading: 'Local data and availability',
        body: [
          'Notes and audio on your PC are your responsibility to back up. We do not host your local meeting archive as a cloud backup.',
          'The website, license checks, and purchase flow may be unavailable at times for maintenance or outages.',
        ],
      },
      {
        heading: 'Disclaimer',
        body: [
          'The app and site are provided as available. We do not promise uninterrupted service or that coaching, transcription, or summaries will be error-free.',
          'To the extent allowed by law, our liability for any claim related to annotated is limited to the amount you paid us for the license in the twelve months before the claim.',
        ],
      },
      {
        heading: 'Contact',
        body: [`Questions about these terms: ${SUPPORT_EMAIL}`],
      },
    ],
  },
}
