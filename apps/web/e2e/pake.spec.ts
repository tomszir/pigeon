// The key exchange pairing builds on, in two isolated browsers under the site's Content Security
// Policy: the WebAssembly loads, compiles and runs, and both sides agree on a key, passing each
// other's messages as the network would.
import { type BrowserContext, expect, type Page, test } from '@playwright/test'

/** Starts one side in `page` and returns its message. The start waits in the page for finish. */
async function start(page: Page, role: 'a' | 'b', password: string): Promise<number[]> {
  return page.evaluate(
    async ([role, password]) => {
      const path = '/src/platform/crypto/wasm-pake.ts'
      const { createWasmPake } = await import(/* @vite-ignore */ path)
      const bytes = (text: string) => new TextEncoder().encode(text)
      const started = await createWasmPake().start(role, bytes(password), bytes('A'), bytes('B'))
      ;(globalThis as unknown as Record<string, unknown>)['pakeStart'] = started
      return Array.from(started.message as Uint8Array)
    },
    [role, password] as const,
  )
}

async function finish(page: Page, peer: number[]): Promise<number[] | undefined> {
  return page.evaluate(async (peer) => {
    const started = (globalThis as unknown as Record<string, unknown>)['pakeStart'] as {
      finish(peer: Uint8Array): Promise<Uint8Array | undefined>
    }
    const key = await started.finish(new Uint8Array(peer))
    return key === undefined ? undefined : Array.from(key)
  }, peer)
}

async function openSite(context: BrowserContext, refused: string[]): Promise<Page> {
  const page = await context.newPage()
  page.on('console', (message) => {
    if (message.text().includes('Content Security Policy')) refused.push(message.text())
  })
  await page.goto('/')
  return page
}

test('two browsers agree on a key over SPAKE2, and a wrong password does not', async ({
  browser,
}) => {
  const refused: string[] = []
  const contexts = [await browser.newContext(), await browser.newContext()]
  const [alice, bob] = await Promise.all(contexts.map((context) => openSite(context, refused)))
  if (alice === undefined || bob === undefined) throw new Error('no pages')

  const [fromAlice, fromBob] = [await start(alice, 'a', 'pw'), await start(bob, 'b', 'pw')]
  const [aliceKey, bobKey] = [await finish(alice, fromBob), await finish(bob, fromAlice)]
  expect(aliceKey).toHaveLength(32)
  expect(aliceKey).toEqual(bobKey)

  const [again, wrong] = [await start(alice, 'a', 'pw'), await start(bob, 'b', 'pW')]
  expect(await finish(alice, wrong)).not.toEqual(await finish(bob, again))

  expect(refused).toEqual([])
  await Promise.all(contexts.map((context) => context.close()))
})
