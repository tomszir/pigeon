// What your devices leave each other in the self mailbox, so one that was offline catches up when
// it opens: your device log, your name and personal message, your Lighthouse list, and the
// sealing keys of your devices, so a device linked while another was away can still be written
// to. Each is a snapshot; the device log merges like any other copy, and the name and the list
// go by when they were changed, the newest winning, as they do in the self room.
import {
  type DeviceLog,
  isDeviceLog,
  isLighthouseAddress,
  isSealingKey,
  type Json,
  type LighthouseAddress,
  MAX_HANDLE_LENGTH,
  MAX_LIGHTHOUSES,
  MAX_PERSONAL_MESSAGE_LENGTH,
  type PeerId,
  type ProfileChange,
  type SealingKey,
} from '@pigeon/core'
import { isOtherLink, type OtherLink } from './invite-links.ts'

/** Your Lighthouse list, and when it was changed on the device that changed it. */
export interface LighthousesChange {
  readonly list: readonly LighthouseAddress[]
  readonly changedAt: number
}

/** A `mail:self` letter's body. */
export interface SelfNews {
  readonly log: DeviceLog
  readonly keys: readonly SealingKey[]
  readonly profile?: ProfileChange | undefined
  readonly lighthouses?: LighthousesChange | undefined
  /** Invite links the sending device made, so your other devices can show and close them. */
  readonly invites?: readonly OtherLink[] | undefined
}

/** At most this many invite links from one device. */
export const MAX_SELF_INVITES = 64

/** At most this many sealing keys, a few more than anyone has devices. */
export const MAX_SELF_KEYS = 32

export const selfNewsBody = (news: SelfNews): Json =>
  ({
    log: news.log,
    keys: news.keys,
    ...(news.profile === undefined ? {} : { profile: news.profile }),
    ...(news.lighthouses === undefined ? {} : { lighthouses: news.lighthouses }),
    ...(news.invites === undefined ? {} : { invites: news.invites }),
  }) as unknown as Json

const isTime = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0

const isText = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length <= max

function readProfile(value: unknown): ProfileChange | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const { handle, message, changedAt } = value as Record<string, unknown>
  return isText(handle, MAX_HANDLE_LENGTH) &&
    handle.trim() !== '' &&
    isText(message, MAX_PERSONAL_MESSAGE_LENGTH) &&
    isTime(changedAt)
    ? { handle, message, changedAt }
    : undefined
}

function readLighthouses(value: unknown): LighthousesChange | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const { list, changedAt } = value as Record<string, unknown>
  return Array.isArray(list) &&
    list.length > 0 &&
    list.length <= MAX_LIGHTHOUSES &&
    list.every(isLighthouseAddress) &&
    isTime(changedAt)
    ? { list, changedAt }
    : undefined
}

/**
 * Reads a `mail:self` body for `identity`: undefined unless it holds a device log of that
 * identity. A part that doesn't hold is left out, never the rest. Nothing here is checked
 * cryptographically: the log and each key are verified where they're taken.
 */
export function readSelfNews(identity: PeerId, body: unknown): SelfNews | undefined {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return undefined
  const fields = body as Record<string, unknown>
  const log = fields['log']
  if (!isDeviceLog(log) || log.identity !== identity) return undefined
  const keys = Array.isArray(fields['keys'])
    ? fields['keys'].filter(isSealingKey).slice(0, MAX_SELF_KEYS)
    : []
  return {
    log,
    keys,
    profile: readProfile(fields['profile']),
    lighthouses: readLighthouses(fields['lighthouses']),
    invites: Array.isArray(fields['invites'])
      ? fields['invites'].filter(isOtherLink).slice(0, MAX_SELF_INVITES)
      : undefined,
  }
}
