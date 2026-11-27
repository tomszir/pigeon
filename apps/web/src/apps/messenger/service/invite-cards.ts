// Reading an invite link's cards at the Lighthouses, for whoever opens the link, and choosing the
// one to show and ask through.
//
// Anyone holding a link can put blobs under its card tag, enough to bury the card among them, so
// the tag's claimed cards are read first: only the inviter's devices can add to those.
import {
  type Crypto,
  chooseLinkCard,
  type DeviceLog,
  type InviteCard,
  type InviteLink,
  inviteCardTag,
  type LighthouseAddress,
  type LighthouseClient,
  openInviteCard,
  type PeerId,
  type SealCrypto,
} from '@pigeon/core'

/** Items under a card tag read when a link is opened, and cards got of them, newest first. */
const MAX_CARD_ITEMS = 500
const MAX_CARD_GETS = 100
/**
 * The same for the tag's claimed cards, which only the inviter's devices can put: the card as it
 * is now, and the one it replaces until that's dropped.
 */
const MAX_CLAIMED_ITEMS = 256
const MAX_CLAIMED_GETS = 16
/** A card bigger than this is junk: a real one is a few kilobytes. */
const MAX_CARD_BYTES = 32 * 1024

export interface InviteCardsDeps {
  readonly crypto: Crypto
  readonly seal: SealCrypto
  readonly client: (address: LighthouseAddress) => LighthouseClient
  /** The official Lighthouses: where every link is looked up, besides the one it names. */
  readonly official: readonly LighthouseAddress[]
  readonly knownLog: (id: PeerId) => Promise<DeviceLog | undefined>
}

/** Where a link's cards are read: the official Lighthouses, and the one the link names. */
function linkLighthouses(
  official: readonly LighthouseAddress[],
  link: InviteLink,
): LighthouseAddress[] {
  const all = [...official, ...(link.lighthouse === undefined ? [] : [link.lighthouse])]
  return all.filter((address, i) => all.findIndex((other) => other.id === address.id) === i)
}

/**
 * Every card for `link` that holds, at each Lighthouse it's read at: the tag's claimed cards first,
 * then everything under the tag, as far as the limits go (a Lighthouse from before claims, or a
 * card put before its link was claimed).
 */
async function readLinkCards(deps: InviteCardsDeps, link: InviteLink): Promise<InviteCard[]> {
  const { crypto, seal } = deps
  const tag = await inviteCardTag(crypto, link.secret)
  const cards: InviteCard[] = []
  for (const lighthouse of linkLighthouses(deps.official, link)) {
    const client = deps.client(lighthouse)
    const seen = new Set<string>()
    for (const [type, maxItems, maxGets] of [
      ['list-claimed', MAX_CLAIMED_ITEMS, MAX_CLAIMED_GETS],
      ['list', MAX_CARD_ITEMS, MAX_CARD_GETS],
    ] as const) {
      const items: { id: string; size: number }[] = []
      for (let cursor = 0, more = true; more && items.length < maxItems; ) {
        const listed = await client.request({ type, tags: [tag], cursor })
        if (!listed.ok || listed.value.type !== 'listed') break
        items.push(...listed.value.items)
        cursor = listed.value.cursor
        more = listed.value.more
      }
      // Newest first: a card put again, or closed, comes after anything put to hide it.
      const worth = items
        .filter((item) => item.size <= MAX_CARD_BYTES && !seen.has(item.id))
        .reverse()
      for (const item of worth.slice(0, maxGets)) {
        seen.add(item.id)
        const got = await client.request({ type: 'get', id: item.id })
        if (!got.ok || got.value.type !== 'blob') continue
        const opened = await openInviteCard(crypto, seal, link, got.value.blob)
        if (!opened.ok) continue
        // Checked again against the log you keep for them, if you know them.
        const known = await deps.knownLog(opened.value.identity)
        const checked =
          known === undefined
            ? opened
            : await openInviteCard(crypto, seal, link, got.value.blob, known)
        if (checked.ok) cards.push(checked.value)
      }
    }
  }
  return cards
}

/**
 * The card to show for `link`: of those that hold, only the device the link names counts, an open
 * card of its may not outlast the link, and the newest log wins, a closed card over an open one on
 * the same log.
 */
export async function linkCard(
  deps: InviteCardsDeps,
  link: InviteLink,
): Promise<InviteCard | undefined> {
  return chooseLinkCard(deps.crypto, link, await readLinkCards(deps, link))
}
