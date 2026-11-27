// The outbox as this device keeps it: every letter it sent that still waits for receipts, with
// all that's needed to put it again. A letter goes in before its first put, so one whose tab
// closed first is still there at the next start. It's changed one change at a time, each on what
// is stored then, apart from the mailbox's puts and fetches: a letter goes in as soon as it's
// sent, even while a fetch is under way, and a resend's puts, which take a while, never write
// back an outbox read before them.
import {
  isLighthouseAddress,
  isSealingKey,
  type Json,
  type LighthouseAddress,
  type MailKind,
  type PeerId,
  type SealingKey,
} from '@pigeon/core'
import type { Store } from '../../../platform/storage/storage.ts'

/**
 * Which tags a secret makes: a mailbox's (the pair or self secret's, for the recipient and day),
 * an invite's requests (from its secret), or one request's answers (from its reply secret).
 */
export type TagScheme = 'mail' | 'invite-ask' | 'invite-answer'

/** Someone to send to: where their mail goes and what it's sealed to. */
export interface Recipient {
  readonly identity: PeerId
  /** The secret their tags come from, base32: the pair or self secret unless `tags` says. */
  readonly secret: string
  readonly tags?: TagScheme | undefined
  readonly keys: readonly SealingKey[]
  readonly lighthouses: readonly LighthouseAddress[]
}

/** A letter still waiting for receipts: everything needed to put it again. */
export interface Outgoing {
  readonly id: string
  readonly kind: MailKind
  readonly body: Json
  readonly to: Recipient
  /** The devices whose receipt hasn't come yet. */
  readonly waiting: readonly PeerId[]
  readonly sentAt: number
  /** When a Lighthouse last took it; 0 while none has, so the next mail check tries again. */
  readonly putAt: number
  /**
   * Sealed to exactly the devices in `to` each time, whatever their list says: for devices just
   * taken off your list, told so.
   */
  readonly fixed?: boolean | undefined
  /** For the devices in `to` alone, while they stay on their list: none is added. */
  readonly pinned?: boolean | undefined
}

const isRecipient = (value: unknown): value is Recipient => {
  if (typeof value !== 'object' || value === null) return false
  const r = value as Recipient
  return (
    typeof r.identity === 'string' &&
    typeof r.secret === 'string' &&
    Array.isArray(r.keys) &&
    r.keys.every(isSealingKey) &&
    Array.isArray(r.lighthouses) &&
    r.lighthouses.every(isLighthouseAddress)
  )
}

const isOutgoing = (value: unknown): value is Outgoing =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as Outgoing).id === 'string' &&
  isRecipient((value as Outgoing).to) &&
  Array.isArray((value as Outgoing).waiting) &&
  ((value as Outgoing).fixed === undefined || typeof (value as Outgoing).fixed === 'boolean') &&
  ((value as Outgoing).pinned === undefined || typeof (value as Outgoing).pinned === 'boolean')

/** One letter in the outbox, as a receipt names it: whose, and its id. */
export const letterKey = (letter: { readonly id: string; readonly to: Recipient }) =>
  `${letter.to.identity} ${letter.id}`

/**
 * The outbox in `store` under `key`; nothing is written once `stopped` says the Messenger has
 * closed.
 */
export function createOutbox(store: Store, key: string, stopped: () => boolean) {
  async function read(): Promise<Outgoing[]> {
    const stored = await store.get(key)
    return Array.isArray(stored) ? stored.filter(isOutgoing) : []
  }
  let changing: Promise<unknown> = Promise.resolve()
  /**
   * Writes what `make` makes of the outbox as it's stored now. True once written; false when the
   * Messenger has closed, and it rejects when the store does.
   */
  function change(make: (letters: Outgoing[]) => Outgoing[]): Promise<boolean> {
    const run = async () => {
      if (stopped()) return false
      const next = make(await read())
      if (stopped()) return false
      await store.set(key, next)
      return true
    }
    const next = changing.then(run, run)
    changing = next.catch(() => undefined)
    return next
  }
  return {
    read,
    change,
    /**
     * Keeps only the letters `keep` says, and writes each change over the letter it was made
     * from: `after`, what it became (put, or sealed to another list), or nothing for a letter
     * dropped. A receipt that came while it was being put still counts: a device that was
     * waited on in `before` and isn't in the stored letter any more has given it.
     */
    update(
      changes: readonly { readonly before: Outgoing; readonly after: Outgoing | undefined }[],
      keep: (letter: Outgoing) => boolean,
    ) {
      const byKey = new Map(changes.map((one) => [letterKey(one.before), one]))
      return change((letters) =>
        letters.filter(keep).flatMap((letter) => {
          const one = byKey.get(letterKey(letter))
          if (one === undefined) return [letter]
          if (one.after === undefined) return []
          const receipted = one.before.waiting.filter((device) => !letter.waiting.includes(device))
          const waiting = one.after.waiting.filter((device) => !receipted.includes(device))
          return waiting.length === 0 ? [] : [{ ...one.after, waiting }]
        }),
      )
    },
  }
}
