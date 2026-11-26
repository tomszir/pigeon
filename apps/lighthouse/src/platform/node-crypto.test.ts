import { webcrypto } from 'node:crypto'
import { mkdtemp, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isCanonicalSignature, peerIdFromPublicKey } from '@pigeon/core'
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

describe('checking a signature', () => {
  it('refuses the high-S spelling of a P-256 signature and takes the low-S one', async () => {
    const subtle = webcrypto.subtle
    const pair = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, [
      'sign',
      'verify',
    ])
    const id = peerIdFromPublicKey(new Uint8Array(await subtle.exportKey('raw', pair.publicKey)))
    const data = new TextEncoder().encode('hello')
    const crypto = createNodeCrypto()
    const seen = new Set<boolean>()
    // WebCrypto gives either spelling, about half each.
    for (let tries = 0; tries < 64 && seen.size < 2; tries += 1) {
      const signature = new Uint8Array(
        await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, data),
      )
      const low = isCanonicalSignature(id, signature)
      seen.add(low)
      expect(await crypto.verify(id, signature, data)).toBe(low)
    }
    expect(seen.size).toBe(2)
  })
})
