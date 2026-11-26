// A live code's answer, sealed: the pair secret an inviter hands over, or everything a new
// device is given. It's a `mail:pair` or `mail:link` letter sealed with sealMail to the sealing
// key the other side sent in its request, signed by the device that ran the handshake, and it
// names the run's session, so it counts only on the connection it was made for. It travels over
// that connection, never through a Lighthouse.
import { base32Encode, base64Decode } from '../encoding/bytes.ts'
import type { Json } from '../encoding/canonical.ts'
import type { Crypto, Signer } from '../identity/crypto.ts'
import type { PeerId } from '../identity/identity.ts'
import { openMail, type SealError, type SealingKey, sealMail, utcDate } from '../mail/mail.ts'
import type { SealCrypto, Sealer } from '../mail/seal-crypto.ts'
import { err, ok, type Result } from '../result/result.ts'
import type { Proven } from './handshake.ts'

const DAY = 24 * 60 * 60 * 1000

export interface AnswerTo {
  readonly kind: 'pair' | 'link'
  /** The identity the sealing side speaks for. */
  readonly sender: PeerId
  /** The identity the answer is for: the invitee's, or, for a new device, the one it joins. */
  readonly to: PeerId
  readonly at: number
  readonly run: Proven
}

/**
 * True when `sealing` is a key mail can be sealed to. A key's shape and signature can hold while
 * it still isn't a point on the curve, which only trying shows; checked before anything is shown
 * or signed, so a request that could never be answered isn't.
 */
export async function canSealTo(seal: SealCrypto, sealing: SealingKey): Promise<boolean> {
  const key = base64Decode(sealing.key)
  if (!key.ok) return false
  try {
    await seal.ephemeralShare(key.value)
    return true
  } catch {
    return false
  }
}

/** Seals `value` to `sealing`, the key of the run's other device. */
export async function sealAnswer(
  seal: SealCrypto,
  signer: Signer,
  answer: AnswerTo,
  sealing: SealingKey,
  value: Json,
): Promise<Result<string, SealError>> {
  const sealed = await sealMail(
    seal,
    signer,
    {
      kind: answer.kind,
      sender: answer.sender,
      to: answer.to,
      date: utcDate(answer.at),
      id: base32Encode(seal.random(16)),
      // Who may write for the sender was settled in the offer, by the run's device.
      head: { epoch: 0, seq: 0 },
      at: answer.at,
      body: { session: answer.run.session, value },
    },
    [sealing],
  )
  if (!sealed.ok) return sealed
  return sealed.value.skipped.length > 0 ? err('no-devices') : ok(sealed.value.blob)
}

/** Opens an answer sealed to this device on `answer.run`: its value, or undefined. */
export async function openAnswer(
  crypto: Crypto,
  seal: SealCrypto,
  sealer: Sealer,
  blob: string,
  answer: AnswerTo,
): Promise<Json | undefined> {
  const opened = await openMail(crypto, seal, sealer, blob, {
    to: answer.to,
    kinds: [answer.kind],
    // Both clocks may be a little out around midnight.
    dates: [utcDate(answer.at - DAY), utcDate(answer.at), utcDate(answer.at + DAY)],
  })
  if (!opened.ok) return undefined
  const { letter } = opened.value
  if (letter.from !== answer.run.device || letter.sender !== answer.sender) return undefined
  const body = letter.body as Record<string, Json> | null
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return undefined
  if (body['session'] !== answer.run.session || !('value' in body)) return undefined
  return body['value'] ?? null
}
