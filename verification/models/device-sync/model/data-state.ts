// The state of the your-data model: your own devices, each with the entries of the shared log it
// holds, the pair secrets it is on, and what it knows of your device log; the friends' devices;
// the letters at the Lighthouses; and, kept apart as ghosts that no device reads, what really
// happened, for the invariants to check against.

/** Your devices. A writes the device log; X is the one that may be removed; C may be linked. */
export type Dev = 'A' | 'B' | 'C' | 'X'
export const WRITER: Dev = 'A'

/** The highest stamp an entry may carry; one past it is refused, and a device's own stop there. */
export const STAMP_CAP = 100
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
  | { readonly k: 'future'; readonly name?: string }

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

/**
 * A pair secret, as the signed proposal that made it. The first secret of a friendship (made when
 * pairing) replaces nothing; each replacement names the secret it replaces, when it was proposed
 * and by which device, as replacement rounds do. `round` is how many replacements deep it claims
 * to be, which the design never trusts and a planted defect does.
 */
export interface Proposal {
  readonly id: string
  /** The friendship (incarnation) it belongs to. */
  readonly inc: string
  readonly replaces: string | null
  readonly at: number
  readonly by: string
  readonly round: number
  /**
   * The removals its maker had merged when it signed it (`rmX` on your side, `rmF` on the
   * friend's): a kept marker, signed with the proposal, that says whether a removed device could
   * have been sealed it.
   */
  readonly knew: readonly LogEvent[]
}

/** Per author: the highest entry number held with none missing, and a digest of those entries. */
export type Summary = Partial<Record<Dev, { readonly n: number; readonly digest: string }>>

/**
 * The device log events a device has merged: X's removal and C's adding on your log, and `rmF`,
 * the friend's removal of one of its own devices, from the friend's log.
 */
export type LogEvent = 'rmX' | 'addC' | 'rmF'

export interface Device {
  /** This device's own clock, which only its own actions move (and a clock gone wrong). */
  clock: number
  log: LogEvent[]
  entries: Entry[]
  /** The pair-secret proposals it knows, per friendship (or per friend, under a planted defect). */
  props: Record<string, Proposal[]>
  /** What each other device of yours is known to hold, from that device's own letters. */
  known: Partial<Record<Dev, Summary>>
  /** Holds something it hasn't sent its other devices since. */
  dirty: boolean
  nextN: number
  /** Ghost: every pair secret this device has ever held or read. */
  learned: string[]
}

/** `friend-rekey` is a friend's own replacement proposal, sealed to your devices it knows of. */
export type LetterKind = 'sync' | 'rekey' | 'rekey-friend' | 'friend-rekey'

export interface Letter {
  id: number
  kind: LetterKind
  from: Dev | FriendId
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
  /** Pair-secret proposals, per friendship, sealed beside the entries. */
  props: Record<string, Proposal[]>
  /** What the sender holds, so the recipient knows what to send it back. */
  summary: Summary
}

/** A change a device on the list made, as the person meant it: the ghost the oracle reads. */
export interface Action {
  readonly by: Dev
  readonly n: number
  readonly st: number
  readonly field: string
  readonly value: string
  /** The changes to the same field, by devices on the list, it was made after seeing. */
  readonly saw: readonly string[]
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
  | 'skew'
  | 'friendRound'
  | 'friendRemove'
  | 'friendSync'
  | 'friendRelay'
  | 'hold'

export interface FriendDevice {
  inc: string
  props: Proposal[]
  learned: string[]
  /** Has merged the device log that removed X, from a letter carrying it. */
  knowsR: boolean
  /** The friend's own writer removed one of the friend's devices, and when by its clock. */
  ownRemoved: boolean
  ownRemovedAt: number
  /**
   * The friend's second device, in the relay scenario only: the chain it holds from the first,
   * and whether its copy of your list has your removal of X.
   */
  second?: { props: Proposal[]; knowsR: boolean }
}

export interface DataState {
  devs: Partial<Record<Dev, Device>>
  /** Stamp of X's removal on the writer's log, 0 while X is on it. */
  removalSt: number
  /** Every device still on the list has merged the removal. */
  allKnew: boolean
  /** The writer removed a device and hasn't replaced the secrets yet. */
  renew: boolean
  /** Each friend's device: the friendship it's in, the proposals it knows, and what it has read. */
  friends: Partial<Record<FriendId, FriendDevice>>
  mail: Letter[]
  /** Ghost: every pair secret made, by whom, and whether its maker knew of X's removal. */
  secrets: Record<string, { by: string; knew: boolean; root?: FriendId }>
  actions: Action[]
  /** Ghost: friendships a device ended to settle two re-pairings with one friend. */
  repairTombs?: string[]
  /** Ghost: friendships (incarnations) a device on the list ended. */
  tombs: string[]
  left: Partial<Record<Budget, number>>
  nextLetter: number
  /** Ghost: the entries of X the writer held when it removed X, which must keep counting. */
  heldAtRemoval: string[]
  /** What a hostile removed device last sent each device, so it doesn't send the same again. */
  xSent: Record<string, string>
  /** Ghost: the friendships live on the writer when it removed X. */
  liveAtRemoval: string[]
  /** Ghost: the friendships the writer has renewed after the removal. */
  renewed: string[]
  /** The writer's own clock when it removed X; the threshold may be later. */
  removalAt: number
  /** A Lighthouse holds the friends' mail: letters to them wait until it lets them go. */
  friendHold?: true
  /** Ghost: forged proposals X mailed a friend that already knew of the removal. */
  lateToFriend: string[]
  /** Ghost: each winner a side's writer renewed from (`A:F1r0`), and any it shouldn't have. */
  renewedFrom: string[]
  renewalWrong?: string
  /** Ghost: renewals each side's writer has made of each friendship (`A:F1`, `F:F1`). */
  renewals: Record<string, number>
  /** Settling ran out of rounds without reaching a fixed point. */
  unsettled?: true
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
  /** A summary carries a digest per author, so two entries with one number are both sent. */
  readonly forkDigest: boolean
  /** Pair-secret state belongs to a friendship (an incarnation). Off: to the friend. */
  readonly secretPerIncarnation: boolean
  /**
   * A secret is chosen as replacement rounds choose: from the friendship's first secret, the
   * earliest proposal (time, device, secret) for the one held, counting only proposals whose
   * device is on its side's list. Off: the highest round anyone claims.
   */
  readonly chainRules: boolean
  /** An entry is taken whatever its stamp. Off: one more than 2 ahead of this clock is refused. */
  readonly acceptAhead: boolean
  /** A friendship's pair-secret state is kept after its tombstone. Off: the tombstone drops it. */
  readonly keepEndedSecrets: boolean
  /** A device whose secret for a friendship changes sends the proposals to the friend too. */
  readonly tellFriend: boolean
  /**
   * A first secret counts like an entry: from a device on the list, or from a removed one if it
   * stamped it before its removal; of several, the earliest (time, device, secret). Off: any
   * first secret counts, and the one a device holds first is kept.
   */
  readonly rootRules: boolean
  /**
   * After a removal, each side's writer renews every live friendship whose secret a removed device
   * could have been sealed: one whose maker hadn't merged the removal when it signed it, or the
   * removed device's own. Its renewal is made knowing the removal, so it never renews it again,
   * and the other side renews it at most once. Off: renew unless the writer proposed it after the
   * removal by time, which the other side's writer does too, for ever.
   */
  readonly renewByKnowledge: boolean
  /** The writer considers friendships it learns of after the removal. Off: those live then. */
  readonly renewLearned: boolean
  /** The writer renews again from a rival that beat its renewal. Off: once per friendship. */
  readonly renewRivals: boolean
  /** A friend whose secret changes sends the proposals to your devices too, first secrets included. */
  readonly friendForwards: boolean
  /**
   * A removal's threshold is the `at` of its own device-log entry, which the writer sets later
   * than every entry it holds from the device, so it reaches friends with the log. Off: friends
   * judge by the writer's clock at the removal while your devices have a later threshold.
   */
  readonly thresholdInLog: boolean
  /**
   * A summary gives, per author, the highest number held (whatever is missing below it) and a
   * digest of the entries held up to it. Off: the highest number held with none missing, so a gap
   * nobody can fill makes every exchange send that author's entries again, for ever.
   */
  readonly summaryHighestHeld: boolean
  /**
   * A change is stamped past only the entries about its subject that count on the device. Off:
   * past every entry held, so a removed device's entry stamped at the cap, discounted since, still
   * pushes later changes to the cap, where they tie and the device decides.
   */
  readonly stampFollowsCounting: boolean
  /**
   * To settle two re-pairings, a device ends the other friendship only once it has itself seen
   * the friend in one whose secret it holds. Off: each keeps the friendship it paired and ends the
   * rest, so two devices end each other's, and no friendship is left.
   */
  readonly repairSeenByDevice: boolean
  /**
   * Fold looks up only kinds it knows as its own; any other name, `__proto__` or `constructor`
   * included, is unreadable and skipped. Off: a name the lookup table inherits fails the fold.
   */
  readonly kindsOwnOnly: boolean
  /** A friend refuses a letter from a device it knows you removed. */
  readonly friendRefuses: boolean
  /** A friend's device doesn't count a replacement by a device it knows you removed. */
  readonly friendDiscounts: boolean
  /** The writer renews a secret the removed device made, whatever its marker claims. */
  readonly renewRemovedOwn: boolean
  /**
   * A letter carrying a chain carries both sides' newest device logs, merged before sealing, also
   * between one side's own devices. Off: the friend's devices pass a chain between themselves
   * without your log, so a second device seals it on a stale copy of your list.
   */
  readonly relayCarriesLogs: boolean
  /** Two live friendships with one friend: the one the friend is seen in stays, the other ends. */
  readonly settleRepairs: boolean
  /** A removal's stamp is later than every entry the writer holds from that device. */
  readonly removalAfterHeld: boolean
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
  forkDigest: true,
  secretPerIncarnation: true,
  chainRules: true,
  acceptAhead: true,
  keepEndedSecrets: true,
  tellFriend: true,
  rootRules: true,
  renewByKnowledge: true,
  renewLearned: true,
  renewRivals: true,
  friendForwards: true,
  thresholdInLog: true,
  repairSeenByDevice: true,
  kindsOwnOnly: true,
  summaryHighestHeld: true,
  stampFollowsCounting: true,
  friendRefuses: true,
  friendDiscounts: true,
  renewRemovedOwn: true,
  relayCarriesLogs: true,
  settleRepairs: true,
  removalAfterHeld: true,
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
  /**
   * What a hostile removed device forges, in order: an entry at an early or a current stamp, or a
   * pair-secret proposal of its own for F, claiming a high round.
   */
  readonly forges?: readonly (
    | {
        readonly op: Op
        readonly stamp: 'early' | 'current' | 'ahead' | 'cap'
        /** Signed under a number one past the next, leaving a gap no device can fill. */
        readonly skip?: boolean
      }
    | { readonly proposal: true }
    | { readonly root: FriendId; readonly at?: 'removal' }
  )[]
  /** People change petnames only on devices that have heard of the removal (one scenario). */
  readonly petAfterRemoval?: boolean
  /** The devices of yours a hostile removed device mails, besides the friends; all when left out. */
  readonly xMails?: readonly Dev[]
  /** Which friends a person may pair with (again, after an unfriend); G when left out. */
  readonly adds?: readonly FriendId[]
  /** Which friends people change; any when left out. */
  readonly targets?: readonly FriendId[]
  readonly rules: DataRules
}

export function newDevice(): Device {
  return {
    clock: 1,
    log: [],
    entries: [],
    props: {},
    known: {},
    dirty: false,
    nextN: 1,
    learned: [],
  }
}

/** Where a friendship's pair-secret proposals are kept: by friendship, or by friend. */
export const propKey = (rules: DataRules, fr: FriendId, inc: string): string =>
  rules.secretPerIncarnation ? inc : fr

/** F is already a friend on every device, on secret F1r0, with an `add` entry the writer made. */
export function initialState(cfg: DataConfig): DataState {
  const add: Entry = { by: WRITER, n: 1, st: 1, op: { k: 'add', fr: 'F', inc: 'F1' }, sig: 'A1a' }
  const first: Proposal = {
    id: 'F1r0',
    inc: 'F1',
    replaces: null,
    at: 1,
    by: WRITER,
    round: 0,
    knew: [],
  }
  const key = propKey(cfg.rules, 'F', 'F1')
  const devs: Partial<Record<Dev, Device>> = {}
  for (const d of cfg.devices) {
    devs[d] = {
      ...newDevice(),
      log: cfg.devices.includes('C') ? ['addC'] : [],
      entries: [add],
      props: { [key]: [first] },
      nextN: d === WRITER ? 2 : 1,
      learned: [first.id],
    }
  }
  return {
    devs,
    removalSt: 0,
    allKnew: false,
    renew: false,
    friends: {
      F: {
        inc: 'F1',
        props: [first],
        learned: [first.id],
        knowsR: false,
        ownRemoved: false,
        ownRemovedAt: 0,
      },
    },
    mail: [],
    secrets: { [first.id]: { by: WRITER, knew: false, root: 'F' } },
    actions: [{ by: WRITER, n: 1, st: 1, field: 'inc:F1', value: 'add', saw: [] }],
    tombs: [],
    left: { ...cfg.budgets },
    nextLetter: 1,
    xSent: {},
    heldAtRemoval: [],
    liveAtRemoval: [],
    renewed: [],
    renewals: {},
    removalAt: 0,
    lateToFriend: [],
    renewedFrom: [],
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
