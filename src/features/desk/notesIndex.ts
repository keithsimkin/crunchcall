import type { RichNotes } from '../../ui/fixtures'

let notes: Record<string, RichNotes> = {}

export function setIndexedNotes(next: Record<string, RichNotes>) {
  notes = next
}

export function notesFor(id: string): RichNotes | undefined {
  return notes[id]
}
