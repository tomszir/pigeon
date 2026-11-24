// An invite link opened in the address bar: read it once, then take it out of the address so a
// reload or a shared screenshot doesn't reuse it.
import { decodeInvite, type Invite } from '@pigeon/core'

export function takeInviteFromAddress(): Invite | undefined {
  const hash = location.hash.slice(1)
  if (!hash.startsWith('i/')) return undefined
  history.replaceState(null, '', `${location.pathname}${location.search}`)
  const invite = decodeInvite(hash)
  return invite.ok ? invite.value : undefined
}
