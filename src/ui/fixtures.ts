import type { MeetingStatus } from '../features/meetings/types'

/** Static screen content. View state only — nothing here is captured or saved. */

export type MeetingRow = {
  id: string
  title: string
  status: MeetingStatus
  when: string
  day: 'Today' | 'Yesterday' | 'Earlier'
  duration: string
  preview: string
  people: string[]
  topics: string[]
  source: string
  actionCount?: number
}

export type DictationRow = {
  id: string
  at: string
  day: 'Today' | 'Yesterday' | 'Earlier'
  text: string
  createdAt?: number
}

export const dictateDemoStats = {
  words: 72387,
  timeSavedHours: 10,
  streakDays: 8,
  wpm: 109,
}

export const listedDictations: DictationRow[] = [
  {
    id: 'd1',
    at: '12:21 PM',
    day: 'Today',
    text: 'Can we reduce your sizing across the denser panels? The home settings page looks fine from a distance, but up close the controls feel loose and the groups do not sit compact enough for a daily driver.',
  },
  {
    id: 'd2',
    at: '12:18 PM',
    day: 'Today',
    text: 'I like the style of the projects page. Keep that visual language when we tighten the rest of the app.',
  },
  {
    id: 'd3',
    at: '12:18 PM',
    day: 'Today',
    text: "I'm having issues with how the home settings page looks — not compact. Labels and fields need a tighter rhythm so scanning feels faster without losing clarity.",
  },
  {
    id: 'd4',
    at: '12:10 PM',
    day: 'Today',
    text: "Also, for the 'Visit site' link, I want it to be underlined with a small exit icon so it reads as leaving the app.",
  },
  {
    id: 'd5',
    at: '11:04 AM',
    day: 'Today',
    text: 'Follow up with Maya on the three-tier deck. Confirm annual before she sends, and keep the pilot monthly unless annual is locked.',
  },
  {
    id: 'd6',
    at: '10:42 AM',
    day: 'Today',
    text: 'Note for myself: Jon owns the Teams share test Thursday morning. Priya freezes customer copy the same day. I send the final launch date Friday.',
  },
  {
    id: 'd7',
    at: '9:15 AM',
    day: 'Today',
    text: 'Draft reply to Marcus: the invoice is correct, the portal label is wrong, Dana is fixing it Thursday, and I will send the revised summary Friday.',
  },
  {
    id: 'd8',
    at: '4:55 PM',
    day: 'Yesterday',
    text: 'Priya takes the launch sequence. I keep the Store relationship. Put the date in writing by Friday so she can plan.',
  },
  {
    id: 'd9',
    at: '2:20 PM',
    day: 'Yesterday',
    text: 'Hiring loop feedback: keep the take-home under two hours, drop the whiteboard warm-up, and have Nadia own the panel debrief.',
  },
  {
    id: 'd10',
    at: '11:48 AM',
    day: 'Yesterday',
    text: 'People read Company as enterprise on the pricing page. Nobody found annual. Move annual under a quiet toggle and rename Company to Business.',
  },
  {
    id: 'd11',
    at: '5:10 PM',
    day: 'Earlier',
    text: 'Investor update talking points: ARR up, burn flat, hiring paused until launch, Store screenshots Thursday, decision on date Friday.',
  },
  {
    id: 'd12',
    at: '3:32 PM',
    day: 'Earlier',
    text: 'Lumen checklist: overlay off for first customer call, Sam sends onboarding pack Tuesday, walk their admin through settings before the 24th.',
  },
]

export type LiveLine = {
  id: string
  at: string
  speaker: string
  you: boolean
  text: string
}

export type LiveCue = {
  id: string
  label: string
  message: string
}

export type NoteAction = {
  id: string
  text: string
  owner: string | null
  due: string | null
}

export type NoteUtterance = {
  id: string
  at: string
  speaker: string
  you: boolean
  text: string
}

export type NoteAsk = {
  id: string
  role: 'user' | 'assistant'
  text: string
  cites?: { utteranceId: string; at: string }[]
}

export type RichNotes = {
  summary: string
  takeaways: string[]
  actions: NoteAction[]
  utterances: NoteUtterance[]
  ask: NoteAsk[]
  sampleReply: NoteAsk
  markdown: string
}

export const listedMeetings: MeetingRow[] = [
  {
    id: 'live-product',
    title: 'Product sync',
    status: 'live',
    when: 'Now',
    day: 'Today',
    duration: '18:42',
    preview: 'Listening on Speakers (loopback).',
    people: ['Priya', 'Jon'],
    topics: ['Demo', 'Overlay', 'Teams'],
    source: 'Loopback',
    actionCount: 2,
  },
  {
    id: 'pricing',
    title: 'Pricing review with Northwind',
    status: 'ready',
    when: 'Today · 9:30',
    day: 'Today',
    duration: '42 min',
    preview: 'Three tiers. Maya owns the deck by Friday.',
    people: ['Sam', 'Maya'],
    topics: ['Pricing', 'Tiers', 'Annual'],
    source: 'Zoom',
    actionCount: 3,
  },
  {
    id: 'hiring',
    title: 'Design hiring loop',
    status: 'processing',
    when: 'Yesterday',
    day: 'Yesterday',
    duration: '28 min',
    preview: 'Writing notes on this PC…',
    people: ['Nadia', 'Eli'],
    topics: ['Hiring', 'Design', 'Take-home'],
    source: 'Google Meet',
    actionCount: 2,
  },
  {
    id: 'one-on-one',
    title: '1:1 — Priya',
    status: 'ready',
    when: 'Yesterday · 16:30',
    day: 'Yesterday',
    duration: '22 min',
    preview: 'She wants a bigger say in the launch sequence.',
    people: ['Priya'],
    topics: ['Roadmap', 'Coaching', 'Launch'],
    source: 'In person',
    actionCount: 2,
  },
  {
    id: 'support-escalation',
    title: 'Support escalation — Atlas',
    status: 'ready',
    when: 'Yesterday · 11:10',
    day: 'Yesterday',
    duration: '24 min',
    preview: 'Invoice mismatch traced to the annual plan. Dana owns the fix.',
    people: ['Dana', 'Marcus'],
    topics: ['Support', 'Billing', 'Renewal'],
    source: 'Teams',
    actionCount: 2,
  },
  {
    id: 'onboarding',
    title: 'Customer onboarding — Lumen',
    status: 'ready',
    when: 'Mon · 10:00',
    day: 'Earlier',
    duration: '36 min',
    preview: 'Six-week pilot. Sam sends the checklist.',
    people: ['Sam', 'Rae'],
    topics: ['Pilot', 'Onboarding', 'Overlay'],
    source: 'Zoom',
    actionCount: 2,
  },
  {
    id: 'design-review',
    title: 'Design review — onboarding flow',
    status: 'ready',
    when: 'Wed · 14:00',
    day: 'Earlier',
    duration: '31 min',
    preview: 'Overlay off at day one. One screen for the checklist.',
    people: ['Rae', 'Sam', 'Priya'],
    topics: ['Design', 'Onboarding', 'Overlay'],
    source: 'Zoom',
    actionCount: 3,
  },
  {
    id: 'investor-update',
    title: 'Investor update — Q4',
    status: 'ready',
    when: 'Tue · 11:00',
    day: 'Earlier',
    duration: '52 min',
    preview: 'ARR is up. Hiring stays flat until Q1.',
    people: ['Nina', 'Theo'],
    topics: ['Fundraising', 'Metrics', 'Q4'],
    source: 'Google Meet',
    actionCount: 2,
  },
  {
    id: 'launch-planning',
    title: 'Launch planning',
    status: 'ready',
    when: 'Last Wed',
    day: 'Earlier',
    duration: '45 min',
    preview: 'Store screenshots move to Thursday. Jon owns the Teams test.',
    people: ['Priya', 'Jon', 'Maya'],
    topics: ['Launch', 'Store', 'Screenshots'],
    source: 'Google Meet',
    actionCount: 4,
  },
  {
    id: 'research-debrief',
    title: 'Research debrief — pricing page',
    status: 'ready',
    when: 'Mon · 15:30',
    day: 'Earlier',
    duration: '38 min',
    preview: 'People read “Company” as enterprise. No one found annual.',
    people: ['Maya', 'Theo'],
    topics: ['Research', 'Pricing', 'Messaging'],
    source: 'Zoom',
    actionCount: 3,
  },
  {
    id: 'draft-retro',
    title: 'Sprint retro',
    status: 'draft',
    when: 'Not started',
    day: 'Earlier',
    duration: '—',
    preview: 'Draft. Nothing captured yet.',
    people: ['Priya', 'Jon'],
    topics: ['Sprint', 'Process'],
    source: 'This PC',
    actionCount: 0,
  },
]

export type ProjectAccent = 'green' | 'blue' | 'violet' | 'amber' | 'rose' | 'slate'

export type ProjectFolder = {
  id: string
  name: string
  blurb: string
  accent: ProjectAccent
  meetingIds: string[]
}

export const starterProjects: ProjectFolder[] = [
  {
    id: 'northwind',
    name: 'Northwind',
    blurb: 'Pricing, security review, and the annual option.',
    accent: 'green',
    meetingIds: ['pricing'],
  },
  {
    id: 'lumen',
    name: 'Lumen',
    blurb: 'A six-week pilot, overlay settings, and the day-one handoff.',
    accent: 'blue',
    meetingIds: ['onboarding', 'design-review'],
  },
  {
    id: 'product',
    name: 'Product',
    blurb: 'Weekly syncs, launch sequencing, and the Store screenshots.',
    accent: 'violet',
    meetingIds: ['live-product', 'launch-planning', 'one-on-one'],
  },
  {
    id: 'hiring',
    name: 'Hiring',
    blurb: 'Loop design, the take-home, and the panel debrief.',
    accent: 'amber',
    meetingIds: ['hiring'],
  },
  {
    id: 'studio',
    name: 'Studio',
    blurb: 'Retros, investor updates, and the weird ideas worth keeping.',
    accent: 'rose',
    meetingIds: ['draft-retro', 'investor-update', 'research-debrief'],
  },
  {
    id: 'atlas',
    name: 'Atlas',
    blurb: 'Escalation, billing, and the path back to renewal.',
    accent: 'slate',
    meetingIds: ['support-escalation'],
  },
]

export function freshMeeting(title = 'Untitled meeting'): MeetingRow {
  return {
    id: 'fresh-session',
    title,
    status: 'processing',
    when: 'Just now',
    day: 'Today',
    duration: '0 min',
    preview: 'Writing notes on this PC…',
    people: [],
    topics: [],
    source: 'This PC',
    actionCount: 0,
  }
}

export function statusLabel(status: MeetingStatus): string {
  switch (status) {
    case 'live':
      return 'Live'
    case 'ready':
      return 'Ready'
    case 'processing':
      return 'Writing'
    case 'draft':
      return 'Draft'
  }
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((part) => part[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

export const productLive = {
  title: 'Product sync',
  elapsed: '18:42',
  device: 'Speakers (loopback)',
  lines: [
    {
      id: 'l1',
      at: '00:41',
      speaker: 'You',
      you: true,
      text: 'Let’s lock the overlay before we shoot the Store screenshots.',
    },
    {
      id: 'l2',
      at: '02:06',
      speaker: 'Priya',
      you: false,
      text: 'If a cue shows up in the share, the demo fails.',
    },
    {
      id: 'l3',
      at: '04:18',
      speaker: 'Jon',
      you: false,
      text: 'Can we ship without mic mix?',
    },
    {
      id: 'l4',
      at: '04:21',
      speaker: 'Jon',
      you: false,
      text: 'And who is testing Teams?',
    },
    {
      id: 'l5',
      at: '07:02',
      speaker: 'You',
      you: true,
      text: 'I’ll take Teams. Priya has Zoom. We still need a date.',
    },
    {
      id: 'l6',
      at: '11:40',
      speaker: 'Priya',
      you: false,
      text: 'What model size did we pick? And is tiny enough for a first run?',
    },
    {
      id: 'l7',
      at: '14:05',
      speaker: 'You',
      you: true,
      text: 'Tiny on first run. Small if the machine can hold it.',
    },
    {
      id: 'l8',
      at: '16:30',
      speaker: 'Jon',
      you: false,
      text: 'So the next step is the share test, but we have not named a day.',
    },
  ] satisfies LiveLine[],
  cues: [
    {
      id: 'c1',
      label: 'Missing date',
      message: 'Jon named the share test without a day. Ask for one before you leave.',
    },
    {
      id: 'c2',
      label: 'Stacked questions',
      message: 'Priya asked two in a row. Leave a beat.',
    },
    {
      id: 'c3',
      label: 'Talk ratio',
      message: 'You have had the floor for most of the last minute.',
    },
  ] satisfies LiveCue[],
}

export const blankLive = {
  title: 'Untitled meeting',
  elapsed: '00:00',
  device: 'Speakers (loopback)',
  lines: [] as LiveLine[],
  cues: [] as LiveCue[],
}

const pricingMarkdown = `# Pricing review with Northwind

Northwind wants three public tiers and a private annual option. The pilot stays monthly unless annual can land without slipping the 24th.

## Takeaways

- Three tiers: Starter, Team, and Company. Annual is optional, not the pilot default.
- Maya sends the deck Friday. You confirm annual before she sends.
- Sam is the buyer. Legal review is already booked for next Wednesday.

## Next steps

- [ ] Send the three-tier deck — Maya — Fri
- [ ] Confirm whether annual is in the pilot — You — Thu
- [ ] Book the security questionnaire follow-up — Unassigned — No date
`

const onboardingMarkdown = `# Customer onboarding — Lumen

Lumen starts a six-week pilot on the 24th. Sam owns the checklist. Their admin wants the overlay off for the first customer call.

## Takeaways

- Pilot window is six weeks, starting the 24th.
- Overlay stays off for their first customer call.
- Checklist owner is Sam.

## Next steps

- [ ] Send the onboarding checklist — Sam — Tue
- [ ] Walk their admin through overlay settings — You — before the 24th
`

const designReviewMarkdown = `# Design review — onboarding flow

The onboarding flow is now one screen. Rae wants the customer call to start with the overlay off, then switch it on after the first ten minutes.

## Takeaways

- Checklist, admin walkthrough, and overlay toggle live on one screen.
- Rae signs off on the copy, not the layout.
- The overlay stays off until the first customer call ends.

## Next steps

- [ ] Cut the second admin screen — Priya — Wed
- [ ] Re-record the walkthrough with overlay off — Rae — Thu
- [ ] Add the overlay toggle to the pilot checklist — Sam — Tue
`

const supportMarkdown = `# Support escalation — Atlas

Atlas was billed annual after the pilot converted. The mismatch is on our side: the plan id carried over from the trial.

## Takeaways

- Atlas is on annual, not monthly. The invoice is correct; the portal copy is not.
- Dana is the owner for the billing fix.
- Renewal is still healthy if we close the loop this week.

## Next steps

- [ ] Correct the Atlas plan label in the portal — Dana — Thu
- [ ] Send Marcus the revised invoice and a one-page summary — You — Fri
`

const oneOnOneMarkdown = `# 1:1 — Priya

Priya wants to own the launch sequence. She is ready for the next step, but the Store date is still moving.

## Takeaways

- Priya takes the launch sequence; you keep the Store relationship.
- She wants a written decision on the date by Friday.
- Hiring stays flat until the launch is out.

## Next steps

- [ ] Write down the launch decision and owner — You — Fri
- [ ] Share the Store checklist with Priya — You — Thu
`

const launchMarkdown = `# Launch planning

The Store screenshots move to Thursday. Jon owns the Teams share test. Priya owns the launch sequence and the customer-facing copy.

## Takeaways

- Screenshots are Thursday, not Wednesday.
- Jon tests Teams before the copy freeze.
- The launch sequence is Priya’s, with a Friday decision.

## Next steps

- [ ] Run the Teams share test — Jon — Thu
- [ ] Freeze the customer copy — Priya — Thu
- [ ] Shoot the Store screenshots — Maya — Thu
- [ ] Send the final launch date — You — Fri
`

export const richNotes: Record<string, RichNotes> = {
  pricing: {
    summary:
      'Northwind wants three public tiers and a private annual option. The pilot stays monthly unless annual can land without slipping the 24th. You still owe a yes or no before Maya sends the deck on Friday.',
    takeaways: [
      'Three tiers: Starter, Team, and Company. Annual is optional, not the pilot default.',
      'Maya sends the deck Friday. You confirm annual before she sends.',
      'Sam is the buyer. Legal review is already booked for next Wednesday.',
    ],
    actions: [
      { id: 'a1', text: 'Send the three-tier deck', owner: 'Maya', due: 'Fri' },
      { id: 'a2', text: 'Confirm whether annual is in the pilot', owner: 'You', due: 'Thu' },
      { id: 'a3', text: 'Book the security questionnaire follow-up', owner: null, due: null },
    ],
    utterances: [
      {
        id: 'p1',
        at: '03:10',
        speaker: 'Sam',
        you: false,
        text: 'We can live with three public tiers. Annual has to be a private option.',
      },
      {
        id: 'p2',
        at: '09:12',
        speaker: 'You',
        you: true,
        text: 'Maya, can you send the deck Friday if I confirm annual by Thursday?',
      },
      {
        id: 'p3',
        at: '09:40',
        speaker: 'Maya',
        you: false,
        text: 'Yes. I will not send it until you confirm.',
      },
      {
        id: 'p4',
        at: '14:40',
        speaker: 'Sam',
        you: false,
        text: 'Pilot stays the 24th, monthly, unless annual is in before the deck goes.',
      },
      {
        id: 'p5',
        at: '21:05',
        speaker: 'You',
        you: true,
        text: 'Someone still needs to book the security questionnaire follow-up.',
      },
    ],
    ask: [
      {
        id: 'q1',
        role: 'user',
        text: 'Who owns the deck?',
      },
      {
        id: 'q2',
        role: 'assistant',
        text: 'Maya. She sends it Friday, and she is waiting on your annual-billing confirm before she does.',
        cites: [{ utteranceId: 'p2', at: '09:12' }],
      },
    ],
    sampleReply: {
      id: 'sample-pricing',
      role: 'assistant',
      text: 'From these notes: Maya sends the deck Friday. You confirm annual billing first. The security follow-up still has no owner and no date.',
      cites: [{ utteranceId: 'p4', at: '14:40' }],
    },
    markdown: pricingMarkdown,
  },
  onboarding: {
    summary:
      'Lumen starts a six-week pilot on the 24th. Sam sends the checklist. Their admin wants the overlay off for the first customer call, then on after that.',
    takeaways: [
      'Pilot window is six weeks, starting the 24th.',
      'Overlay stays off for their first customer call.',
      'Checklist owner is Sam.',
    ],
    actions: [
      { id: 'b1', text: 'Send the onboarding checklist', owner: 'Sam', due: 'Tue' },
      {
        id: 'b2',
        text: 'Walk their admin through overlay settings',
        owner: 'You',
        due: 'Before the 24th',
      },
    ],
    utterances: [
      {
        id: 'o1',
        at: '04:02',
        speaker: 'You',
        you: true,
        text: 'Pilot starts the 24th and runs six weeks.',
      },
      {
        id: 'o2',
        at: '08:16',
        speaker: 'Sam',
        you: false,
        text: 'I will send the checklist Tuesday.',
      },
      {
        id: 'o3',
        at: '12:44',
        speaker: 'Rae',
        you: false,
        text: 'Please keep the overlay off for our first customer call.',
      },
      {
        id: 'o4',
        at: '18:20',
        speaker: 'You',
        you: true,
        text: 'I will walk your admin through the overlay before the 24th.',
      },
    ],
    ask: [
      {
        id: 'oq1',
        role: 'user',
        text: 'When does the pilot start?',
      },
      {
        id: 'oq2',
        role: 'assistant',
        text: 'The 24th. It runs six weeks. Sam sends the checklist Tuesday, and you walk their admin through the overlay before day one.',
        cites: [{ utteranceId: 'o1', at: '04:02' }],
      },
    ],
    sampleReply: {
      id: 'sample-onboarding',
      role: 'assistant',
      text: 'The pilot starts the 24th. Sam owns the checklist. The overlay stays off for their first customer call.',
      cites: [{ utteranceId: 'o3', at: '12:44' }],
    },
    markdown: onboardingMarkdown,
  },
  'design-review': {
    summary:
      'The onboarding flow is now one screen. Rae wants the first customer call to start with the overlay off, then switch it on after ten minutes. The copy is still open, the layout is not.',
    takeaways: [
      'Checklist, admin walkthrough, and overlay toggle live on one screen.',
      'Rae signs off on the copy, not the layout.',
      'Overlay stays off until the first customer call ends.',
    ],
    actions: [
      { id: 'd1', text: 'Cut the second admin screen', owner: 'Priya', due: 'Wed' },
      { id: 'd2', text: 'Re-record the walkthrough with overlay off', owner: 'Rae', due: 'Thu' },
      { id: 'd3', text: 'Add the overlay toggle to the pilot checklist', owner: 'Sam', due: 'Tue' },
    ],
    utterances: [
      {
        id: 'dr1',
        at: '02:20',
        speaker: 'Rae',
        you: false,
        text: 'One screen is better. I do not want the admin to hunt for the overlay.',
      },
      {
        id: 'dr2',
        at: '06:48',
        speaker: 'Priya',
        you: false,
        text: 'Then the second admin screen goes. I can cut it Wednesday.',
      },
      {
        id: 'dr3',
        at: '11:05',
        speaker: 'Sam',
        you: false,
        text: 'I will put the overlay toggle on the pilot checklist.',
      },
      {
        id: 'dr4',
        at: '16:32',
        speaker: 'You',
        you: true,
        text: 'Rae, re-record the walkthrough with the overlay off so the first call matches.',
      },
    ],
    ask: [
      {
        id: 'drq1',
        role: 'user',
        text: 'What changed on the onboarding flow?',
      },
      {
        id: 'drq2',
        role: 'assistant',
        text: 'It is one screen now. The second admin screen is cut, and the overlay toggle joins the pilot checklist.',
        cites: [{ utteranceId: 'dr1', at: '02:20' }],
      },
    ],
    sampleReply: {
      id: 'sample-design',
      role: 'assistant',
      text: 'One screen. Priya cuts the second admin screen Wednesday, Sam adds the overlay toggle, and Rae re-records the walkthrough with the overlay off.',
      cites: [{ utteranceId: 'dr2', at: '06:48' }],
    },
    markdown: designReviewMarkdown,
  },
  'support-escalation': {
    summary:
      'Atlas was billed annual after the pilot converted. The plan id carried over from the trial, so the invoice is right and the portal copy is wrong. Dana owns the fix.',
    takeaways: [
      'Atlas is on annual, not monthly. The invoice is correct; the portal copy is not.',
      'Dana is the owner for the billing fix.',
      'Renewal is still healthy if we close the loop this week.',
    ],
    actions: [
      { id: 's1', text: 'Correct the Atlas plan label in the portal', owner: 'Dana', due: 'Thu' },
      { id: 's2', text: 'Send Marcus the revised invoice and a one-page summary', owner: 'You', due: 'Fri' },
    ],
    utterances: [
      {
        id: 'sp1',
        at: '01:55',
        speaker: 'Marcus',
        you: false,
        text: 'The invoice says annual. Our portal says monthly. We need one answer.',
      },
      {
        id: 'sp2',
        at: '05:12',
        speaker: 'Dana',
        you: false,
        text: 'The plan id carried over from the trial. The invoice is correct.',
      },
      {
        id: 'sp3',
        at: '09:40',
        speaker: 'You',
        you: true,
        text: 'Dana fixes the portal label. I send the revised invoice Friday.',
      },
      {
        id: 'sp4',
        at: '14:05',
        speaker: 'Marcus',
        you: false,
        text: 'If that lands this week, renewal stays on track.',
      },
    ],
    ask: [
      {
        id: 'spq1',
        role: 'user',
        text: 'Why was Atlas billed annual?',
      },
      {
        id: 'spq2',
        role: 'assistant',
        text: 'The plan id carried over from the trial. The invoice is correct; the portal label is the part that is wrong.',
        cites: [{ utteranceId: 'sp2', at: '05:12' }],
      },
    ],
    sampleReply: {
      id: 'sample-support',
      role: 'assistant',
      text: 'Atlas is on annual. Dana fixes the portal label Thursday, and you send Marcus the revised invoice Friday. Renewal stays healthy if that lands this week.',
      cites: [{ utteranceId: 'sp3', at: '09:40' }],
    },
    markdown: supportMarkdown,
  },
  'one-on-one': {
    summary:
      'Priya wants to own the launch sequence. She is ready for the next step, but the Store date is still moving. You owe her a written decision on the date by Friday.',
    takeaways: [
      'Priya takes the launch sequence; you keep the Store relationship.',
      'She wants a written decision on the date by Friday.',
      'Hiring stays flat until the launch is out.',
    ],
    actions: [
      { id: 'o1', text: 'Write down the launch decision and owner', owner: 'You', due: 'Fri' },
      { id: 'o2', text: 'Share the Store checklist with Priya', owner: 'You', due: 'Thu' },
    ],
    utterances: [
      {
        id: 'on1',
        at: '02:10',
        speaker: 'Priya',
        you: false,
        text: 'I want the launch sequence. I am already chasing the copy.',
      },
      {
        id: 'on2',
        at: '07:24',
        speaker: 'You',
        you: true,
        text: 'Take it. I keep the Store relationship and the date.',
      },
      {
        id: 'on3',
        at: '12:08',
        speaker: 'Priya',
        you: false,
        text: 'Then put the date in writing by Friday so I can plan.',
      },
      {
        id: 'on4',
        at: '17:42',
        speaker: 'You',
        you: true,
        text: 'I will. Hiring stays flat until this is out.',
      },
    ],
    ask: [
      {
        id: 'onq1',
        role: 'user',
        text: 'What did Priya ask for?',
      },
      {
        id: 'onq2',
        role: 'assistant',
        text: 'The launch sequence, and a written date by Friday so she can plan around it.',
        cites: [{ utteranceId: 'on3', at: '12:08' }],
      },
    ],
    sampleReply: {
      id: 'sample-one-on-one',
      role: 'assistant',
      text: 'Priya owns the launch sequence. You keep the Store relationship and owe her the date in writing by Friday. Hiring stays flat until launch.',
      cites: [{ utteranceId: 'on2', at: '07:24' }],
    },
    markdown: oneOnOneMarkdown,
  },
  'launch-planning': {
    summary:
      'The Store screenshots move to Thursday. Jon owns the Teams share test. Priya owns the launch sequence and the customer copy. The date still needs a final yes.',
    takeaways: [
      'Screenshots are Thursday, not Wednesday.',
      'Jon tests Teams before the copy freeze.',
      'The launch sequence is Priya’s, with a Friday decision.',
    ],
    actions: [
      { id: 'p1', text: 'Run the Teams share test', owner: 'Jon', due: 'Thu' },
      { id: 'p2', text: 'Freeze the customer copy', owner: 'Priya', due: 'Thu' },
      { id: 'p3', text: 'Shoot the Store screenshots', owner: 'Maya', due: 'Thu' },
      { id: 'p4', text: 'Send the final launch date', owner: 'You', due: 'Fri' },
    ],
    utterances: [
      {
        id: 'lp1',
        at: '03:12',
        speaker: 'Maya',
        you: false,
        text: 'Screenshots need another day. Thursday is the first slot with the final overlay.',
      },
      {
        id: 'lp2',
        at: '08:30',
        speaker: 'Jon',
        you: false,
        text: 'I will run the Teams share test Thursday morning.',
      },
      {
        id: 'lp3',
        at: '14:18',
        speaker: 'Priya',
        you: false,
        text: 'Copy freezes Thursday. I need the date in writing Friday.',
      },
      {
        id: 'lp4',
        at: '19:44',
        speaker: 'You',
        you: true,
        text: 'Thursday for screenshots and copy. Friday for the date.',
      },
    ],
    ask: [
      {
        id: 'lpq1',
        role: 'user',
        text: 'When are the Store screenshots?',
      },
      {
        id: 'lpq2',
        role: 'assistant',
        text: 'Thursday. Maya shoots them after the overlay is locked, and Jon runs the Teams test the same morning.',
        cites: [{ utteranceId: 'lp1', at: '03:12' }],
      },
    ],
    sampleReply: {
      id: 'sample-launch',
      role: 'assistant',
      text: 'Screenshots are Thursday. Maya shoots, Jon tests Teams, Priya freezes copy, and you send the final date Friday.',
      cites: [{ utteranceId: 'lp4', at: '19:44' }],
    },
    markdown: launchMarkdown,
  },
  'live-product': {
    summary: 'Locking the overlay before Store screenshots. Jon asked about mic mix and Teams. A share-test day is still missing.',
    takeaways: [
      'Overlay must stay off screen share for the Store shoot.',
      'You take Teams. Priya takes Zoom.',
      'Tiny first, Small if the machine can hold it.',
    ],
    actions: [
      { id: 'lpv1', text: 'Name a day for the share test', owner: 'You', due: null },
      { id: 'lpv2', text: 'Run the Teams share test', owner: 'You', due: 'Thu' },
    ],
    utterances: productLive.lines.map((line) => ({
      id: line.id,
      at: line.at,
      speaker: line.speaker,
      you: line.you,
      text: line.text,
    })),
    ask: [],
    sampleReply: {
      id: 'sample-live',
      role: 'assistant',
      text: 'Jon named a share test without a day. Ask for one before you leave.',
    },
    markdown: '# Product sync\n\nLive session. Overlay, Teams, and the share-test date are still open.\n',
  },
  hiring: {
    summary: 'Design hiring loop is being written up. Keep the take-home short and drop the whiteboard warm-up.',
    takeaways: [
      'Take-home stays under two hours.',
      'Whiteboard warm-up is cut.',
      'Nadia owns the panel debrief.',
    ],
    actions: [
      { id: 'h1', text: 'Rewrite the take-home brief', owner: 'Eli', due: 'Wed' },
      { id: 'h2', text: 'Schedule the panel debrief', owner: 'Nadia', due: 'Fri' },
    ],
    utterances: [
      {
        id: 'hi1',
        at: '04:10',
        speaker: 'Nadia',
        you: false,
        text: 'The take-home is too long. Cap it at two hours.',
      },
      {
        id: 'hi2',
        at: '09:22',
        speaker: 'Eli',
        you: false,
        text: 'I can rewrite the brief Wednesday and drop the whiteboard warm-up.',
      },
      {
        id: 'hi3',
        at: '15:40',
        speaker: 'You',
        you: true,
        text: 'Nadia owns the panel debrief once candidates finish.',
      },
    ],
    ask: [],
    sampleReply: {
      id: 'sample-hiring',
      role: 'assistant',
      text: 'Eli rewrites the take-home Wednesday. Nadia owns the panel debrief Friday.',
    },
    markdown:
      '# Design hiring loop\n\nTake-home under two hours. No whiteboard warm-up. Nadia owns the panel debrief.\n',
  },
  'investor-update': {
    summary: 'ARR is up and hiring stays flat until launch. Investors want the Store date in writing.',
    takeaways: [
      'ARR up, burn flat.',
      'Hiring paused until launch ships.',
      'Store screenshots Thursday; date decision Friday.',
    ],
    actions: [
      { id: 'iv1', text: 'Send the metrics one-pager', owner: 'Nina', due: 'Wed' },
      { id: 'iv2', text: 'Confirm the Store date in writing', owner: 'You', due: 'Fri' },
    ],
    utterances: [
      {
        id: 'iv1u',
        at: '06:05',
        speaker: 'Theo',
        you: false,
        text: 'ARR is the bright spot. Keep hiring flat until the launch lands.',
      },
      {
        id: 'iv2u',
        at: '18:22',
        speaker: 'Nina',
        you: false,
        text: 'I will send the metrics one-pager Wednesday.',
      },
      {
        id: 'iv3u',
        at: '31:10',
        speaker: 'You',
        you: true,
        text: 'Screenshots Thursday. Final date Friday.',
      },
    ],
    ask: [],
    sampleReply: {
      id: 'sample-investor',
      role: 'assistant',
      text: 'ARR up, hiring flat until launch. Nina sends metrics Wednesday; you confirm the Store date Friday.',
    },
    markdown: '# Investor update — Q4\n\nARR up. Hiring flat. Store date Friday.\n',
  },
  'research-debrief': {
    summary: 'People read Company as enterprise. Nobody found annual. Rename and hide annual behind a quiet toggle.',
    takeaways: [
      'Company reads as enterprise.',
      'Annual is invisible on the page.',
      'Business is the clearer label.',
    ],
    actions: [
      { id: 'rd1', text: 'Rename Company to Business', owner: 'Maya', due: 'Tue' },
      { id: 'rd2', text: 'Move annual behind a quiet toggle', owner: 'Theo', due: 'Wed' },
      { id: 'rd3', text: 'Re-run five pricing-page sessions', owner: 'Maya', due: 'Fri' },
    ],
    utterances: [
      {
        id: 'rd1u',
        at: '05:14',
        speaker: 'Maya',
        you: false,
        text: 'Three people said Company means enterprise. Nobody clicked annual.',
      },
      {
        id: 'rd2u',
        at: '12:40',
        speaker: 'Theo',
        you: false,
        text: 'Put annual under a quiet toggle. Rename Company to Business.',
      },
      {
        id: 'rd3u',
        at: '21:05',
        speaker: 'You',
        you: true,
        text: 'Re-run five sessions after the rename before we freeze copy.',
      },
    ],
    ask: [],
    sampleReply: {
      id: 'sample-research',
      role: 'assistant',
      text: 'Rename Company to Business, hide annual, and re-run five sessions before copy freeze.',
    },
    markdown: '# Research debrief — pricing page\n\nCompany reads as enterprise. Annual is hard to find.\n',
  },
  'draft-retro': {
    summary: '',
    takeaways: [],
    actions: [],
    utterances: [],
    ask: [],
    sampleReply: { id: 'sample-retro', role: 'assistant', text: 'Nothing captured yet.' },
    markdown: '',
  },
}
