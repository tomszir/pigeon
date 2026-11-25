// Sealing with a passphrase, for files you keep yourself: the export of your data (M13), and the
// recovery key's file (decision 0027). PBKDF2-SHA256 at 600,000 rounds stretches the passphrase
// into an AES-256-GCM key, all WebCrypto. The sealed text is one line, so it can sit in a .txt.

const PREFIX = 'pigeon-sealed:v1'
export const PASSPHRASE_ROUNDS = 600_000

type Bytes = Uint8Array<ArrayBuffer>

function toBase64(bytes: Uint8Array): string {
  // In slices: spreading a large export into one call overflows the stack.
  let text = ''
  for (let at = 0; at < bytes.length; at += 0x8000)
    text += String.fromCharCode(...bytes.subarray(at, at + 0x8000))
  return btoa(text)
}
function fromBase64(text: string): Bytes | undefined {
  try {
    return Uint8Array.from(atob(text), (char) => char.charCodeAt(0))
  } catch {
    return undefined
  }
}

async function keyFor(subtle: SubtleCrypto, passphrase: string, salt: Bytes, rounds: number) {
  const base = await subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase.normalize('NFC')),
    'PBKDF2',
    false,
    ['deriveKey'],
  )
  return subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: rounds },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

/** "pigeon-sealed:v1:<rounds>:<salt>:<iv>:<sealed>", base64. */
export async function sealWithPassphrase(
  passphrase: string,
  data: Uint8Array,
  rounds = PASSPHRASE_ROUNDS,
  subtle = crypto.subtle,
): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await keyFor(subtle, passphrase, salt, rounds)
  const sealed = new Uint8Array(
    await subtle.encrypt({ name: 'AES-GCM', iv }, key, new Uint8Array(data)),
  )
  return [PREFIX, rounds, toBase64(salt), toBase64(iv), toBase64(sealed)].join(':')
}

/** The data, or undefined for a wrong passphrase or text that isn't sealed by Pigeon. */
export async function openWithPassphrase(
  passphrase: string,
  text: string,
  subtle = crypto.subtle,
): Promise<Uint8Array | undefined> {
  const line = text
    .split(/\r?\n/)
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${PREFIX}:`))
  if (line === undefined) return undefined
  const [, , rounds, salt, iv, sealed] = line.split(':')
  const count = Number(rounds)
  const saltBytes = fromBase64(salt ?? '')
  const ivBytes = fromBase64(iv ?? '')
  const sealedBytes = fromBase64(sealed ?? '')
  if (!Number.isSafeInteger(count) || count < 1 || count > 10_000_000) return undefined
  if (saltBytes === undefined || ivBytes === undefined || sealedBytes === undefined)
    return undefined
  try {
    const key = await keyFor(subtle, passphrase, saltBytes, count)
    return new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: ivBytes }, key, sealedBytes))
  } catch {
    return undefined
  }
}
