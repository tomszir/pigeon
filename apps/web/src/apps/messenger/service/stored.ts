// Shape checks for what the Messenger reads back from storage. A value that doesn't match is
// treated as missing rather than trusted.
import { type ChatLog, isPeerId, type LogEntry } from '@pigeon/core'
import type { FriendRecord, Profile } from './service.ts'

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
        typeof record['addedAt'] === 'number',
    )
  )
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
