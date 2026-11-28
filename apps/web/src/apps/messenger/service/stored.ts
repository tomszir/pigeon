// What the Messenger keeps in storage: the keys it uses, the shape of each record, and the checks
// on what is read back. A value that doesn't match is treated as missing rather than trusted.
// Nothing here imports from the Messenger itself, so the records can be read from anywhere
// without an import cycle.
import {
  type ChatLog,
  isHandle,
  isLighthouseAddress,
  isLiveCode,
  isPairSecret,
  isPeerId,
  isSealingKey,
  type LighthouseAddress,
  type LiveCode,
  type LogEntry,
  MAX_HANDLE_LENGTH,
  MAX_PERSONAL_MESSAGE_LENGTH,
  type PeerId,
  type SealingKey,
  type Status,
} from '@pigeon/core'
import { isReplacing, type Replacing } from './rekeys.ts'

export interface Profile {
  readonly handle: string
  readonly status: Status
  readonly message: string
}

export interface FriendRecord {
  readonly id: PeerId
  /** The name they chose, as last seen in their signed hello. */
  readonly handle: string
  readonly addedAt: number
  /** What you call them, shown instead of their handle. */
  readonly petname?: string | undefined
  /** No balloons and no shaking from them until then (`Infinity` stored as -1: until unmuted). */
  readonly mutedUntil?: number | undefined
  /** They removed you: the chat stays, read-only, until you remove them too. */
  readonly removedYouAt?: number | undefined
  /** The pair secret your rooms are named from; none for friends not yet moved. */
  readonly secret?: string | undefined
  /** Both of you hold the secret, so the old room named from your ids is no longer used. */
  readonly moved?: boolean | undefined
  /**
   * The secret was made here, or reached this device sealed to it, by a Pigeon that seals every
   * secret it hands over. One without it is from before, and is replaced.
   */
  readonly sealed?: boolean | undefined
  /** Moving off an old secret: `secret` is already the new one. */
  readonly replacing?: Replacing | undefined
  /** The round before `replacing`, when a removal began a new one from its winner. */
  readonly prior?: Replacing | undefined
  /** A device that held the secret was removed here: it's replaced at the next mail check. */
  readonly renew?: boolean | undefined
  /** The secret proposed here after that removal, until a round begins from it. */
  readonly begun?: string | undefined
}

/** A friend you removed who hasn't been told yet, and where to find them. */
export interface FarewellRecord {
  readonly id: PeerId
  readonly secret?: string | undefined
  readonly moved?: boolean | undefined
  /** The secret being replaced, while they may not have heard of the new one: met in too. */
  readonly old?: string | undefined
  /** Left in their mailbox too: their receipt says it was heard, as meeting them would. */
  readonly mailed?: boolean | undefined
}

export interface MessengerSettings {
  /** Connect to friends through the TURN relay only, so they never learn your IP address. */
  readonly relayOnly: boolean
  /**
   * Hear about mail at once: wait at your own Lighthouses while Pigeon is open, so mail arrives
   * in seconds. On unless turned off.
   */
  readonly hearAtOnce?: boolean | undefined
}

/** Someone you've blocked: their invite requests and answers are refused. */
export interface BlockedRecord {
  readonly id: PeerId
  readonly handle: string
  readonly at: number
}

/**
 * What a friend's devices said about their mail: each device's sealing key, and the Lighthouses
 * that friend's Pigeon wants mail left at. Kept for every friend, and for your own devices.
 */
export interface MailBook {
  readonly keys: Readonly<Record<PeerId, SealingKey>>
  readonly lighthouses: readonly LighthouseAddress[]
}

export const isMailBook = (value: unknown): value is MailBook =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as MailBook).keys === 'object' &&
  (value as MailBook).keys !== null &&
  Object.values((value as MailBook).keys).every(isSealingKey) &&
  Array.isArray((value as MailBook).lighthouses) &&
  (value as MailBook).lighthouses.every(isLighthouseAddress)

/** The invite this tab is hosting. */
export interface HostedInvite {
  readonly code: LiveCode
  readonly expiresAt: number
  /** Wrong tries it has had, kept so a reload doesn't give a guesser five more. */
  readonly wrongTries?: number
}

export const KEYS = {
  profile: 'profile',
  friends: 'friends',
  /** Saved friend records that failed their check, exactly as they were stored. Never written over. */
  unreadableFriends: 'friends-unreadable',
  /** Same for blocked records and farewells. */
  unreadableBlocked: 'blocked-unreadable',
  unreadableFarewells: 'farewells-unreadable',
  invite: 'invite',
  blocked: 'blocked',
  /** Friends you removed who haven't been told yet. */
  farewells: 'farewells',
  settings: 'messengerSettings',
  /** When your name or personal message last changed, so the newest wins on your devices. */
  profileChangedAt: 'profileChangedAt',
  /** Set once the balloon reminding you to make a recovery key has been shown. */
  recoveryReminded: 'recoveryReminded',
  /**
   * Set once this device has put its open invite links' cards again, signed low-S: a card put
   * before Pigeon took only low-S may be refused, and nothing else puts it again on its own.
   */
  cardsPutLowS: 'cardsPutLowS',
  /** The Lighthouses this Pigeon wants its mail left at, once changed from the default. */
  lighthouses: 'lighthouses',
  /** When the Lighthouse list was last changed here, so the newest wins on your devices. */
  lighthousesChangedAt: 'lighthousesChangedAt',
  /** The self secret was replaced: My Devices asks you to check your list, until you have. */
  checkDevices: 'checkDevices',
  /**
   * The devices taken off your list that what a removal calls for (secrets marked to renew) was
   * last worked out for. A removal not in it, whenever this device first
   * sees it, is acted on, even after a tab closed between keeping the log and acting.
   */
  removalsSeen: 'removalsSeen',
  /** Your shared log: every entry this device holds, from each of your devices. */
  sharedLog: 'shared-log',
  /** What each of your other devices last said its shared log holds: its summary. */
  sharedKnown: 'shared-known',
  /** Your other devices that said they read `mail:sync`. */
  syncReaders: 'sync-readers',
  /** What a friend's devices (or your own, under your own id) said about their mail. */
  mailBook: (id: PeerId) => `mail-book:${id}`,
  log: (id: PeerId) => `log:${id}`,
} as const

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
 * Saved records read one by one, so a record that fails its check costs only itself. The ones
 * that fail come back untouched, exactly as stored, for the caller to keep. A stored value that
 * isn't a list at all counts as one unreadable record.
 */
function splitRecords<T>(
  value: unknown,
  isRecord: (record: unknown) => record is T,
): { readonly readable: readonly T[]; readonly unreadable: readonly unknown[] } {
  if (value === undefined) return { readable: [], unreadable: [] }
  if (!Array.isArray(value)) return { readable: [], unreadable: [value] }
  return {
    readable: value.filter(isRecord),
    unreadable: value.filter((record) => !isRecord(record)),
  }
}

export const splitFriendRecords = (value: unknown) => splitRecords(value, isFriendRecord)

/**
 * A pair secret, if any, whether you've moved to its rooms, whether it's from before secrets
 * were sealed, an old one being replaced (`replacing`, and `prior`, the round before, on a
 * friend; `old` on a farewell), whether it's to be replaced after a removal, and what was
 * proposed here after one.
 */
const isPlace = (record: Record<string, unknown>) =>
  (record['secret'] === undefined || isPairSecret(record['secret'])) &&
  (record['moved'] === undefined || typeof record['moved'] === 'boolean') &&
  (record['sealed'] === undefined || typeof record['sealed'] === 'boolean') &&
  (record['replacing'] === undefined ||
    (isReplacing(record['replacing']) && record['secret'] !== undefined)) &&
  (record['prior'] === undefined ||
    (isReplacing(record['prior']) && record['replacing'] !== undefined)) &&
  (record['renew'] === undefined || typeof record['renew'] === 'boolean') &&
  (record['begun'] === undefined || isPairSecret(record['begun'])) &&
  (record['old'] === undefined || isPairSecret(record['old']))

/** A farewell: a record, or the bare id stored before pair secrets. */
export const isFarewell = (entry: unknown): entry is PeerId | FarewellRecord =>
  (typeof entry === 'string' && isPeerId(entry)) ||
  (isObject(entry) && typeof entry['id'] === 'string' && isPeerId(entry['id']) && isPlace(entry))

export function isFarewells(value: unknown): value is readonly (PeerId | FarewellRecord)[] {
  return Array.isArray(value) && value.every(isFarewell)
}

export const splitFarewells = (value: unknown) => splitRecords(value, isFarewell)

export function isMessengerSettings(value: unknown): value is MessengerSettings {
  return (
    isObject(value) &&
    typeof value['relayOnly'] === 'boolean' &&
    (value['hearAtOnce'] === undefined || typeof value['hearAtOnce'] === 'boolean')
  )
}

export function isBlockedRecord(record: unknown): record is BlockedRecord {
  return (
    isObject(record) &&
    typeof record['id'] === 'string' &&
    isPeerId(record['id']) &&
    typeof record['handle'] === 'string' &&
    typeof record['at'] === 'number'
  )
}

export function isBlockedRecords(value: unknown): value is readonly BlockedRecord[] {
  return Array.isArray(value) && value.every(isBlockedRecord)
}

export const splitBlockedRecords = (value: unknown) => splitRecords(value, isBlockedRecord)

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

// What an imported file may bring. A file is handed over by someone else, so its names are held
// to what live input holds and only the fields Pigeon knows are kept; the secret-replacement
// fields are checked and copied as saved data has them.

/** A name that fits live input's limit. Characters a name may not hold are taken out later, as for any saved name. */
const fitsName = (value: string) => value.length <= MAX_HANDLE_LENGTH

const importedFriend = (record: FriendRecord): FriendRecord | undefined => {
  if (!fitsName(record.handle) || (record.petname !== undefined && !fitsName(record.petname)))
    return undefined
  return {
    id: record.id,
    handle: record.handle,
    addedAt: record.addedAt,
    ...(record.petname === undefined ? {} : { petname: record.petname }),
    ...(record.mutedUntil === undefined ? {} : { mutedUntil: record.mutedUntil }),
    ...(record.removedYouAt === undefined ? {} : { removedYouAt: record.removedYouAt }),
    ...(record.secret === undefined ? {} : { secret: record.secret }),
    ...(record.moved === undefined ? {} : { moved: record.moved }),
    ...(record.sealed === undefined ? {} : { sealed: record.sealed }),
    ...(record.replacing === undefined ? {} : { replacing: record.replacing }),
    ...(record.prior === undefined ? {} : { prior: record.prior }),
    ...(record.renew === undefined ? {} : { renew: record.renew }),
    ...(record.begun === undefined ? {} : { begun: record.begun }),
  }
}

/** Friends from a file: undefined if any is unreadable or has a name over the limit. */
export function importedFriends(value: unknown): readonly FriendRecord[] | undefined {
  if (!isFriendRecords(value)) return undefined
  const records = value.map(importedFriend)
  return records.every((record) => record !== undefined)
    ? (records as readonly FriendRecord[])
    : undefined
}

/**
 * Friends from a link bundle, read one by one: each that isn't a friend record this Pigeon reads,
 * or has a name over the limit, comes back untouched in `unreadable`, and the rest with only the
 * fields Pigeon knows. Undefined when the bundle holds no list of friends at all.
 */
export function bundleFriends(
  value: unknown,
):
  | { readonly readable: readonly FriendRecord[]; readonly unreadable: readonly unknown[] }
  | undefined {
  if (!Array.isArray(value)) return undefined
  const readable: FriendRecord[] = []
  const unreadable: unknown[] = []
  for (const record of value) {
    const friend = isFriendRecord(record) ? importedFriend(record) : undefined
    if (friend === undefined) unreadable.push(record)
    else readable.push(friend)
  }
  return { readable, unreadable }
}

/** Blocked people from a file: undefined if any is unreadable or has a name over the limit. */
export function importedBlocked(value: unknown): readonly BlockedRecord[] | undefined {
  if (!isBlockedRecords(value) || !value.every((record) => fitsName(record.handle)))
    return undefined
  return value.map(({ id, handle, at }) => ({ id, handle, at }))
}

/**
 * A profile from a file, or undefined if it isn't one a person could have set: a name of 1 to 32
 * characters with none a name may not hold, and a personal message of at most 120.
 */
export function importedProfile(value: unknown): Profile | undefined {
  if (!isProfile(value)) return undefined
  const { handle, status, message } = value
  if (!isHandle(handle) || message.length > MAX_PERSONAL_MESSAGE_LENGTH) return undefined
  return { handle, status, message }
}

export function importedSettings(value: unknown): MessengerSettings | undefined {
  if (!isMessengerSettings(value)) return undefined
  return value.hearAtOnce === undefined
    ? { relayOnly: value.relayOnly }
    : { relayOnly: value.relayOnly, hearAtOnce: value.hearAtOnce }
}

/** A plain copy of a round: what's read from the Solid store is a proxy, which storage can't clone. */
export const plainRound = (round: Replacing): Replacing => ({
  ...round,
  ...(round.heard === undefined ? {} : { heard: [...round.heard] }),
  ...(round.resent === undefined ? {} : { resent: [...round.resent] }),
})

/** What's stored of a secret's replacement. */
export interface SecretFlags {
  readonly sealed?: true
  readonly replacing?: Replacing
  readonly prior?: Replacing
  readonly renew?: true
  readonly begun?: string
}

/** What's stored of a secret's replacement: only what's set. */
export const secretFlags = ({
  sealed,
  replacing,
  prior,
  renew,
  begun,
}: Pick<FriendRecord, 'sealed' | 'replacing' | 'prior' | 'renew' | 'begun'>): SecretFlags => ({
  ...(sealed === true ? { sealed } : {}),
  ...(replacing === undefined ? {} : { replacing: plainRound(replacing) }),
  ...(replacing === undefined || prior === undefined ? {} : { prior: plainRound(prior) }),
  ...(renew === true ? { renew } : {}),
  ...(begun === undefined ? {} : { begun }),
})
