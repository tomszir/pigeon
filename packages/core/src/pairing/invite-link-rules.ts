// What whoever opens an invite link asks of it, beyond each card's own checks. Every device on the
// inviter's list holds the link's secret, and so does one taken off it, which can still write
// cards on the list from before. What none of them can change is the link people were given: it
// names the device that made it and when it ends. So only that device's cards count, an open card
// may not outlast the link, nobody asks through a link once it has ended, and a link may not say
// it lasts longer than a link can.
import type { Crypto } from '../identity/crypto.ts'
import {
  type InviteCard,
  type InviteLink,
  linkNames,
  MAX_INVITE_LINK_LIFETIME,
  newestCard,
} from './mailed-invite.ts'

/** How far apart the maker's clock and the opener's may be, for a link's end that looks too far. */
export const INVITE_LINK_CLOCK_SLACK: number = 24 * 60 * 60 * 1000

/**
 * A link that says it ends further off than any link lasts, and a day for clocks that disagree:
 * refused, opened or asked through. One made to end later opens only in its last week and a day.
 */
export const inviteLinkTooLong = (link: InviteLink, now: number): boolean =>
  link.end > now + MAX_INVITE_LINK_LIFETIME + INVITE_LINK_CLOCK_SLACK

/** A link on or after its end: nobody opens it or asks through it. */
export const inviteLinkEnded = (link: InviteLink, now: number): boolean => now >= link.end

/**
 * Whether a card that holds may be chosen for `link`: it is signed by the device the link names,
 * and if it's open, it lasts no longer than the link.
 */
export async function cardFitsLink(
  crypto: Crypto,
  link: InviteLink,
  card: InviteCard,
): Promise<boolean> {
  if (!(await linkNames(crypto, link.maker, card.from))) return false
  return !card.open || card.expires <= link.end
}

/** Of the cards that hold and fit `link`, the newest, as `newestCard` chooses. */
export async function chooseLinkCard(
  crypto: Crypto,
  link: InviteLink,
  cards: readonly InviteCard[],
): Promise<InviteCard | undefined> {
  const fits: InviteCard[] = []
  for (const card of cards) if (await cardFitsLink(crypto, link, card)) fits.push(card)
  return newestCard(fits)
}
