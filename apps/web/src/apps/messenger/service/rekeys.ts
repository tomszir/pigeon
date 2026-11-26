// Replacing a pair or self secret from before this Pigeon sealed every secret it handed over.
// One kept from then may be known to whoever watched the pairing or linking it came from, so a
// new one is sent sealed to the devices that hold it, and both sides move to the new one's rooms.
// This file holds the decisions, which are the same for a friend and for your own devices; the
// Messenger does the sending, the rooms and the storage.
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
}

/** A secret as a device keeps it. */
export interface SecretState {
  /** The secret in use: the new one, once there's a proposal. */
  readonly secret: string
  /** Made or received sealed, by this Pigeon: nothing to replace. */
  readonly sealed?: boolean | undefined
  readonly replacing?: Replacing | undefined
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
    (heard === undefined ||
      (Array.isArray(heard) && heard.every((id) => typeof id === 'string' && isPeerId(id))))
  )
}

/** A secret kept from before, with no replacement under way: one to propose for. */
export const needsReplacing = (state: SecretState): boolean =>
  state.sealed !== true && state.replacing === undefined

/** The secret mail to the other side goes under: the old one until they're seen with the new. */
export const mailSecret = (state: SecretState): string =>
  state.replacing !== undefined && state.replacing.heardAt === undefined
    ? state.replacing.old
    : state.secret

/** The secrets whose rooms to be in: the old one's too until the other side is seen. */
export const roomSecrets = (state: SecretState): readonly string[] =>
  state.replacing !== undefined && state.replacing.heardAt === undefined
    ? [state.secret, state.replacing.old]
    : [state.secret]

/** The secrets whose mail to look for: the old one's too, until it's let go. */
export const fetchSecrets = (state: SecretState): readonly string[] =>
  state.replacing === undefined || state.replacing.settled === true
    ? [state.secret]
    : [state.secret, state.replacing.old]

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
  return { secret: state.secret, sealed: true, replacing: { ...replacing, settled: true } }
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

/** The proposal that wins so far, as it would be sent. */
export async function winner(crypto: Crypto, state: SecretState): Promise<Rekey | undefined> {
  const { replacing } = state
  if (replacing === undefined) return undefined
  return {
    replaces: await replacesId(crypto, replacing.old),
    secret: state.secret,
    at: replacing.at,
    by: replacing.by,
    sig: replacing.sig,
  }
}

/** A new proposal from this device, signed by it, and the state it leaves. */
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
  return { rekey, next: { secret, sealed: true, replacing } }
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

/**
 * What a proposal that arrived means here. `next` is the state to keep, if it changes. With
 * `answer`, the winner goes back to whoever sent it, since theirs lost; with `changed`, the
 * winner changed here and goes to both sides, so every device that holds the old secret hears
 * it. `counts` says whether a proposing device still counts: one taken off its side's list
 * since never wins, so a removed device can't choose where the two sides go.
 */
export async function consider(
  crypto: Crypto,
  state: SecretState,
  rekey: Rekey,
  sender: Sender,
  now: number,
  counts: (device: PeerId) => boolean,
): Promise<{ next?: SecretState; answer: boolean; changed: boolean }> {
  const nothing = { answer: false, changed: false }
  const old = state.replacing?.old ?? state.secret
  // Only proposals for the secret being replaced count; any other is from some other time.
  if ((await replacesId(crypto, old)) !== rekey.replaces) return nothing
  // Nor one that "replaces" it with itself, which would leave the two sides where they were.
  if (rekey.secret === old) return nothing
  if (state.replacing === undefined && rekey.secret === state.secret) return nothing
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
    ? { heardAt: now, heard: [sender.device] }
    : state.replacing?.settled === true
      ? { heardAt: state.replacing.heardAt, heard: [] }
      : {}
  return {
    next: {
      secret: rekey.secret,
      sealed: true,
      replacing: { old, at: rekey.at, by: rekey.by, sig: rekey.sig, ...heard },
    },
    answer: false,
    changed: true,
  }
}
