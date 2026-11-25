import { mkdtemp, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createNodeCrypto, loadSigner } from './node-crypto.ts'

describe('the Lighthouse key', () => {
  it('is made once, kept private, and signs as the same Lighthouse after a restart', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lighthouse-key-'))
    const path = join(dir, 'lighthouse.key')
    const first = await loadSigner(path)
    expect((await stat(path)).mode & 0o777).toBe(0o600)
    const again = await loadSigner(path)
    expect(again.id).toBe(first.id)
    expect(await readFile(path, 'utf8')).not.toContain(first.id)

    const crypto = createNodeCrypto()
    const data = new TextEncoder().encode('hello')
    const signature = await again.sign(data)
    expect(await crypto.verify(first.id, signature, data)).toBe(true)
    expect(await crypto.verify(first.id, signature, new TextEncoder().encode('other'))).toBe(false)
  })
})
