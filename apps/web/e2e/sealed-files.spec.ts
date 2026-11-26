// Files sealed with a passphrase, in two isolated browsers under the site's Content Security
// Policy: Argon2id loads, compiles and runs in WebAssembly, a file one browser seals opens in
// the other, a file from before (PBKDF2) still opens, and a file asking for more than a file may
// is refused without a derivation.
import { argon2Sync } from 'node:crypto'
import { type BrowserContext, expect, type Page, test } from '@playwright/test'

const DATA = '{"friends":[]}'
// Sealed by 0.8.0 (PBKDF2-SHA256 at 600,000 rounds, version 1) with the passphrase "correct horse".
const V1_FILE =
  'pigeon-sealed:v1:600000:VatgPb3dXHCvQYQ3AI/A+Q==:1pvM9+gm+nN8ehAq:LK0HGLlBWbDdVu5vzEpnHwO8y8VSP5Hkv7RhIuCu'
// Sealed by this code in a browser, with the real Argon2id, and kept: a change to the format or
// the derivation shows here.
const V2_FILE =
  'pigeon-sealed:v2:65536:3:4:/j3Aq+1mm6RWtjFoI6//7Q==:MR5X9IDI8yMMV5fO:tB1wsotuRRWo8fs0a4PbDorMpkUm1mG3Xv5oK3Vw'
const HOSTILE_FILE =
  'pigeon-sealed:v2:4294967295:1:1:AAECAwQFBgcICQoLDA0ODw==:AAECAwQFBgcICQoL:AAECAwQFBgcICQoLDA0ODxAREhMUFRYX'

async function openSite(context: BrowserContext, refused: string[]): Promise<Page> {
  const page = await context.newPage()
  page.on('console', (message) => {
    if (message.text().includes('Content Security Policy')) refused.push(message.text())
  })
  await page.goto('/')
  return page
}

/** Seals in the page, as the Messenger does, and says how long Argon2id took there. */
async function seal(page: Page, passphrase: string): Promise<{ sealed: string; ms: number }> {
  return page.evaluate(
    async ([passphrase, data]) => {
      const crypto = '/src/platform/crypto/'
      const { createPassphraseSeal } = await import(/* @vite-ignore */ `${crypto}passphrase.ts`)
      const { createWasmArgon2id } = await import(/* @vite-ignore */ `${crypto}wasm-argon2id.ts`)
      const sealer = createPassphraseSeal({ argon2id: createWasmArgon2id() })
      const started = performance.now()
      const sealed: string = await sealer.seal(passphrase, new TextEncoder().encode(data))
      return { sealed, ms: performance.now() - started }
    },
    [passphrase, DATA] as const,
  )
}

/** The text a file opens to in the page, or undefined. */
async function open(page: Page, passphrase: string, file: string): Promise<string | undefined> {
  return page.evaluate(
    async ([passphrase, file]) => {
      const crypto = '/src/platform/crypto/'
      const { createPassphraseSeal } = await import(/* @vite-ignore */ `${crypto}passphrase.ts`)
      const { createWasmArgon2id } = await import(/* @vite-ignore */ `${crypto}wasm-argon2id.ts`)
      const sealer = createPassphraseSeal({ argon2id: createWasmArgon2id() })
      const opened: Uint8Array | undefined = await sealer.open(passphrase, file)
      return opened === undefined ? undefined : new TextDecoder().decode(opened)
    },
    [passphrase, file] as const,
  )
}

test('a file sealed in one browser opens in another, and one from before still opens', async ({
  browser,
}) => {
  const refused: string[] = []
  const contexts = [await browser.newContext(), await browser.newContext()]
  const [alice, bob] = await Promise.all(contexts.map((context) => openSite(context, refused)))
  if (alice === undefined || bob === undefined) throw new Error('no pages')

  const { sealed, ms } = await seal(alice, 'correct horse')
  test.info().annotations.push({ type: 'argon2id', description: `${Math.round(ms)} ms` })
  expect(sealed).toMatch(/^pigeon-sealed:v2:65536:3:4:/)
  expect(await open(bob, 'correct horse', `Pigeon data\n${sealed}\n`)).toBe(DATA)
  expect(await open(bob, 'wrong horse', sealed)).toBeUndefined()

  expect(await open(bob, 'correct horse', V1_FILE)).toBe(DATA)
  expect(await open(bob, 'correct horse', V2_FILE)).toBe(DATA)

  // The line is what protocol.md says: an independent Argon2id (OpenSSL's) and AES-GCM open it.
  const passphrase = 'p\u00e4ssword'
  const parts = (await seal(alice, passphrase)).sealed.split(':')
  expect(parts.slice(0, 5)).toEqual(['pigeon-sealed', 'v2', '65536', '3', '4'])
  const [salt, iv, body] = parts.slice(5).map((part) => Buffer.from(part, 'base64'))
  const key = argon2Sync('argon2id', {
    message: passphrase.normalize('NFC'),
    nonce: salt as Buffer,
    parallelism: 4,
    tagLength: 32,
    memory: 65536,
    passes: 3,
  })
  const aes = await crypto.subtle.importKey('raw', key, 'AES-GCM', false, ['decrypt'])
  const opened = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as Buffer },
    aes,
    body as Buffer,
  )
  expect(new TextDecoder().decode(opened)).toBe(DATA)

  // Four billion KiB would be refused by the file's reader before anything was allocated.
  const started = Date.now()
  expect(await open(bob, 'correct horse', HOSTILE_FILE)).toBeUndefined()
  expect(Date.now() - started).toBeLessThan(2000)

  expect(refused).toEqual([])
  await Promise.all(contexts.map((context) => context.close()))
})
