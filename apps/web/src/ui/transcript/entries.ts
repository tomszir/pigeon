// What a transcript is given: its entries, and the runs and sections they are drawn in.
import type { JSX } from 'solid-js'

/** How a message of yours is getting there, as the small mark in the corner of its panel. */
export type MarkState = 'sealing' | 'mailed' | 'received' | 'failed'

export interface MessageMark {
  readonly state: MarkState
  /** In words, for screen readers and the mark's tooltip: "Mailed", "Received". */
  readonly text: string
  /** More for the tooltip: "Left at Loft for when Jo's back". */
  readonly detail?: string
}

/** A line under a panel: what it waits for, or why it needs a look, with something to do about it. */
export interface MessageNote {
  readonly text: string
  /** Red: it needs you. Otherwise it is only said, quietly. */
  readonly bad: boolean
  readonly action?: { readonly label: string; readonly run: () => void }
}

export interface MessageEntry {
  readonly kind: 'message'
  readonly id: string
  readonly from: string
  readonly own: boolean
  /** Who sent it, by identity; the name in `from` is only what is shown, and two can match. */
  readonly author?: string
  readonly text: string
  /** The sender's chosen font colour. */
  readonly color?: string
  /** When it was written: a run of one sender's messages ends after a quiet stretch. */
  readonly at?: number
  /** The time shown on the last panel of each minute: "6:38 PM". */
  readonly time?: string
  /** The full date and time, for the time's tooltip. */
  readonly when?: string
  /** That it came by letter, through this Lighthouse. Not drawn on the panel itself. */
  readonly letter?: { readonly through: string }
  readonly mark?: MessageMark
  readonly note?: MessageNote
}

/** Messages that came by letter while you were away, folded into one pixel envelope. */
export interface SectionEntry {
  readonly kind: 'section'
  readonly id: string
  /** Who left them, for the envelope's bird and name. */
  readonly from: string
  /** "Rook left 3 messages while you were away". */
  readonly title: string
  /** "By letter, through Loft". */
  readonly how: string
  /** What is left once it is open: "3 messages by letter, through Loft". */
  readonly label: string
  readonly entries: readonly MessageEntry[]
}

export type TranscriptEntry =
  | MessageEntry
  | SectionEntry
  | {
      /** `typing` is the live "is writing a message..." panel, drawn last. */
      readonly kind: 'buzz' | 'system' | 'error' | 'typing' | 'day'
      readonly id: string
      readonly text: string
    }
  | { readonly kind: 'custom'; readonly id: string; readonly content: () => JSX.Element }

export type TranscriptBlock =
  | { readonly kind: 'messages'; readonly from: string; readonly entries: readonly MessageEntry[] }
  | { readonly kind: 'section'; readonly entry: SectionEntry }
  | {
      readonly kind: 'single'
      readonly entry: Exclude<TranscriptEntry, MessageEntry | SectionEntry>
    }

/** A run of one sender's messages ends after this long without one. */
export const RUN_GAP_MS = 10 * 60 * 1000

/** Whether two messages are from the same sender: both yours, or the same identity, never just the same name. */
const sameSender = (a: MessageEntry, b: MessageEntry) =>
  a.own === b.own && (a.author ?? a.from) === (b.author ?? b.from)

/** Groups messages into runs: the same sender, with no long pause or other line between. */
export function groupTranscript(entries: readonly TranscriptEntry[]): TranscriptBlock[] {
  const blocks: TranscriptBlock[] = []
  for (const entry of entries) {
    if (entry.kind === 'section') {
      blocks.push({ kind: 'section', entry })
      continue
    }
    if (entry.kind !== 'message') {
      blocks.push({ kind: 'single', entry })
      continue
    }
    const last = blocks[blocks.length - 1]
    const before = last?.kind === 'messages' ? last.entries[last.entries.length - 1] : undefined
    const quiet =
      before?.at !== undefined && entry.at !== undefined && entry.at - before.at > RUN_GAP_MS
    if (last?.kind === 'messages' && before !== undefined && sameSender(before, entry) && !quiet) {
      blocks[blocks.length - 1] = { ...last, entries: [...last.entries, entry] }
    } else {
      blocks.push({ kind: 'messages', from: entry.from, entries: [entry] })
    }
  }
  return blocks
}

/** What names a block across redraws, so what was drawn for it is kept: its first entry's id. */
export function blockKey(block: TranscriptBlock): string {
  if (block.kind === 'messages') return `run:${block.entries[0]?.id ?? ''}`
  if (block.kind === 'section') return `section:${block.entry.id}`
  return `single:${block.entry.id}:${'text' in block.entry ? block.entry.text : ''}`
}
