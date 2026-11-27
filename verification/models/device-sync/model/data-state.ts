// The state of the your-data model: your own devices, each with the entries of the shared log it
// holds, the pair secrets it is on, and what it knows of your device log; the friends' devices;
// the letters at the Lighthouses; and, kept apart as ghosts that no device reads, what really
// happened, for the invariants to check against.

/** Your devices. A writes the device log; X is the one that may be removed; C may be linked. */
export type Dev = 'A' | 'B' | 'C' | 'X'
export const WRITER: Dev = 'A'
export const REMOVED: Dev = 'X'

/** F is a friend from the start; G is a friend a device of yours may add. */
export type FriendId = 'F' | 'G'

/** What one entry of the shared log says. */
export type Op =
  | { readonly k: 'add'; readonly fr: FriendId; readonly inc: string }
  | { readonly k: 'tomb'; readonly fr: FriendId; readonly inc: string }
  | { readonly k: 'pet'; readonly fr: FriendId; readonly v: string }
  | { readonly k: 'block'; readonly fr: FriendId; readonly v: boolean }
  | { readonly k: 'relay'; readonly v: boolean }
  /** A kind a newer Pigeon writes and this one can't read. */
  | { readonly k: 'future' }

/**
 * An entry, signed by the device that wrote it: its number in that device's log, its stamp (a
 * Lamport time: later than anything the device had seen), and what it says. `sig` stands for the
 * signature's bytes. `late` is a ghost: a removed device wrote it after every device still on
 * the list knew of the removal.
 */
export interface Entry {
  readonly by: Dev
  readonly n: number
  readonly st: number
  readonly op: Op
  readonly sig: string
  readonly late?: true
}

/** A pair secret, and the round of replacement it came from: a later round replaces it. */
export interface Secret {
  readonly id: string
  readonly round: number
}

/** The device log events a device has merged: X's removal, C's adding. */
export type LogEvent = 'rmX' | 'addC'

export interface Device {
  clock: number
  log: LogEvent[]
  entries: Entry[]
  secrets: Partial<Record<FriendId, Secret>>
  /** Holds something it hasn't sent its other devices since. */
  dirty: boolean
  nextN: number
  /** Ghost: every pair secret this device has ever held or read. */
  learned: string[]
}

export type LetterKind = 'sync' | 'rekey' | 'rekey-friend'

export interface Letter {
  id: number
  kind: LetterKind
  from: Dev
  /** The devices it was sealed to. */
  to: string[]
  /** Those that haven't taken it yet. */
  pending: string[]
  /** Those it was lost for, until it's put again. */
  lost: string[]
  /** Put at a Lighthouse yet, or still waiting to be. */
  put: boolean
  /** Ghost: the sender knew of X's removal when it last sealed this. */
  knew: boolean
  /** Ghost: the sender's device log when it last sealed this, whatever the letter carries. */
  sealedWith: LogEvent[]
  /** The device log events it carries, merged first by whoever opens it. */
  log: LogEvent[]
  entries: Entry[]
  secrets: Partial<Record<FriendId, Secret>>
}

/** A change a device on the list made, as the person meant it: the ghost the oracle reads. */
export interface Action {
  readonly by: Dev
  readonly n: number
  readonly st: number
  readonly field: string
  readonly value: string
}

export type Budget =
  | 'add'
  | 'unfriend'
  | 'pet'
  | 'block'
  | 'unblock'
  | 'relay'
  | 'remove'
  | 'link'
  | 'meet'
  | 'lose'
  | 'crash'
  | 'forge'
  | 'fork'
  | 'future'
  | 'stale'

export interface DataState {
  devs: Partial<Record<Dev, Device>>
  /** Stamp of X's removal on the writer's log, 0 while X is on it. */
  removalSt: number
  /** Every device still on the list has merged the removal. */
  allKnew: boolean
  /** The writer removed a device and hasn't replaced the secrets yet. */
  renew: boolean
  /** Each friend's device: the pair secret it's on, and every one it has read. */
  friends: Partial<Record<FriendId, { secret: Secret; learned: string[] }>>
  mail: Letter[]
  /** Ghost: every pair secret made, by whom, and whether its maker knew of X's removal. */
  secrets: Record<string, { by: string; knew: boolean }>
  actions: Action[]
  /** Ghost: friendships (incarnations) a device on the list ended. */
  tombs: string[]
  left: Partial<Record<Budget, number>>
  nextLetter: number
  /** What a hostile removed device last sent each device, so it doesn't send the same again. */
  xSent: Partial<Record<Dev, string>>
}

/** Design rules, each a switch; a planted defect turns one off. */
export interface DataRules {
  /** Unfriending leaves a tombstone entry. Off: the friend's entries are dropped on that device. */
  readonly tombstones: boolean
  /** A register takes the entry with the highest stamp. Off: the one that arrived last. */
  readonly stampOrder: boolean
  /** A letter is sealed to the sender's list as it is now. Off: to every device it ever knew. */
  readonly sealToList: boolean
  /** A letter put again is sealed again, to the list as it is then. Off: the same sealed letter. */
  readonly resealOnReput: boolean
  /** A letter carries the sender's device log, and whoever opens it merges that first. */
  readonly logFirst: boolean
  /** Entries a removed device stamped at or after its removal don't count. */
  readonly discountRemoved: boolean
  /** A letter counts only from a device on the list that results from merging its log. */
  readonly senderOnList: boolean
  /** Each entry is read on its own; one that can't be read is kept and skipped. */
  readonly perEntry: boolean
  /** A replacement goes into the outbox before it's put, so a closed tab puts it at next start. */
  readonly outbox: boolean
  /** Two different entries with one author and number: the lower signature wins everywhere. */
  readonly lowerSigWins: boolean
}

export const DESIGN: DataRules = {
  tombstones: true,
  stampOrder: true,
  sealToList: true,
  resealOnReput: true,
  logFirst: true,
  discountRemoved: true,
  senderOnList: true,
  perEntry: true,
  outbox: true,
  lowerSigWins: true,
}

export interface DataConfig {
  readonly name: string
  /** Your devices at the start, the writer first. */
  readonly devices: readonly Dev[]
  /** X does whatever it likes: forges entries with any stamp, sends them, reads what reaches it. */
  readonly hostile: boolean
  readonly budgets: Partial<Record<Budget, number>>
  /** Which devices may spend each budget; any of them when left out. */
  readonly who?: Partial<Record<Budget, readonly Dev[]>>
  /** What a hostile removed device forges, in order, each at an early stamp or a current one. */
  readonly forges?: readonly { readonly op: Op; readonly stamp: 'early' | 'current' }[]
  /** Which friends people change; any when left out. */
  readonly targets?: readonly FriendId[]
  readonly rules: DataRules
}

export function newDevice(): Device {
  return { clock: 1, log: [], entries: [], secrets: {}, dirty: false, nextN: 1, learned: [] }
}

/** F is already a friend on every device, on secret F1r0, with an `add` entry the writer made. */
export function initialState(cfg: DataConfig): DataState {
  const add: Entry = { by: WRITER, n: 1, st: 1, op: { k: 'add', fr: 'F', inc: 'F1' }, sig: 'A1a' }
  const first: Secret = { id: 'F1r0', round: 0 }
  const devs: Partial<Record<Dev, Device>> = {}
  for (const d of cfg.devices) {
    devs[d] = {
      ...newDevice(),
      log: cfg.devices.includes('C') ? ['addC'] : [],
      entries: [add],
      secrets: { F: first },
      nextN: d === WRITER ? 2 : 1,
      learned: [first.id],
    }
  }
  return {
    devs,
    removalSt: 0,
    allKnew: false,
    renew: false,
    friends: { F: { secret: first, learned: [first.id] } },
    mail: [],
    secrets: { [first.id]: { by: WRITER, knew: false } },
    actions: [{ by: WRITER, n: 1, st: 1, field: 'inc:F1', value: 'add' }],
    tombs: [],
    left: { ...cfg.budgets },
    nextLetter: 1,
    xSent: {},
  }
}

export const knowsRemoval = (dev: Device): boolean => dev.log.includes('rmX')

/** Every device of yours `d` has heard of, removed or not. */
export function everKnown(state: DataState, d: Dev): Dev[] {
  const log = state.devs[d]?.log ?? []
  return (Object.keys(state.devs) as Dev[])
    .filter((other) => other !== 'C' || d === 'C' || log.includes('addC'))
    .sort()
}

/** The devices on `d`'s own copy of the list. */
export function listOf(state: DataState, d: Dev): Dev[] {
  const dev = state.devs[d]
  return everKnown(state, d).filter((other) => other !== REMOVED || !dev || !knowsRemoval(dev))
}

/** The devices on the real list: the writer's. */
export function onList(state: DataState): Dev[] {
  return listOf(state, WRITER)
}

/** Devices that follow the design: on the list, and not X when X is hostile. */
export function honest(state: DataState, cfg: DataConfig): Dev[] {
  return onList(state).filter((d) => !(d === REMOVED && cfg.hostile))
}

export const entryKey = (e: Entry): string => `${e.by}:${e.n}`

export const byEntry = (a: Entry, b: Entry): number =>
  a.by === b.by ? a.n - b.n || (a.sig < b.sig ? -1 : a.sig > b.sig ? 1 : 0) : a.by < b.by ? -1 : 1
