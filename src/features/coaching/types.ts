export type CoachingCueKind =
  | 'talk-ratio'
  | 'stacked-questions'
  | 'no-date'
  | 'no-next-steps'
  | 'interrupt'

export type CoachingCue = {
  id: string
  meetingId: string
  kind: CoachingCueKind
  message: string
  at: number
}
