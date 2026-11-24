// Pairing by link or QR. The inviter shares `invite/<id>/<token>/<handle>`; whoever opens it
// joins the `invite:<token>` room, and the two swap signed pair-request and pair-accept
// envelopes there before moving to their pair room (docs/protocol.md, "Pairing").
import { base32Decode, base32Encode, utf8Decode, utf8Encode } from '../encoding/bytes.ts'
import { isPeerId, type PeerId } from '../identity/identity.ts'
import { MAX_HANDLE_LENGTH } from '../messages/envelope.ts'
import { err, ok, type Result } from '../result/result.ts'

/** Bytes of randomness in a token: 128 bits, 26 base32 characters. */
export const INVITE_TOKEN_BYTES = 16

export interface Invite {
  readonly id: PeerId
  readonly token: string
  readonly handle: string
}

export const inviteToken = (random: Uint8Array): string => base32Encode(random)

export const inviteRoom = (token: string): `invite:${string}` => `invite:${token}`

export const encodeInvite = (invite: Invite): string =>
  `invite/${invite.id}/${invite.token}/${base32Encode(utf8Encode(invite.handle))}`

export function decodeInvite(text: string): Result<Invite, 'malformed'> {
  const [tag, id, token, handle, ...rest] = text.trim().split('/')
  if (tag !== 'invite' || id === undefined || token === undefined || handle === undefined)
    return err('malformed')
  if (rest.length > 0 || !isPeerId(id)) return err('malformed')
  const tokenBytes = base32Decode(token)
  if (
    !tokenBytes.ok ||
    tokenBytes.value.length !== INVITE_TOKEN_BYTES ||
    token !== token.toLowerCase()
  )
    return err('malformed')
  const handleBytes = base32Decode(handle)
  if (!handleBytes.ok) return err('malformed')
  const name = utf8Decode(handleBytes.value)
  if (!name.ok || name.value.trim() === '' || name.value.length > MAX_HANDLE_LENGTH)
    return err('malformed')
  return ok({ id, token, handle: name.value })
}
