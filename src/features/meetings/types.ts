export type MeetingStatus = 'draft' | 'live' | 'processing' | 'ready'

export type Meeting = {
  id: string
  title: string
  startedAt: number | null
  endedAt: number | null
  status: MeetingStatus
}

export type ActionItem = {
  id: string
  meetingId: string
  text: string
  owner: string | null
  due: string | null
}
