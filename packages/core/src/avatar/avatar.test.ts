import { describe, expect, it } from 'vitest'
import type { PeerId } from '../identity/identity.ts'
import { fakeCrypto } from '../testing/testing.ts'
import {
  ACCESSORIES,
  AVATAR_SIZE,
  avatarFor,
  avatarSvg,
  avatarTraits,
  describeAvatar,
  drawAvatar,
  PLUMAGES,
  TILES,
} from './avatar.ts'

const digest = (seed: number) =>
  Uint8Array.from({ length: 32 }, (_, i) => (seed * 31 + i * 17) % 256)
const isHex = (colour: string | undefined) => colour !== undefined && /^#[0-9a-f]{6}$/.test(colour)

describe('avatarTraits', () => {
  it('reads the same traits from the same digest', () => {
    expect(avatarTraits(digest(7))).toEqual(avatarTraits(digest(7)))
  })

  it('reaches every plumage, tile and accessory across digests', () => {
    const seen = { plumage: new Set(), tile: new Set(), accessory: new Set() }
    for (let seed = 0; seed < 2000; seed++) {
      const traits = avatarTraits(
        Uint8Array.from(
          { length: 32 },
          (_, i) => ((seed * (i + 7) * 2654435761) >>> (i % 24)) & 255,
        ),
      )
      seen.plumage.add(traits.plumage)
      seen.tile.add(traits.tile)
      seen.accessory.add(traits.accessory)
    }
    expect(seen.plumage.size).toBe(PLUMAGES.length)
    expect(seen.tile.size).toBe(TILES.length)
    expect(seen.accessory.size).toBe(ACCESSORIES.length)
  })
})

describe('avatarFor', () => {
  it('gives an id the same bird every time and another id another bird', async () => {
    const crypto = fakeCrypto
    const mika = await avatarFor(crypto, 'MIKA' as PeerId)
    expect(await avatarFor(crypto, 'MIKA' as PeerId)).toEqual(mika)
    expect(drawAvatar(await avatarFor(crypto, 'ROOK' as PeerId))).not.toEqual(drawAvatar(mika))
  })
})

describe('drawAvatar', () => {
  it('fills every pixel with an opaque colour, for every plumage and accessory', () => {
    const base = avatarTraits(digest(1))
    for (const plumage of PLUMAGES) {
      for (const accessory of ACCESSORIES) {
        const pixels = drawAvatar({ ...base, plumage, accessory })
        expect(pixels).toHaveLength(AVATAR_SIZE * AVATAR_SIZE)
        expect(pixels.every(isHex)).toBe(true)
      }
    }
  })

  it('draws the same picture for the same traits', () => {
    const traits = avatarTraits(digest(3))
    expect(drawAvatar(traits)).toEqual(drawAvatar(traits))
  })
})

describe('avatarSvg', () => {
  it('is a crisp square with a title when one is given', () => {
    const svg = avatarSvg(drawAvatar(avatarTraits(digest(5))), 48, 'Mika & co')
    expect(svg).toContain('width="48" height="48"')
    expect(svg).toContain('shape-rendering="crispEdges"')
    expect(svg).toContain('<title>Mika &amp; co</title>')
  })

  it('is hidden from screen readers without a title', () => {
    expect(avatarSvg(drawAvatar(avatarTraits(digest(5))))).toContain('aria-hidden="true"')
  })
})

describe('describeAvatar', () => {
  const base = { ...avatarTraits(digest(9)), plumage: 'slate', neck: 'copper' } as const

  it('names the plumage, the neck and what the bird wears', () => {
    expect(describeAvatar({ ...base, accessory: 'flat cap' })).toBe(
      'A slate pigeon with a copper neck, wearing a flat cap',
    )
  })

  it('reads naturally for pairs, the letter and plain birds', () => {
    expect(describeAvatar({ ...base, accessory: 'sunglasses' })).toBe(
      'A slate pigeon with a copper neck, wearing sunglasses',
    )
    expect(describeAvatar({ ...base, accessory: 'letter' })).toBe(
      'A slate pigeon with a copper neck, carrying a letter',
    )
    expect(describeAvatar({ ...base, plumage: 'indigo', neck: 'plain', accessory: 'none' })).toBe(
      'An indigo pigeon',
    )
  })
})
