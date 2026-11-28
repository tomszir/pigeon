// How your devices pass each other the shared log: a `mail:sync` letter in the self mailbox, and
// `sync-summary` and `sync-entries` in the self room.
//
// A letter carries the sender's device log, its summary and the entries its recipients aren't
// known to hold. Whoever opens it merges the device log first, then takes the rest only if the
// sender is on the list that results, so a removal reaches a device before anything from the
// removed device does. Each entry is read on its own: one that doesn't hold, or of a kind this
// Pigeon can't read, never stops the rest.
import { type DeviceLog, deviceState, isDeviceLog } from '../devices/device-log.ts'
import type { Json } from '../encoding/canonical.ts'
import type { PeerId } from '../identity/identity.ts'
import type { SharedEntry } from './entry.ts'
import { readSharedSummary, type SharedSummary } from './log.ts'

/** The kind of mail your devices sync the log in. */
export const SYNC_MAIL_KIND = 'sync'

/** Entries in one letter or one `sync-entries` message. */
export const MAX_SYNC_ENTRIES = 200

/** A `mail:sync` letter's body. */
export interface SyncBody {
  readonly log: DeviceLog
  readonly summary: SharedSummary
  /** Unchecked: each is checked where it's taken. */
  readonly entries: readonly unknown[]
}

export const syncBody = (body: {
  readonly log: DeviceLog
  readonly summary: SharedSummary
  readonly entries: readonly SharedEntry[]
}): Json => ({ log: body.log, summary: body.summary, entries: body.entries }) as unknown as Json

/**
 * Reads a `mail:sync` body for `identity`: undefined unless it holds a device log of that
 * identity. A summary that doesn't hold reads as empty; entries are left for the log to check
 * one by one.
 */
export function readSyncBody(identity: PeerId, body: unknown): SyncBody | undefined {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return undefined
  const fields = body as Record<string, unknown>
  const log = fields['log']
  if (!isDeviceLog(log) || log.identity !== identity) return undefined
  const entries = Array.isArray(fields['entries'])
    ? fields['entries'].slice(0, MAX_SYNC_ENTRIES)
    : []
  return { log, summary: readSharedSummary(fields['summary']), entries }
}

/**
 * Whether what `from` sent counts, read against your device log as merged with whatever it
 * carried: only from another device on the list. A removed device's letters count for nothing on
 * a device that knows of the removal, whatever they say.
 */
export const syncCounts = (log: DeviceLog, from: PeerId, self: PeerId): boolean =>
  from !== self && deviceState(log).active.has(from)
