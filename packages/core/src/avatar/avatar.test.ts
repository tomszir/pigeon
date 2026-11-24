import { describe, expect, it } from 'vitest'
import type { Crypto } from '../identity/crypto.ts'
import type { PeerId } from '../identity/identity.ts'
import { fakeCrypto } from '../testing/testing.ts'
import {
  AVATAR_SIZE,
  AVATAR_VERSION,
  type AvatarTraits,
  avatarFor,
  avatarSvg,
  avatarTraits,
  describeAvatar,
  drawAvatar,
  EXPRESSIONS,
  EYEWEAR,
  HEADWEAR,
  HELD,
  NECKWEAR,
  PLUMAGES,
  SCENES,
  SKIES,
  TILES,
} from './avatar.ts'

/** The test runner's WebCrypto. Core has no DOM or Node types, so this names the one call. */
const subtle = (
  globalThis as unknown as {
    crypto: { subtle: { digest(algorithm: string, data: Uint8Array): Promise<ArrayBuffer> } }
  }
).crypto.subtle

/** Real SHA-256, so the pinned birds below are the ones every Pigeon draws. */
const realCrypto: Crypto = {
  ...fakeCrypto,
  sha256: async (data) => new Uint8Array(await subtle.digest('SHA-256', data)),
}

const digest = (seed: number) =>
  Uint8Array.from({ length: 32 }, (_, i) => (seed * 31 + i * 17) % 256)
const randomish = (seed: number) =>
  Uint8Array.from({ length: 32 }, (_, i) => ((seed * (i + 7) * 2654435761) >>> (i % 24)) & 255)
const isHex = (colour: string | undefined) => colour !== undefined && /^#[0-9a-f]{6}$/.test(colour)

const KEYS = [
  'plumage',
  'neck',
  'wing',
  'marking',
  'eye',
  'expression',
  'beak',
  'headwear',
  'neckwear',
  'eyewear',
  'held',
  'tile',
  'pattern',
  'scene',
  'sky',
] as const satisfies readonly (keyof AvatarTraits)[]
const short = (traits: AvatarTraits) => KEYS.map((key) => traits[key]).join('|')

describe('version 1 is frozen', () => {
  // These ids must keep these birds for as long as version 1 exists. If this test fails, a
  // change moved somebody's bird: undo it, or make it version 2 (see avatar.ts).
  const PINNED: readonly (readonly [string, string])[] = [
    [
      'TOMS',
      'slate|teal|checkered|cap|dark|bright|short|none|none|monocle|none|gold|dots|wire|stars',
    ],
    [
      'MIKA',
      'almond|copper|barred|crest|yellow|bright|short|none|none|none|none|sand|plain|hills|cloud',
    ],
    [
      'ROOK',
      'indigo|plain|white-tipped|none|dark|happy|pink|beanie|none|none|none|teal|zigzag|hills|none',
    ],
    [
      'SAM',
      'pied|gold|plain|none|yellow|sleepy|short|flower|none|sunglasses|none|sky|plain|none|cloud',
    ],
    [
      'ADA',
      'lavender|green|checkered|crest|pearl|happy|pink|party hat|none|sunglasses|none|grass|stripes|none|stars',
    ],
    [
      'JUNO',
      'rock|teal|checkered|none|orange|bright|pink|party hat|none|none|olive twig|teal|dither|none|stars',
    ],
    [
      'KAI',
      'white|plain|barred|crest|pearl|bright|long|none|bow tie|none|none|grass|stripes|hills|none',
    ],
    [
      'LENA',
      'sooty|plain|white-tipped|bib|yellow|bright|pink|none|bandana|none|none|gold|zigzag|rooftops|none',
    ],
    [
      'OTTO',
      'pied|rose|white-tipped|none|pearl|bright|long|party hat|none|none|none|sky|zigzag|hills|stars',
    ],
    [
      'PIA',
      'ash red|green|white-tipped|mask|dark|winking|short|none|none|none|none|sand|zigzag|wire|cloud',
    ],
    [
      'RAVI',
      'lavender|plain|checkered|none|pearl|bright|short|top hat|bow tie|sunglasses|none|sky|zigzag|hills|sun',
    ],
    [
      'NOOR',
      'almond|teal|plain|crest|dark|bright|long|flat cap|none|none|none|gold|dots|rooftops|stars',
    ],
    [
      'IRIS',
      'grizzle|gold|checkered|cap|dark|bright|long|beret|none|none|none|gold|zigzag|rooftops|cloud',
    ],
    ['BEA', 'grizzle|plain|plain|bib|orange|bright|long|none|none|none|none|peach|plain|none|none'],
    [
      'FINN',
      'ash red|green|barred|mask|yellow|bright|pink|beanie|none|none|olive twig|lilac|zigzag|wire|stars',
    ],
    [
      'YUKI',
      'almond|plain|barred|blaze|dark|bright|long|party hat|bow tie|none|none|sunset|stripes|rooftops|none',
    ],
    [
      'LEO',
      'grizzle|rose|white-tipped|cap|orange|bright|long|paper crown|scarf|none|none|storm|plain|branch|none',
    ],
    [
      'MARA',
      'ash red|green|checkered|bib|orange|bright|long|paper crown|none|sunglasses|none|night|dots|wire|cloud',
    ],
    [
      'TEO',
      'slate|copper|plain|cap|yellow|bright|pink|beanie|none|none|none|sand|stripes|none|none',
    ],
    [
      'ZOE',
      'ash red|plain|white-tipped|mask|pearl|winking|pink|beret|none|round glasses|none|sunset|zigzag|none|none',
    ],
  ]

  it.each(PINNED)('%s keeps its bird', async (id, expected) => {
    expect(short(await avatarFor(realCrypto, id as PeerId, 1))).toBe(expected)
  })

  it('is what an unknown, newer version falls back to', () => {
    expect(avatarTraits(digest(4), 99)).toEqual(avatarTraits(digest(4), 1))
  })
})

describe('avatarTraits', () => {
  it('reads the same traits from the same digest', () => {
    expect(avatarTraits(digest(7))).toEqual(avatarTraits(digest(7), AVATAR_VERSION))
  })

  it('reaches every option of every slot across digests', () => {
    const seen = new Map<string, Set<string>>()
    for (let seed = 0; seed < 4000; seed++) {
      const traits = avatarTraits(randomish(seed))
      for (const key of KEYS) {
        const values = seen.get(key) ?? new Set()
        values.add(traits[key])
        seen.set(key, values)
      }
    }
    const slots = {
      plumage: PLUMAGES,
      expression: EXPRESSIONS,
      headwear: HEADWEAR,
      neckwear: NECKWEAR,
      eyewear: EYEWEAR,
      held: HELD,
      tile: TILES,
      scene: SCENES,
      sky: SKIES,
    }
    for (const [key, options] of Object.entries(slots)) {
      expect(seen.get(key)?.size, key).toBe(options.length)
    }
  })
})

describe('avatarFor', () => {
  it('gives an id the same bird every time and another id another bird', async () => {
    const mika = await avatarFor(fakeCrypto, 'MIKA' as PeerId)
    expect(await avatarFor(fakeCrypto, 'MIKA' as PeerId)).toEqual(mika)
    expect(drawAvatar(await avatarFor(realCrypto, 'ROOK' as PeerId))).not.toEqual(
      drawAvatar(await avatarFor(realCrypto, 'MIKA' as PeerId)),
    )
  })
})

describe('drawAvatar', () => {
  it('fills every pixel with an opaque colour, whatever the bird wears and wherever it is', () => {
    for (let seed = 0; seed < 300; seed++) {
      const pixels = drawAvatar(avatarTraits(randomish(seed)))
      expect(pixels).toHaveLength(AVATAR_SIZE * AVATAR_SIZE)
      expect(pixels.every(isHex)).toBe(true)
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
    expect(svg).toContain('role="img"><title>Mika &amp; co</title><rect')
  })

  it('is hidden from screen readers without a title', () => {
    expect(avatarSvg(drawAvatar(avatarTraits(digest(5))))).toContain('aria-hidden="true"><rect')
  })
})

describe('describeAvatar', () => {
  const plain: AvatarTraits = {
    ...avatarTraits(digest(9)),
    plumage: 'slate',
    neck: 'copper',
    headwear: 'none',
    neckwear: 'none',
    eyewear: 'none',
    held: 'none',
    scene: 'none',
  }

  it('names the plumage and the neck', () => {
    expect(describeAvatar(plain)).toBe('A slate pigeon with a copper neck')
    expect(describeAvatar({ ...plain, plumage: 'indigo', neck: 'plain' })).toBe('An indigo pigeon')
  })

  it('lists what the bird wears, holds and where it is', () => {
    expect(
      describeAvatar({
        ...plain,
        headwear: 'flat cap',
        neckwear: 'scarf',
        eyewear: 'sunglasses',
        held: 'letter',
        scene: 'wire',
      }),
    ).toBe(
      'A slate pigeon with a copper neck, wearing a flat cap, a scarf and sunglasses, carrying a letter, on a wire',
    )
    expect(describeAvatar({ ...plain, headwear: 'headphones', held: 'olive twig' })).toBe(
      'A slate pigeon with a copper neck, wearing headphones, carrying an olive twig',
    )
  })
})
