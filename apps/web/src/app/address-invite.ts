// An invite link opened in the address bar: read it once, then take it out of the address so a
// reload or a shared screenshot doesn't reuse it.
import { decodeDeviceLink, decodeInvite, type Invite } from '@pigeon/core'

export function takeInviteFromAddress(): Invite | undefined {
  return take('i/', decodeInvite)
}

/** A link from Link a Device on your other device, read the same way. */
export function takeDeviceLinkFromAddress(): Invite | undefined {
  return take('l/', decodeDeviceLink)
}

function take(prefix: string, decode: typeof decodeInvite): Invite | undefined {
  const hash = location.hash.slice(1)
  if (!hash.startsWith(prefix)) return undefined
  // The entry's state stays: the back stack marks entries there.
  history.replaceState(history.state, '', `${location.pathname}${location.search}`)
  const invite = decode(hash)
  return invite.ok ? invite.value : undefined
}
