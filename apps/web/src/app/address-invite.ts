// An invite link opened in the address bar: read it once, then take it out of the address so a
// reload or a shared screenshot doesn't reuse it.
import { decodeDeviceLink, decodeInvite, type Invite } from '@pigeon/core'
import type { IncomingInvite } from '../apps/messenger/add-friend/add-friend.tsx'

/** A link an older Pigeon made, which can't be opened: shown so, rather than ignored. */
export interface OldCode {
  readonly old: true
}

/** A live invite's link (`#i/`), or a link through Lighthouses (`#a/`), kept whole. */
export function takeInviteFromAddress(): IncomingInvite | undefined {
  const hash = location.hash.slice(1)
  if (hash.startsWith('a/')) {
    history.replaceState(history.state, '', `${location.pathname}${location.search}`)
    return { link: hash }
  }
  return take('i/', decodeInvite)
}

/** A link from Link a Device on your other device, read the same way. */
export function takeDeviceLinkFromAddress(): Invite | OldCode | undefined {
  return take('l/', decodeDeviceLink)
}

function take(prefix: string, decode: typeof decodeInvite): Invite | OldCode | undefined {
  const hash = location.hash.slice(1)
  if (!hash.startsWith(prefix)) return undefined
  // The entry's state stays: the back stack marks entries there.
  history.replaceState(history.state, '', `${location.pathname}${location.search}`)
  const invite = decode(hash)
  if (invite.ok) return invite.value
  return invite.error === 'old' ? { old: true } : undefined
}
