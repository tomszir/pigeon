// Shape checks for what the Messenger reads back from storage. A value that doesn't match is
// treated as missing rather than trusted.
import { type ChatLog, isPairSecret, isPeerId, type LogEntry, type PeerId } from '@pigeon/core'
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

export function isFriendRecords(value: unknown): value is readonly FriendRecord[] {
  return (
    Array.isArray(value) &&
    value.every(
      (record) =>
        isObject(record) &&
        typeof record['id'] === 'string' &&
        isPeerId(record['id']) &&
        typeof record['handle'] === 'string' &&
        typeof record['addedAt'] === 'number' &&
        (record['petname'] === undefined || typeof record['petname'] === 'string') &&
        (record['mutedUntil'] === undefined || typeof record['mutedUntil'] === 'number') &&
        (record['removedYouAt'] === undefined || typeof record['removedYouAt'] === 'number') &&
        isPlace(record),
    )
  )
}

/** A pair secret, if any, and whether you've moved to its rooms (decision 0026). */
const isPlace = (record: Record<string, unknown>) =>
  (record['secret'] === undefined || isPairSecret(record['secret'])) &&
  (record['moved'] === undefined || typeof record['moved'] === 'boolean')

/** Farewells: records, or the bare ids stored before 0026. */
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

export function isHostedInvite(value: unknown): value is HostedInvite {
  return (
    isObject(value) && typeof value['code'] === 'string' && typeof value['expiresAt'] === 'number'
  )
}
