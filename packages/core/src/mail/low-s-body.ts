// A letter body this device kept to send, read as kept data is: every signature in it that a
// Pigeon from before low-S signatures may have spelled high-S, spelled low-S. The outbox puts
// the same body again for days, so without this a body queued before the change would be
// refused for good by Pigeons that take only low-S.
import { isLogEntry, lowSEntry } from '../chat/chat-log.ts'
import { isDeviceLog, lowSDeviceLog } from '../devices/device-log.ts'
import { base32DecodeExact, base32Encode } from '../encoding/bytes.ts'
import type { Json } from '../encoding/canonical.ts'
import { canonicalSignature } from '../identity/signature.ts'
import { isSealingKey } from './mail.ts'

/**
 * `body` with the device logs, chat entries and sealing-key bindings in it spelled low-S. Only
 * for a body this device kept: it changes spellings, never what was signed.
 */
export function lowSBody(body: Json): Json {
  if (Array.isArray(body)) return body.map(lowSBody)
  if (typeof body !== 'object' || body === null) return body
  if (isDeviceLog(body)) return lowSDeviceLog(body) as unknown as Json
  if (isLogEntry(body)) return lowSEntry(body) as unknown as Json
  if (isSealingKey(body)) {
    const lowS = (sig: string) => {
      const signature = base32DecodeExact(sig)
      if (!signature.ok) return sig
      const canonical = canonicalSignature(body.device, signature.value)
      return canonical === signature.value ? sig : base32Encode(canonical)
    }
    const sig = lowS(body.sig)
    const hpke = body.hpke === undefined ? undefined : lowS(body.hpke)
    if (sig === body.sig && hpke === body.hpke) return body
    return { ...body, sig, ...(hpke === undefined ? {} : { hpke }) }
  }
  return Object.fromEntries(Object.entries(body).map(([key, value]) => [key, lowSBody(value)]))
}
