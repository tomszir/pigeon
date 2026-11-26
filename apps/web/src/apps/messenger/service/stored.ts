// Shape checks for what the Messenger reads back from storage. A value that doesn't match is
// treated as missing rather than trusted.
import {
  type ChatLog,
  isLiveCode,
  isPairSecret,
  isPeerId,
  type LogEntry,
  type PeerId,
} from '@pigeon/core'
import { isReplacing } from './rekeys.ts'
import type {
  BlockedRecord,
  FarewellRecord,
  FriendRecord,
  HostedInvite,
  MessengerSettings,
  Profile,
} from './service.ts'

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export function isProfile(value: unknown): value is Profile {
  return (
    isObject(value) &&
    typeof value['handle'] === 'string' &&
    (value['status'] === 'online' || value['status'] === 'away' || value['status'] === 'busy') &&
    typeof value['message'] === 'string'
  )
}

export function isFriendRecord(record: unknown): record is FriendRecord {
  return (
    isObject(record) &&
    typeof record['id'] === 'string' &&
    isPeerId(record['id']) &&
    typeof record['handle'] === 'string' &&
    typeof record['addedAt'] === 'number' &&
    (record['petname'] === undefined || typeof record['petname'] === 'string') &&
    (record['mutedUntil'] === undefined || typeof record['mutedUntil'] === 'number') &&
    (record['removedYouAt'] === undefined || typeof record['removedYouAt'] === 'number') &&
    isPlace(record)
  )
}

export function isFriendRecords(value: unknown): value is readonly FriendRecord[] {
  return Array.isArray(value) && value.every(isFriendRecord)
}

/**
 * Saved friends read one by one, so a record that fails its check costs only that friend. The
 * ones that fail come back untouched, exactly as stored, for the caller to keep. A stored value
 * that isn't a list at all counts as one unreadable record.
 */
export function splitFriendRecords(value: unknown): {
  readonly readable: readonly FriendRecord[]
  readonly unreadable: readonly unknown[]
} {
  if (value === undefined) return { readable: [], unreadable: [] }
  if (!Array.isArray(value)) return { readable: [], unreadable: [value] }
  return {
    readable: value.filter(isFriendRecord),
    unreadable: value.filter((record) => !isFriendRecord(record)),
  }
}

/**
 * A pair secret, if any, whether you've moved to its rooms, whether it's from before secrets
 * were sealed, and an old one being replaced (`replacing` on a friend, `old` on a farewell).
 */
const isPlace = (record: Record<string, unknown>) =>
  (record['secret'] === undefined || isPairSecret(record['secret'])) &&
  (record['moved'] === undefined || typeof record['moved'] === 'boolean') &&
  (record['sealed'] === undefined || typeof record['sealed'] === 'boolean') &&
  (record['replacing'] === undefined ||
    (isReplacing(record['replacing']) && record['secret'] !== undefined)) &&
  (record['old'] === undefined || isPairSecret(record['old']))

/** Farewells: records, or the bare ids stored before pair secrets. */
export function isFarewells(value: unknown): value is readonly (PeerId | FarewellRecord)[] {
  return (
    Array.isArray(value) &&
    value.every(
      (entry) =>
        (typeof entry === 'string' && isPeerId(entry)) ||
        (isObject(entry) &&
          typeof entry['id'] === 'string' &&
          isPeerId(entry['id']) &&
          isPlace(entry)),
    )
  )
}

export function isMessengerSettings(value: unknown): value is MessengerSettings {
  return isObject(value) && typeof value['relayOnly'] === 'boolean'
}

export function isBlockedRecords(value: unknown): value is readonly BlockedRecord[] {
  return (
    Array.isArray(value) &&
    value.every(
      (record) =>
        isObject(record) &&
        typeof record['id'] === 'string' &&
        isPeerId(record['id']) &&
        typeof record['handle'] === 'string' &&
        typeof record['at'] === 'number',
    )
  )
}

export function isPeerIds(value: unknown): value is readonly PeerId[] {
  return Array.isArray(value) && value.every((id) => typeof id === 'string' && isPeerId(id))
}

const isEntry = (value: unknown): value is LogEntry =>
  isObject(value) &&
  typeof value['author'] === 'string' &&
  typeof value['seq'] === 'number' &&
  typeof value['lamport'] === 'number' &&
  typeof value['at'] === 'number' &&
  typeof value['text'] === 'string' &&
  typeof value['sig'] === 'string'

/** Our own writes, so signatures aren't rechecked; the shape is. */
export function isChatLog(value: unknown): value is ChatLog {
  return (
    isObject(value) &&
    typeof value['id'] === 'string' &&
    Array.isArray(value['entries']) &&
    value['entries'].every(isEntry)
  )
}

/** A live code kept across reloads. One from before codes went through SPAKE2 isn't one. */
export function isHostedInvite(value: unknown): value is HostedInvite {
  const tries = isObject(value) ? value['wrongTries'] : undefined
  return (
    isObject(value) &&
    isLiveCode(value['code']) &&
    typeof value['expiresAt'] === 'number' &&
    (tries === undefined || (Number.isSafeInteger(tries) && (tries as number) >= 0))
  )
}
