// Every Pigeon draws the same pixel pigeon for an id: the hash of the id picks the
// traits, the traits draw a 32×32 picture, and nothing is ever sent. It sits beside the
// fingerprint, never instead of it: a bird is about 32 bits, so anyone could grind a key to
// match one.
//
// Two promises keep birds stable (docs/design.md, Avatars):
// - The traits an id gets are frozen per version. Which digest byte a trait reads, the chance it
//   is worn, and every option list below belong to version 1: never reorder, remove or add to
//   them. New options are version 2, with tables of their own beside these.
// - How a trait is drawn may improve at any time. A better flat cap is still a flat cap.
// Each person's `hello` says which version their bird is drawn with, so a new version never
// changes anyone who already has a bird.
import { utf8Encode } from '../encoding/bytes.ts'
import type { Crypto } from '../identity/crypto.ts'
import type { PeerId } from '../identity/identity.ts'

export const AVATAR_SIZE = 32
/** The newest version: what a new identity's bird is drawn with. */
export const AVATAR_VERSION = 1

export const PLUMAGES = [
  'rock',
  'white',
  'slate',
  'ash red',
  'cream',
  'sooty',
  'lavender',
  'pied',
  'grizzle',
  'mealy',
  'almond',
  'indigo',
] as const
export const NECKS = ['green', 'teal', 'copper', 'rose', 'gold', 'plain'] as const
export const WINGS = ['barred', 'checkered', 'plain', 'white-tipped'] as const
export const MARKINGS = ['none', 'cap', 'blaze', 'crest', 'mask', 'bib'] as const
export const EYES = ['orange', 'pearl', 'red', 'dark', 'yellow'] as const
export const EXPRESSIONS = ['bright', 'sleepy', 'winking', 'happy'] as const
export const BEAKS = ['short', 'pink', 'long'] as const
export const HEADWEAR = [
  'none',
  'flat cap',
  'party hat',
  'beanie',
  'top hat',
  'wizard hat',
  'beret',
  'paper crown',
  'headphones',
  'flower',
] as const
export const NECKWEAR = ['none', 'scarf', 'bow tie', 'bandana'] as const
export const EYEWEAR = ['none', 'monocle', 'sunglasses', 'round glasses'] as const
export const HELD = ['none', 'letter', 'olive twig'] as const
export const TILES = [
  'sky',
  'grass',
  'sunset',
  'lilac',
  'teal',
  'sand',
  'rose',
  'night',
  'mint',
  'peach',
  'storm',
  'gold',
] as const
export const PATTERNS = ['plain', 'dither', 'stripes', 'dots', 'checks', 'zigzag'] as const
export const SCENES = ['none', 'wire', 'rooftops', 'branch', 'hills'] as const
export const SKIES = ['none', 'sun', 'cloud', 'paper plane', 'stars'] as const

export interface AvatarTraits {
  readonly plumage: (typeof PLUMAGES)[number]
  readonly neck: (typeof NECKS)[number]
  readonly wing: (typeof WINGS)[number]
  readonly marking: (typeof MARKINGS)[number]
  readonly eye: (typeof EYES)[number]
  readonly expression: (typeof EXPRESSIONS)[number]
  readonly beak: (typeof BEAKS)[number]
  readonly headwear: (typeof HEADWEAR)[number]
  readonly neckwear: (typeof NECKWEAR)[number]
  readonly eyewear: (typeof EYEWEAR)[number]
  readonly held: (typeof HELD)[number]
  readonly tile: (typeof TILES)[number]
  readonly pattern: (typeof PATTERNS)[number]
  readonly scene: (typeof SCENES)[number]
  readonly sky: (typeof SKIES)[number]
}

/** Row-major, AVATAR_SIZE × AVATAR_SIZE, every pixel an opaque `#rrggbb`. */
export type AvatarPixels = readonly string[]

const byteAt = (digest: Uint8Array, index: number) => digest[index] ?? 0

/** Always one of the options: `byte` picks among them. */
const pick = <T>(options: readonly T[], byte: number): T => options[byte % options.length] as T

/**
 * An option worn by `chance` of 256 birds, read from two bytes: one decides whether, the other
 * which. `options[0]` is "none".
 */
const sometimes = <T>(options: readonly T[], digest: Uint8Array, at: number, chance: number): T =>
  byteAt(digest, at) < chance ? pick(options.slice(1), byteAt(digest, at + 1)) : (options[0] as T)

/** Version 1. Frozen: see the top of this file. */
function traitsV1(digest: Uint8Array): AvatarTraits {
  return {
    plumage: pick(PLUMAGES, byteAt(digest, 0)),
    neck: pick(NECKS, byteAt(digest, 1)),
    wing: pick(WINGS, byteAt(digest, 2)),
    marking: pick(MARKINGS, byteAt(digest, 3)),
    eye: pick(EYES, byteAt(digest, 4)),
    expression: byteAt(digest, 5) < 176 ? 'bright' : pick(EXPRESSIONS.slice(1), byteAt(digest, 6)),
    beak: pick(BEAKS, byteAt(digest, 7)),
    headwear: sometimes(HEADWEAR, digest, 8, 128),
    neckwear: sometimes(NECKWEAR, digest, 10, 80),
    eyewear: sometimes(EYEWEAR, digest, 12, 64),
    held: sometimes(HELD, digest, 14, 32),
    tile: pick(TILES, byteAt(digest, 16)),
    pattern: pick(PATTERNS, byteAt(digest, 17)),
    scene: sometimes(SCENES, digest, 18, 160),
    sky: sometimes(SKIES, digest, 20, 128),
  }
}

/**
 * The traits a 32-byte digest stands for in `version`. A version this Pigeon doesn't know yet
 * (from a newer friend) is drawn as the newest one it does.
 */
export function avatarTraits(digest: Uint8Array, version: number = AVATAR_VERSION): AvatarTraits {
  switch (version) {
    default:
      return traitsV1(digest)
  }
}

/** The traits for an id in `version`: the same on every Pigeon. */
export async function avatarFor(
  crypto: Crypto,
  id: PeerId,
  version: number = AVATAR_VERSION,
): Promise<AvatarTraits> {
  return avatarTraits(await crypto.sha256(utf8Encode(`pigeon/avatar/v1\n${id}`)), version)
}

// Colours ------------------------------------------------------------------------------------

const channels = (hex: string): [number, number, number] => [
  Number.parseInt(hex.slice(1, 3), 16),
  Number.parseInt(hex.slice(3, 5), 16),
  Number.parseInt(hex.slice(5, 7), 16),
]
const toHex = (rgb: readonly number[]): string =>
  `#${rgb
    .map((c) =>
      Math.round(Math.min(255, Math.max(0, c)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`
const mix = (a: string, b: string, t: number): string => {
  const [x, y] = [channels(a), channels(b)]
  return toHex(x.map((c, i) => c + ((y[i] ?? 0) - c) * t))
}
const darken = (hex: string, t: number) => mix(hex, '#000000', t)
const lighten = (hex: string, t: number) => mix(hex, '#ffffff', t)

const WHITE_FEATHER = '#f1f1ee'

const PLUMAGE_COLOURS: Record<AvatarTraits['plumage'], string> = {
  rock: '#8f9aab',
  white: '#e8e9ec',
  slate: '#5d6575',
  'ash red': '#b47c5c',
  cream: '#d9c38f',
  sooty: '#43464f',
  lavender: '#a79bc2',
  pied: '#8f9aab',
  grizzle: '#99a0aa',
  mealy: '#cbbfb0',
  almond: '#d4a457',
  indigo: '#5b609c',
}
const NECK_COLOURS: Record<AvatarTraits['neck'], readonly [string, string] | undefined> = {
  green: ['#3f9e66', '#8a57b0'],
  teal: ['#2f9aa6', '#3d63c2'],
  copper: ['#c98a2c', '#b4552d'],
  rose: ['#d0648f', '#8a4fb5'],
  gold: ['#d8b13a', '#5f9e4a'],
  plain: undefined,
}
const EYE_COLOURS: Record<AvatarTraits['eye'], string> = {
  orange: '#f08a1c',
  pearl: '#e9e4d4',
  red: '#d63a2f',
  dark: '#3a2a22',
  yellow: '#f2cf2a',
}
const TILE_COLOURS: Record<AvatarTraits['tile'], readonly [string, string]> = {
  sky: ['#a9d2f5', '#5c97d3'],
  grass: ['#b4df94', '#64a84b'],
  sunset: ['#ffd29a', '#ee8247'],
  lilac: ['#d6c4f3', '#9479cf'],
  teal: ['#9ce2da', '#3c9f95'],
  sand: ['#f4e3b0', '#d4b15c'],
  rose: ['#f8c3d1', '#dc7193'],
  night: ['#4d5a99', '#202852'],
  mint: ['#c9f1de', '#5bbd92'],
  peach: ['#ffe2cf', '#ef9c76'],
  storm: ['#c6cfda', '#69778a'],
  gold: ['#fff0a3', '#dcaa22'],
}

// Shapes -------------------------------------------------------------------------------------

const inEllipse = (x: number, y: number, cx: number, cy: number, rx: number, ry: number) =>
  ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1

const inHead = (x: number, y: number) => inEllipse(x, y, 20, 11.5, 6.5, 6.5)
// The neck reaches up into the head and down into the chest, so the three read as one curve.
const inNeck = (x: number, y: number) =>
  inEllipse(x, y, 18, 17.5, 5.8, 6.5) || inEllipse(x, y, 20.5, 19, 4, 4.5)
// A rounded back that carries on into a tail, and a chest that puffs forward under the throat.
const inBody = (x: number, y: number) =>
  inEllipse(x, y, 14.5, 27, 10.5, 8) ||
  inEllipse(x, y, 9, 25.5, 6.5, 5.5) ||
  inEllipse(x, y, 20, 23.5, 5.5, 5.5) ||
  (y >= 26 && y <= 30 && x >= 1 && x <= 6 && x >= 1 + Math.abs(28 - y))
const inWing = (x: number, y: number) => inBody(x, y) && inEllipse(x, y, 10.5, 26, 8.5, 5.5)
const inBird = (x: number, y: number) =>
  x >= 0 &&
  y >= 0 &&
  x < AVATAR_SIZE &&
  y < AVATAR_SIZE &&
  (inHead(x, y) || inNeck(x, y) || inBody(x, y))

/** Small drawings: one character per pixel, `.` for nothing, the rest looked up in `colours`. */
interface Sprite {
  readonly x: number
  readonly y: number
  readonly rows: readonly string[]
  readonly colours: Readonly<Record<string, string>>
}
type Put = (x: number, y: number, colour: string) => void
const stamp = (put: Put, sprite: Sprite) =>
  sprite.rows.forEach((row, dy) => {
    for (let dx = 0; dx < row.length; dx++) {
      const colour = sprite.colours[row[dx] ?? '.']
      if (colour !== undefined) put(sprite.x + dx, sprite.y + dy, colour)
    }
  })

const HEADWEAR_SPRITES: Record<Exclude<AvatarTraits['headwear'], 'none'>, Sprite> = {
  'flat cap': {
    x: 13,
    y: 3,
    rows: ['..aaaaaaa....', '.aaaaaaaaaa..', 'abbbbbbbbbbbb'],
    colours: { a: '#7a6650', b: '#5a4a3a' },
  },
  'party hat': {
    x: 16,
    y: 0,
    rows: ['...w...', '...a...', '..aba..', '..bab..', '.ababa.', 'bababab'],
    colours: { w: '#fff6a8', a: '#e8467c', b: '#46b3e8' },
  },
  beanie: {
    x: 14,
    y: 1,
    rows: ['.....p.....', '...aaaaa...', '..aaaaaaa..', '.aaaaaaaaa.', 'bbbbbbbbbbb'],
    colours: { p: '#ffffff', a: '#d9443b', b: '#f2a33a' },
  },
  'top hat': {
    x: 15,
    y: 0,
    rows: ['..kkkkk..', '..kkkkk..', '..kkkkk..', '..rrrrr..', 'kkkkkkkkk'],
    colours: { k: '#1f2026', r: '#c0392b' },
  },
  'wizard hat': {
    x: 15,
    y: 0,
    rows: ['......a..', '.....aa..', '....aya..', '...aaaa..', '..aaaaaa.', 'bbbbbbbbb'],
    colours: { a: '#4b3a9c', y: '#ffd84a', b: '#36296f' },
  },
  beret: {
    x: 14,
    y: 2,
    rows: ['.......s...', '...aaaaaa..', '.aaaaaaaaaa', 'aaaaaaaaaa.'],
    colours: { a: '#b8323c', s: '#7d1f27' },
  },
  'paper crown': {
    x: 16,
    y: 1,
    rows: ['a..a..a', 'aa.aa.a', 'aaaaaaa', 'abaabaa'],
    colours: { a: '#f2c94c', b: '#d6455d' },
  },
  headphones: {
    x: 14,
    y: 3,
    rows: [
      '..bbbbbbb..',
      '.b.......b.',
      'b.........b',
      'b.........b',
      'b.........b',
      'b.........b',
      'cc.........',
      'cc.........',
      'cc.........',
    ],
    colours: { b: '#2e2f36', c: '#d64545' },
  },
  flower: {
    x: 14,
    y: 4,
    rows: ['.p.', 'pyp', '.p.'],
    colours: { p: '#f37fb5', y: '#ffd84a' },
  },
}
const NECKWEAR_SPRITES: Record<Exclude<AvatarTraits['neckwear'], 'none'>, Sprite> = {
  scarf: {
    x: 11,
    y: 17,
    rows: [
      '......aabaabaa',
      '.....aabaabaab',
      '.aabaabaabaa..',
      '.ab...........',
      '.ba...........',
      '.ab...........',
      '.bb...........',
    ],
    colours: { a: '#c8372d', b: '#f3ece0' },
  },
  'bow tie': {
    x: 19,
    y: 19,
    rows: ['aa..aa', 'aaaaaa', 'aa..aa'],
    colours: { a: '#2f56c8' },
  },
  bandana: {
    x: 17,
    y: 18,
    rows: ['aaaaaaa', '.awaaw.', '..aaa..', '...a...'],
    colours: { a: '#2f7fd0', w: '#ffffff' },
  },
}
const EYEWEAR_SPRITES: Record<Exclude<AvatarTraits['eyewear'], 'none'>, Sprite> = {
  monocle: {
    x: 21,
    y: 8,
    rows: ['.ggg', 'g..g', 'g..g', '.ggg', '...g', '...g', '..g.'],
    colours: { g: '#e2b33c' },
  },
  sunglasses: {
    x: 19,
    y: 9,
    rows: ['kkkkkkkk', '.kwkk...', '..kk....'],
    colours: { k: '#17181c', w: '#7f8aa6' },
  },
  'round glasses': {
    x: 15,
    y: 8,
    rows: ['......gggg', '.....g....g', 'ggggg.....g', '.....g....g', '......gggg'],
    colours: { g: '#4a3426' },
  },
}
const HELD_SPRITES: Record<Exclude<AvatarTraits['held'], 'none'>, Sprite> = {
  letter: {
    x: 26,
    y: 13,
    rows: ['wwwwww', 'wkwwkw', 'wwkkww', 'wwwrww'],
    colours: { w: '#f7f3e8', k: '#c4b48a', r: '#cc3b3b' },
  },
  'olive twig': {
    x: 26,
    y: 11,
    rows: ['....l.', '..sl..', 'sssss.', '..l...', '.l....'],
    colours: { s: '#6b4f2a', l: '#6fa548' },
  },
}

/** What the eye looks like: `o` the eye ring, `i` the iris, `k` the pupil, `h` its light, `d` a lid. */
const EYE_ROWS: Record<AvatarTraits['expression'], readonly string[]> = {
  bright: ['.oo.', 'ohio', 'oiko', '.oo.'],
  sleepy: ['.oo.', 'oddo', 'oiko', '.oo.'],
  winking: ['....', '.oo.', 'o..o', '....'],
  happy: ['.oo.', 'oiko', 'o..o', '....'],
}

// Drawing ------------------------------------------------------------------------------------

function drawTile(put: Put, traits: AvatarTraits) {
  // A gradient in four bands, dithered where the bands meet, with a pattern over it.
  const [top, bottom] = TILE_COLOURS[traits.tile]
  for (let y = 0; y < AVATAR_SIZE; y++) {
    for (let x = 0; x < AVATAR_SIZE; x++) {
      const position = y / (AVATAR_SIZE - 1)
      const band = Math.min(3, Math.floor(position * 4 + ((x + y) % 2 === 0 ? 0.12 : -0.12)))
      let colour = mix(top, bottom, band / 3)
      const lightly = traits.tile === 'night' ? lighten(colour, 0.12) : lighten(colour, 0.22)
      if (traits.pattern === 'dither' && (x + y) % 2 === 0 && (x * 3 + y) % 4 === 0)
        colour = lightly
      if (traits.pattern === 'stripes' && (x + y) % 6 < 2) colour = lightly
      if (traits.pattern === 'dots' && x % 6 === 2 && y % 6 === 2) colour = lightly
      if (traits.pattern === 'checks' && ((x >> 2) + (y >> 2)) % 2 === 0)
        colour = mix(colour, lightly, 0.5)
      if (traits.pattern === 'zigzag' && (y + Math.abs((x % 8) - 4)) % 8 < 2) colour = lightly
      if (traits.tile === 'night' && (x * 7 + y * 13) % 41 === 0) colour = '#fff7c2'
      put(x, y, colour)
    }
  }
}

/** Things in the sky, up and to the left, behind the bird. At night the sun is a moon. */
function drawSky(put: Put, traits: AvatarTraits) {
  const night = traits.tile === 'night' || traits.tile === 'storm'
  if (traits.sky === 'sun' && night) {
    stamp(put, {
      x: 3,
      y: 2,
      rows: ['.mmm.', 'mmm..', 'mm...', 'mmm..', '.mmm.'],
      colours: { m: '#f4efcf' },
    })
  } else if (traits.sky === 'sun') {
    stamp(put, {
      x: 2,
      y: 1,
      rows: ['...r...', '.rsssr.', '.sswss.', 'rssssss', '.sssss.', '.rsssr.', '...r...'],
      colours: { s: '#ffd84a', w: '#fff6c2', r: '#ffe98a' },
    })
  }
  if (traits.sky === 'cloud') {
    stamp(put, {
      x: 2,
      y: 3,
      rows: ['...ww....', '.wwwwww..', 'wwwwwwwww', '.gggggggg'],
      colours: { w: '#ffffff', g: '#dfe6ee' },
    })
  }
  if (traits.sky === 'paper plane') {
    stamp(put, {
      x: 2,
      y: 3,
      rows: ['w......', 'www....', '.wwwgg.', '..wggg.', '...g...'],
      colours: { w: '#ffffff', g: '#cfd8e3' },
    })
  }
  if (traits.sky === 'stars') {
    for (const [x, y] of [
      [3, 3],
      [8, 2],
      [5, 7],
    ] as const) {
      put(x, y, '#fff7c2')
      put(x - 1, y, '#fffbe0')
      put(x + 1, y, '#fffbe0')
      put(x, y - 1, '#fffbe0')
      put(x, y + 1, '#fffbe0')
    }
  }
}

/** Where the bird is: something behind it, drawn in the tile's own colours. */
function drawScene(put: Put, traits: AvatarTraits) {
  const [top, bottom] = TILE_COLOURS[traits.tile]
  if (traits.scene === 'wire') {
    // A telephone wire sagging across behind the bird, from a pole at the right.
    for (let x = 0; x < AVATAR_SIZE; x++)
      put(x, 20 + Math.round(((x - 14) / 14) ** 2 * -2 + 2), '#2c2d35')
    for (let y = 14; y < AVATAR_SIZE; y++) {
      put(29, y, '#6b5338')
      put(30, y, '#54412c')
    }
    put(28, 16, '#6b5338')
    put(31, 16, '#6b5338')
  }
  if (traits.scene === 'rooftops') {
    const roof = darken(bottom, 0.35)
    const window = lighten(top, 0.3)
    const heights = [22, 22, 21, 20, 20, 21, 22, 23, 23, 22, 21, 21, 22, 24, 24, 24]
    for (let x = 0; x < AVATAR_SIZE; x++) {
      const height = heights[x % heights.length] ?? 22
      for (let y = height; y < AVATAR_SIZE; y++) put(x, y, roof)
      if (x % 5 === 2 && height + 3 < AVATAR_SIZE) put(x, height + 3, window)
    }
    for (let y = 17; y < 20; y++) put(4, y, roof)
  }
  if (traits.scene === 'branch') {
    stamp(put, {
      x: 0,
      y: 13,
      rows: [
        '..ll..........',
        '.llll.ll......',
        'bbbbbbbbbb....',
        'bbbbbbbbbbbbb.',
        '.....ll..ll...',
        '......l..lll..',
      ],
      colours: { b: '#6b4f2a', l: '#5e9e48' },
    })
  }
  if (traits.scene === 'hills') {
    const hill = mix(bottom, '#5e9e48', 0.55)
    for (let x = 0; x < AVATAR_SIZE; x++) {
      const crest = 24 + Math.round(Math.sin(x / 5) * 2)
      for (let y = crest; y < AVATAR_SIZE; y++) put(x, y, y === crest ? lighten(hill, 0.2) : hill)
    }
  }
}

function drawBird(put: Put, read: (x: number, y: number) => string, traits: AvatarTraits) {
  // A soft shadow down and to the right, as XP icons have.
  for (let y = 0; y < AVATAR_SIZE; y++) {
    for (let x = 0; x < AVATAR_SIZE; x++) {
      if (inBird(x - 1, y - 1) && !inBird(x, y)) put(x, y, darken(read(x, y), 0.3))
    }
  }

  // Plumage lit from the upper left, outlined in a darker shade of itself.
  const base = PLUMAGE_COLOURS[traits.plumage]
  const outline = darken(base, traits.plumage === 'sooty' ? 0.45 : 0.42)
  const wingBase = darken(base, traits.plumage === 'white' ? 0.06 : 0.1)
  // Mealy birds carry red bars on a pale body, as the real colour does.
  const bar = traits.plumage === 'mealy' ? '#b0523b' : darken(base, 0.4)
  const neck = NECK_COLOURS[traits.neck]
  for (let y = 0; y < AVATAR_SIZE; y++) {
    for (let x = 0; x < AVATAR_SIZE; x++) {
      if (!inBird(x, y)) continue
      let colour = base
      if (
        traits.plumage === 'pied' &&
        !inHead(x, y) &&
        (inEllipse(x, y, 20.5, 28, 5, 4.5) || (x <= 5 + (y - 20) / 3 && x >= 6))
      ) {
        colour = WHITE_FEATHER
      }
      if (inWing(x, y) && !inHead(x, y)) {
        colour = colour === WHITE_FEATHER ? colour : wingBase
        // Two bars that follow the wing's curve, as a rock pigeon's do.
        const curve = Math.round((x - 10) ** 2 / 40)
        if (traits.wing === 'barred' && x >= 5 && x <= 15 && (y === 24 + curve || y === 27 + curve))
          colour = bar
        if (traits.wing === 'checkered' && (x + 2 * y) % 4 === 0 && (y + (x >> 2)) % 2 === 0)
          colour = bar
        if (traits.wing === 'white-tipped' && x <= 4 + Math.max(0, y - 25)) colour = WHITE_FEATHER
      }
      if (neck !== undefined && inNeck(x, y) && !inWing(x, y) && y >= 14 && y <= 21 && x >= 13) {
        // A sheen on the neck, not a band across the chest: it fades in under the head and out
        // above the chest, the first colour above and the second below, dithered where they meet.
        const bayer = [0, 2, 3, 1][(x % 2) + 2 * (y % 2)] ?? 0
        const strength = y <= 15 ? (y - 13) / 3 : y >= 20 ? (22 - y) / 3 : 1
        const lower = y + bayer / 2 > 18
        if (bayer / 4 < strength) colour = mix(colour, lower ? neck[1] : neck[0], 0.45)
      }
      // Grizzle is flecked white, unevenly, the way the real colour is.
      if (traits.plumage === 'grizzle' && (x * 7 + y * 11 + ((x * y) % 3)) % 6 === 0)
        colour = WHITE_FEATHER
      if (traits.plumage === 'almond' && !inHead(x, y) && (x * 5 + y * 7) % 9 === 0)
        colour = '#5a3d22'
      if (traits.marking === 'cap' && inHead(x, y) && y <= 8) colour = darken(base, 0.35)
      if (traits.marking === 'mask' && inHead(x, y) && inEllipse(x, y, 22.5, 10.5, 3.5, 2.5))
        colour = darken(base, 0.4)
      if (traits.marking === 'bib' && inEllipse(x, y, 22, 17, 2.5, 3)) colour = '#f4f2ee'
      if (traits.marking === 'blaze' && inHead(x, y) && x >= 22 && y >= 11) colour = '#f4f2ee'
      // Light and shade from the upper left.
      if (!inBird(x - 1, y - 1)) colour = lighten(colour, 0.28)
      else if (!inBird(x + 1, y + 1) && y < AVATAR_SIZE - 1) colour = darken(colour, 0.18)
      const edge =
        !inBird(x - 1, y) ||
        !inBird(x + 1, y) ||
        !inBird(x, y - 1) ||
        (!inBird(x, y + 1) && y < AVATAR_SIZE - 1)
      put(x, y, edge ? outline : colour)
    }
  }
  if (traits.marking === 'crest') {
    stamp(put, {
      x: 14,
      y: 3,
      rows: ['.oo..', 'obbo.', '.obbo'],
      colours: { o: outline, b: lighten(base, 0.15) },
    })
  }

  // Face: the cere above the beak, the beak, the eye.
  const beak = traits.beak === 'pink' ? '#e7a1a1' : '#4a3f3a'
  stamp(put, {
    x: 25,
    y: 11,
    rows: ['ww..', 'bbbt', 'bbb.'],
    colours: { w: '#efe7dc', b: beak, t: darken(beak, 0.3) },
  })
  if (traits.beak === 'long') {
    put(28, 12, darken(beak, 0.3))
    put(29, 12, darken(beak, 0.45))
  }
  stamp(put, {
    x: 21,
    y: 9,
    rows: EYE_ROWS[traits.expression],
    colours: {
      o: darken(base, 0.5),
      h: '#ffffff',
      i: EYE_COLOURS[traits.eye],
      k: '#141414',
      d: darken(base, 0.2),
    },
  })
}

/** Draws the bird the traits describe, the same every time. */
export function drawAvatar(traits: AvatarTraits): AvatarPixels {
  const pixels: string[] = new Array(AVATAR_SIZE * AVATAR_SIZE).fill('#000000')
  const put: Put = (x, y, colour) => {
    if (x >= 0 && y >= 0 && x < AVATAR_SIZE && y < AVATAR_SIZE) pixels[y * AVATAR_SIZE + x] = colour
  }
  const read = (x: number, y: number) => pixels[y * AVATAR_SIZE + x] ?? '#000000'

  drawTile(put, traits)
  drawSky(put, traits)
  drawScene(put, traits)
  drawBird(put, read, traits)
  // What it wears, from the neck up, then what it holds.
  if (traits.neckwear !== 'none') stamp(put, NECKWEAR_SPRITES[traits.neckwear])
  if (traits.headwear !== 'none') stamp(put, HEADWEAR_SPRITES[traits.headwear])
  if (traits.eyewear !== 'none') stamp(put, EYEWEAR_SPRITES[traits.eyewear])
  if (traits.held !== 'none') stamp(put, HELD_SPRITES[traits.held])
  return pixels
}

/**
 * The picture as an SVG, one `rect` per run of a colour along a row. At a whole multiple of 32px
 * every pixel stays square and sharp; at any other size it's drawn smoothly instead, each rect a
 * hair larger than its cell so no seams show between them.
 */
export function avatarSvg(pixels: AvatarPixels, size = AVATAR_SIZE, title?: string): string {
  const crisp = size % AVATAR_SIZE === 0
  const bleed = crisp ? 0 : 0.04
  const rects: string[] = []
  for (let y = 0; y < AVATAR_SIZE; y++) {
    let x = 0
    while (x < AVATAR_SIZE) {
      const colour = pixels[y * AVATAR_SIZE + x]
      let run = 1
      while (x + run < AVATAR_SIZE && pixels[y * AVATAR_SIZE + x + run] === colour) run++
      rects.push(
        `<rect x="${x}" y="${y}" width="${run + bleed}" height="${1 + bleed}" fill="${colour}"/>`,
      )
      x += run
    }
  }
  const label =
    title === undefined ? ' aria-hidden="true">' : ` role="img"><title>${escapeXml(title)}</title>`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${AVATAR_SIZE} ${AVATAR_SIZE}" width="${size}" height="${size}"${crisp ? ' shape-rendering="crispEdges"' : ''}${label}${rects.join('')}</svg>`
}

const escapeXml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const article = (word: string) => (/^[aeiou]/.test(word) ? 'an' : 'a')
const worn = (item: string) => (/phones$|glasses$/.test(item) ? item : `${article(item)} ${item}`)
const list = (items: readonly string[]) =>
  items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`
const SCENE_WORDS: Record<Exclude<AvatarTraits['scene'], 'none'>, string> = {
  wire: 'on a wire',
  rooftops: 'over the rooftops',
  branch: 'on a branch',
  hills: 'over the hills',
}

/**
 * "A slate pigeon with a copper neck, wearing a flat cap and a scarf, carrying a letter, on a
 * wire": for alt text and the profile.
 */
export function describeAvatar(traits: AvatarTraits): string {
  const parts = [
    `${article(traits.plumage).replace(/^a/, 'A')} ${traits.plumage} pigeon${
      traits.neck === 'plain' ? '' : ` with a ${traits.neck} neck`
    }`,
  ]
  const wearing = [traits.headwear, traits.neckwear, traits.eyewear].filter(
    (item) => item !== 'none',
  )
  if (wearing.length > 0) parts.push(`wearing ${list(wearing.map(worn))}`)
  if (traits.held !== 'none') parts.push(`carrying ${worn(traits.held)}`)
  if (traits.scene !== 'none') parts.push(SCENE_WORDS[traits.scene])
  return parts.join(', ')
}
