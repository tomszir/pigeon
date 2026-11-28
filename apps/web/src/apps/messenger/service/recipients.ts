// Who a letter goes to: a friend's devices on their list, or your own other devices on yours,
// with the sealing keys known for them and the Lighthouses to leave it at.
import type { Json, LighthouseAddress, MailKind, PeerId } from '@pigeon/core'
import type { Devices } from './devices.ts'
import type { Recipient, RecipientList } from './mailbox.ts'
import { mailSecret } from './rekeys.ts'
import { isRemovalNotice } from './self-mail.ts'
import type { MailBook } from './stored.ts'

export interface RecipientsDeps {
  /** Your identity. */
  readonly self: PeerId
  /** This device. */
  readonly device: PeerId
  readonly devices: Devices
  readonly mailBook: (id: PeerId) => Promise<MailBook>
  /** Someone's devices on their list as kept: your own others, or a friend's. */
  readonly theirDevices: (id: PeerId) => readonly PeerId[]
  readonly isFriend: (id: PeerId) => boolean
  /** Whether this Pigeon may reach a Lighthouse now. */
  readonly mayReach: (address: LighthouseAddress) => boolean
  /** The Lighthouses on this device's list. */
  readonly lighthouses: () => readonly LighthouseAddress[]
  /** The Lighthouses a friend who never said theirs gets mail at: the official ones. */
  readonly official: readonly LighthouseAddress[]
}

export function createRecipients(deps: RecipientsDeps) {
  const { self, devices, mailBook } = deps

  /**
   * Who `id` is to mail: their pair secret, the sealing keys of their devices still on their
   * list, and their Lighthouses (the official ones, if they never said) that this Pigeon may
   * reach. Undefined when there's no secret, no key to seal to or no Lighthouse to leave it at.
   */
  async function recipient(id: PeerId, secret: string | undefined): Promise<Recipient | undefined> {
    if (secret === undefined) return undefined
    const book = await mailBook(id)
    const keys = Object.values(book.keys).filter(
      (key) => devices.classify(id, key.device) === 'friend',
    )
    if (keys.length === 0) return undefined
    const named = book.lighthouses.length > 0 ? book.lighthouses : deps.official
    // None this Pigeon may reach: their mail waits until you meet.
    const lighthouses = named.filter(deps.mayReach)
    if (lighthouses.length === 0) return undefined
    return { identity: id, secret, keys, lighthouses }
  }

  /**
   * Your own other devices to mail: the self secret (the old one while one is replaced, or
   * `under`), the sealing keys of your devices still on your list (or of `only` those devices),
   * and every Lighthouse on this device's list and the one your other devices last said.
   */
  async function selfRecipient(
    only?: readonly PeerId[],
    under?: string,
  ): Promise<Recipient | undefined> {
    const kept = devices.selfSecretState()
    const secret = under ?? (kept === undefined ? undefined : mailSecret(kept))
    if (secret === undefined) return undefined
    const book = await mailBook(self)
    const keys = Object.values(book.keys).filter(
      (key) =>
        key.device !== deps.device &&
        (only === undefined ? devices.isOwnOther(key.device) : only.includes(key.device)),
    )
    if (keys.length === 0) return undefined
    const all = [...deps.lighthouses(), ...book.lighthouses]
    const where = all.filter((address, i) => all.findIndex((o) => o.id === address.id) === i)
    return { identity: self, secret, keys, lighthouses: where }
  }

  /**
   * A letter's recipient's devices as their list stands now, and the keys known for them: your
   * other devices on your list, or a friend's on theirs. Nothing for
   * any other (an invite's answer, a farewell to someone no longer a friend), nor for a notice
   * to devices just taken off your list kept from before such notices were marked: those go as
   * they were sealed.
   */
  async function listNow(letter: {
    readonly kind: MailKind
    readonly to: Recipient
    readonly body: Json
  }): Promise<RecipientList | undefined> {
    const { to } = letter
    if (to.tags !== undefined) return undefined
    if (to.identity === self) {
      if (letter.kind === 'self' && isRemovalNotice(letter.body)) return undefined
      const book = await mailBook(self)
      const keys = Object.values(book.keys).filter((key) => devices.isOwnOther(key.device))
      return { devices: deps.theirDevices(self), keys }
    }
    if (!deps.isFriend(to.identity)) return undefined
    // Their list as kept, never the empty one of a friend whose log isn't loaded yet.
    await devices.loadFriend(to.identity)
    const book = await mailBook(to.identity)
    const keys = Object.values(book.keys).filter(
      (key) => devices.classify(to.identity, key.device) === 'friend',
    )
    return { devices: deps.theirDevices(to.identity), keys }
  }

  return { recipient, selfRecipient, listNow }
}
