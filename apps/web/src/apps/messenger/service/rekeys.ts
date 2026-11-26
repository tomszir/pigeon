// Replacing a pair or self secret with a new one sent sealed to the devices that should hold it,
// after which both sides move to the new one's rooms. A secret is replaced when it may be known
// to someone it shouldn't be: one kept from before this Pigeon sealed every secret it handed
// over, which whoever watched the pairing or linking could know, and one held when a device that
// had it was removed. Each replacement is a round: proposals for one old secret, the earliest of
// which wins. A removal begins a new round for the secret held now, so a device can be two rounds
// along. This file holds the decisions, which are the same for a friend and for your own devices;
// the Messenger does the sending, the rooms and the storage.
import {
  type Crypto,
  isPairSecret,
  isPeerId,
  type PeerId,
  type Rekey,
  rekeyWins,
  replacesId,
  type Signer,
  signRekey,
  verifyRekey,
} from '@pigeon/core'

/** Moving off an old secret: the old one, and the proposal that wins so far. */
export interface Replacing {
  /** The secret being replaced. */
  readonly old: string
  /** When the winning proposal was made, and by which device. */
  readonly at: number
  readonly by: PeerId
  /** `by`'s signature on it, so it can be sent on as `by` made it. */
  readonly sig: string
  /**
   * When a device on the other side was first seen holding the new secret: a letter from it
   * naming it, or a hello in one of its rooms. Until then the old rooms are kept and mail goes
   * under the old secret, so a friend whose Pigeon doesn't know about this yet keeps hearing
   * you.
   */
  readonly heardAt?: number | undefined
  /**
   * The other side's devices seen holding it. The old secret's mail is looked for until every
   * device on their list is here, so one that was away can still ask, and be told.
   */
  readonly heard?: readonly PeerId[] | undefined
  /**
   * Every device on the other side was seen holding it, so the old rooms and mail are let go.
   * The rest is kept: a proposal that wins can still arrive afterwards, from a device on this
   * side whose letter was held up, and moves this device with the rest.
   */
  readonly settled?: boolean | undefined
  /**
   * The devices met in the old rooms that were sent the winner again, since a Pigeon that
   * couldn't use it may have taken it: each once, however often they meet, and only once a
   * Lighthouse took it.
   */
  readonly resent?: readonly PeerId[] | undefined
}

/** A secret as a device keeps it. */
export interface SecretState {
  /** The secret in use: the new one, once there's a proposal. */
  readonly secret: string
  /** Made or received sealed, by this Pigeon: nothing to replace. */
  readonly sealed?: boolean | undefined
  /** The round under way, or the last one: its old secret and the proposal winning it. */
  readonly replacing?: Replacing | undefined
  /**
   * The round before `replacing`, once a new round began from its winner, whose secret is
   * `replacing.old`. Kept so a device still in that round can be shown, with that winner's own
   * signature, where the new round began, and follow.
   */
  readonly prior?: Replacing | undefined
  /**
   * A device that held this secret was removed, here: this device begins a new round for it at
   * its next mail check, and keeps this until it has.
   */
  readonly renew?: boolean | undefined
  /**
   * The secret this device proposed when it began a round after a removal here. Until a round
   * begins from it, a winner this device takes that isn't it may have been proposed before the
   * other side heard of the removal, and sealed to the removed device: this device then begins
   * again, from that winner.
   */
  readonly begun?: string | undefined
}

export const isReplacing = (value: unknown): value is Replacing => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const r = value as Record<string, unknown>
  const heard = r['heard']
  return (
    isPairSecret(r['old']) &&
    typeof r['at'] === 'number' &&
    Number.isSafeInteger(r['at']) &&
    typeof r['by'] === 'string' &&
    isPeerId(r['by']) &&
    typeof r['sig'] === 'string' &&
    (r['heardAt'] === undefined || typeof r['heardAt'] === 'number') &&
    (r['settled'] === undefined || typeof r['settled'] === 'boolean') &&
    (r['resent'] === undefined ||
      (Array.isArray(r['resent']) &&
        r['resent'].every((id) => typeof id === 'string' && isPeerId(id)))) &&
    (heard === undefined ||
      (Array.isArray(heard) && heard.every((id) => typeof id === 'string' && isPeerId(id))))
  )
}

/** A secret kept from before, with no replacement under way: one to propose for. */
export const needsReplacing = (state: SecretState): boolean =>
  state.sealed !== true && state.replacing === undefined

/**
 * The secrets the other side may still be on while they haven't been seen with the new one,
 * newest first: the round's old secret, and the round before's too while that one wasn't seen
 * either. Nothing once they've been seen with the new.
 */
function behind(state: SecretState): readonly string[] {
  const { replacing, prior } = state
  if (replacing === undefined || replacing.heardAt !== undefined) return []
  return prior === undefined || prior.heardAt !== undefined
    ? [replacing.old]
    : [replacing.old, prior.old]
}

/**
 * The secret mail to the other side goes under: the oldest they may still be on, until they're
 * seen with the new.
 */
export const mailSecret = (state: SecretState): string => behind(state).at(-1) ?? state.secret

/** The secrets whose rooms to be in: the old ones' too until the other side is seen. */
export const roomSecrets = (state: SecretState): readonly string[] => [
  state.secret,
  ...behind(state),
]

/**
 * The secrets whose mail to look for: the old one's too, until it's let go, and while it isn't,
 * the round before's, where a device still in that round says so.
 */
export const fetchSecrets = (state: SecretState): readonly string[] => {
  const { replacing, prior } = state
  if (replacing === undefined || replacing.settled === true) return [state.secret]
  return prior === undefined
    ? [state.secret, replacing.old]
    : [state.secret, replacing.old, prior.old]
}

/**
 * Lets the old secret go once every device on the other side's list (`theirs`) has been seen
 * holding the new one: none of them can still be waiting under the old. Which proposal won is
 * kept, so a later one that beats it is still taken.
 */
export function settle(state: SecretState, theirs: readonly PeerId[]): SecretState | undefined {
  const { replacing } = state
  if (replacing?.heardAt === undefined || replacing.settled === true) return undefined
  const heard = new Set(replacing.heard ?? [])
  if (!theirs.every((device) => heard.has(device))) return undefined
  return { ...state, sealed: true, replacing: { ...replacing, settled: true } }
}

/**
 * Whether a proposal whose maker has since been removed should be made again: not once
 * settled, since the other side no longer looks under the old secret.
 */
export const proposerGone = (state: SecretState, counts: (device: PeerId) => boolean): boolean =>
  state.replacing !== undefined && state.replacing.settled !== true && !counts(state.replacing.by)

/**
 * The secret held before a change of winner, when it was itself a replacement: devices that
 * settled on it look for mail only under it, so the new winner is sent there too.
 */
export const heldBefore = (state: SecretState): string | undefined =>
  state.replacing === undefined || state.replacing.old === state.secret ? undefined : state.secret

/** A round's winning proposal, for `secret`, as it would be sent. */
async function asRekey(crypto: Crypto, round: Replacing, secret: string): Promise<Rekey> {
  return {
    replaces: await replacesId(crypto, round.old),
    secret,
    at: round.at,
    by: round.by,
    sig: round.sig,
  }
}

/** The proposal that wins so far, as it would be sent. */
export async function winner(crypto: Crypto, state: SecretState): Promise<Rekey | undefined> {
  const { replacing } = state
  return replacing === undefined ? undefined : asRekey(crypto, replacing, state.secret)
}

/**
 * The round before's winning proposal, as it would be sent with the winner: it shows a device
 * still in that round where this one began.
 */
export async function priorWinner(crypto: Crypto, state: SecretState): Promise<Rekey | undefined> {
  const { replacing, prior } = state
  return replacing === undefined || prior === undefined
    ? undefined
    : asRekey(crypto, prior, replacing.old)
}

/** A new proposal from this device in the round under way, signed by it, and the state it leaves. */
export async function propose(
  crypto: Crypto,
  signer: Signer,
  state: SecretState,
  secret: string,
  now: number,
): Promise<{ rekey: Rekey; next: SecretState }> {
  const old = state.replacing?.old ?? state.secret
  const rekey = await signRekey(signer, {
    replaces: await replacesId(crypto, old),
    secret,
    at: now,
  })
  const replacing = { old, at: now, by: signer.id, sig: rekey.sig }
  return { rekey, next: { ...state, secret, sealed: true, replacing } }
}

/**
 * A new round from this device, for the secret held now, and the state it leaves: after a
 * removal, when the round under way, if any, may have been won by a secret the removed device
 * was sealed. A proposal in that round would lose to its earlier winner. The round under way
 * becomes the prior one.
 */
export async function begin(
  crypto: Crypto,
  signer: Signer,
  state: SecretState,
  secret: string,
  now: number,
): Promise<{ rekey: Rekey; next: SecretState }> {
  const rekey = await signRekey(signer, {
    replaces: await replacesId(crypto, state.secret),
    secret,
    at: now,
  })
  const replacing = { old: state.secret, at: now, by: signer.id, sig: rekey.sig }
  return {
    rekey,
    next: {
      secret,
      sealed: true,
      replacing,
      ...(state.replacing === undefined ? {} : { prior: state.replacing }),
      begun: secret,
    },
  }
}

/** The other side's `device` was seen holding the winner. */
export function heardFrom(
  state: SecretState,
  device: PeerId,
  now: number,
): SecretState | undefined {
  const { replacing } = state
  if (replacing === undefined) return undefined
  const heard = replacing.heard ?? []
  if (heard.includes(device) && replacing.heardAt !== undefined) return undefined
  return {
    ...state,
    replacing: {
      ...replacing,
      heardAt: replacing.heardAt ?? now,
      heard: heard.includes(device) ? heard : [...heard, device],
    },
  }
}

/** Where a proposal came from. */
export interface Sender {
  /** The other side (the friend, or another of your devices for the self secret), or a copy. */
  readonly other: boolean
  /** The device that sent the letter. */
  readonly device: PeerId
}

/** What a proposal that arrived means here; see `consider`. */
export interface Step {
  /** The state to keep, if it changes. */
  readonly next?: SecretState
  /** The winner goes back to the side it came from, since theirs lost or is behind. */
  readonly answer: boolean
  /** The winner changed here, and goes to both sides. */
  readonly changed: boolean
  /** More secrets whose tags the answer goes under: where the device that sent it looks. */
  readonly under?: readonly string[]
}

/**
 * What a proposal that arrived means here. `next` is the state to keep, if it changes. With
 * `answer`, the winner goes back to whoever sent it, since theirs lost; with `changed`, the
 * winner changed here and goes to both sides, so every device that holds the old secret hears
 * it. `counts` says whether a proposing device still counts: one taken off its side's list
 * since never wins, so a removed device can't choose where the two sides go.
 *
 * A proposal is for the round under way when it names that round's old secret. One that names
 * the secret held now begins a new round, after a removal elsewhere. One that comes with `prior`,
 * the winner of the round it began from, can take a device across a round it doesn't hold the
 * secret of: one still in that round, whatever it chose there, or one in a rival new round begun
 * from another of that round's proposals, where the earliest new round wins as in any round. One
 * for the round before this device's, with nothing to take it further, is from a device still
 * there, and is answered with where this device went.
 */
export async function consider(
  crypto: Crypto,
  state: SecretState,
  rekey: Rekey,
  sender: Sender,
  now: number,
  counts: (device: PeerId) => boolean,
  prior?: Rekey,
): Promise<Step> {
  const step = await considerAll(crypto, state, rekey, sender, now, counts, prior)
  const { begun } = state
  const next = step.next
  if (begun === undefined || next === undefined || next.secret === begun) return step
  // A round begun from the secret this device proposed after the removal: whoever proposed it
  // held that secret, sealed only to devices still on the lists.
  if (next.replacing?.old === begun) return { ...step, next: { ...next, begun: undefined } }
  // Any other winner may have been proposed before the removal was heard of: replaced again.
  return { ...step, next: { ...next, begun: undefined, renew: true } }
}

async function considerAll(
  crypto: Crypto,
  state: SecretState,
  rekey: Rekey,
  sender: Sender,
  now: number,
  counts: (device: PeerId) => boolean,
  prior?: Rekey,
): Promise<Step> {
  const nothing = { answer: false, changed: false }
  const { replacing } = state
  const old = replacing?.old ?? state.secret
  const keep = state.renew === true ? { renew: true } : {}
  // Seen moving onto it, when it came from the other side itself.
  const arrived = sender.other ? { heardAt: now, heard: [sender.device] } : {}
  const round = (from: string) => ({
    old: from,
    at: rekey.at,
    by: rekey.by,
    sig: rekey.sig,
    ...arrived,
  })

  if ((await replacesId(crypto, old)) === rekey.replaces) {
    // Nor one that "replaces" it with itself, which would leave the two sides where they were.
    if (rekey.secret === old) return nothing
    if (replacing === undefined && rekey.secret === state.secret) return nothing
    const current = await winner(crypto, state)
    const holds = current !== undefined && counts(current.by)
    if (current !== undefined && rekey.secret === current.secret) {
      if (!sender.other) return nothing
      const next = heardFrom(state, sender.device, now)
      return next === undefined ? nothing : { next, ...nothing }
    }
    // Theirs doesn't count, or loses: they're sent ours, with the logs that say why.
    if (!counts(rekey.by)) return { answer: holds, changed: false }
    if (holds && current !== undefined && !rekeyWins(rekey, current))
      return { answer: true, changed: false }
    // Theirs was seen moving already, once settled: the old rooms aren't gone back to.
    const heard = sender.other
      ? arrived
      : replacing?.settled === true
        ? { heardAt: replacing.heardAt, heard: [] }
        : {}
    return {
      next: {
        ...state,
        secret: rekey.secret,
        sealed: true,
        replacing: { ...round(old), ...heard },
      },
      answer: false,
      changed: true,
    }
  }

  // A new round, begun from the secret held here: the round under way becomes the prior one.
  if (replacing !== undefined && (await replacesId(crypto, state.secret)) === rekey.replaces) {
    if (!counts(rekey.by) || rekey.secret === state.secret || rekey.secret === old) return nothing
    return {
      next: {
        secret: rekey.secret,
        sealed: true,
        replacing: round(state.secret),
        prior: replacing,
        ...keep,
      },
      answer: false,
      changed: true,
    }
  }

  // A new round begun from `prior`, a proposal this device can check against its own rounds.
  if (
    prior !== undefined &&
    prior.secret !== rekey.secret &&
    (await replacesId(crypto, prior.secret)) === rekey.replaces &&
    (await verifyRekey(crypto, prior))
  ) {
    // From a proposal in the round under way here, whichever won it here.
    if (prior.replaces === (await replacesId(crypto, old)) && prior.secret !== old) {
      if (!counts(rekey.by)) return nothing
      const seen = replacing?.heardAt === undefined ? {} : { heardAt: replacing.heardAt }
      return {
        next: {
          secret: rekey.secret,
          sealed: true,
          replacing: round(prior.secret),
          prior: { old, at: prior.at, by: prior.by, sig: prior.sig, ...seen },
          ...keep,
        },
        answer: false,
        changed: true,
      }
    }
    // A rival to the round under way here, begun from another proposal in the round before.
    const before = state.prior
    if (
      replacing !== undefined &&
      before !== undefined &&
      prior.replaces === (await replacesId(crypto, before.old))
    ) {
      const current = (await winner(crypto, state)) as Rekey
      const holds = counts(current.by)
      if (!counts(rekey.by)) return { answer: holds, changed: false }
      if (holds && !rekeyWins(rekey, current)) return { answer: true, changed: false }
      return {
        next: {
          secret: rekey.secret,
          sealed: true,
          replacing: round(prior.secret),
          prior: { ...before, at: prior.at, by: prior.by, sig: prior.sig },
          ...keep,
        },
        answer: false,
        changed: true,
      }
    }
  }

  // From a device still in the round before: it's shown where this one went, under the tags of
  // the secret it holds.
  if (
    state.prior !== undefined &&
    (await replacesId(crypto, state.prior.old)) === rekey.replaces &&
    rekey.secret !== state.secret
  )
    return { answer: true, changed: false, under: [rekey.secret] }
  return nothing
}
