// Every Pigeon draws the same pixel pigeon for an id (roadmap M10): the hash of the id picks the
// traits, the traits draw a 32×32 picture, and nothing is ever sent. It sits beside the
// fingerprint, never instead of it: a bird is a few bits, so anyone could grind a key to match one.

import { utf8Encode } from '../encoding/bytes.ts'
import type { Crypto } from '../identity/crypto.ts'
import type { PeerId } from '../identity/identity.ts'

export const AVATAR_SIZE = 32

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
export const BEAKS = ['short', 'pink', 'long'] as const
export const ACCESSORIES = [
  'none',
  'flat cap',
  'party hat',
  'beanie',
  'headphones',
  'scarf',
  'bow tie',
  'monocle',
  'sunglasses',
  'flower',
  'paper crown',
  'beret',
  'top hat',
  'wizard hat',
  'round glasses',
  'bandana',
  'letter',
] as const
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

export interface AvatarTraits {
  readonly plumage: (typeof PLUMAGES)[number]
  readonly neck: (typeof NECKS)[number]
  readonly wing: (typeof WINGS)[number]
  readonly marking: (typeof MARKINGS)[number]
  readonly eye: (typeof EYES)[number]
  readonly beak: (typeof BEAKS)[number]
  readonly accessory: (typeof ACCESSORIES)[number]
  readonly tile: (typeof TILES)[number]
  readonly pattern: (typeof PATTERNS)[number]
}

/** Row-major, AVATAR_SIZE × AVATAR_SIZE, every pixel an opaque `#rrggbb`. */
export type AvatarPixels = readonly string[]

const pick = <T>(options: readonly T[], byte: number | undefined): T =>
  options[(byte ?? 0) % options.length] as T

/** The traits a 32-byte digest stands for. About a third of birds wear nothing. */
export function avatarTraits(digest: Uint8Array): AvatarTraits {
  const wearsSomething = (digest[6] ?? 0) % 3 !== 0
  return {
    plumage: pick(PLUMAGES, digest[0]),
    neck: pick(NECKS, digest[1]),
    wing: pick(WINGS, digest[2]),
    marking: pick(MARKINGS, digest[3]),
    eye: pick(EYES, digest[4]),
    beak: pick(BEAKS, digest[5]),
    accessory: wearsSomething ? pick(ACCESSORIES.slice(1), digest[7]) : 'none',
    tile: pick(TILES, digest[8]),
    pattern: pick(PATTERNS, digest[9]),
  }
}

/** The traits for an id: the same on every Pigeon. */
export async function avatarFor(crypto: Crypto, id: PeerId): Promise<AvatarTraits> {
  return avatarTraits(await crypto.sha256(utf8Encode(`pigeon/avatar/v1\n${id}`)))
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
type Sprite = { readonly x: number; readonly y: number; readonly rows: readonly string[] }
const stamp = (
  put: (x: number, y: number, c: string) => void,
  sprite: Sprite,
  colours: Record<string, string>,
) =>
  sprite.rows.forEach((row, dy) => {
    for (let dx = 0; dx < row.length; dx++) {
      const colour = colours[row[dx] ?? '.']
      if (colour !== undefined) put(sprite.x + dx, sprite.y + dy, colour)
    }
  })

const ACCESSORY_SPRITES: Record<
  Exclude<AvatarTraits['accessory'], 'none'>,
  { sprite: Sprite; colours: Record<string, string> }
> = {
  'flat cap': {
    sprite: { x: 13, y: 3, rows: ['..aaaaaaa....', '.aaaaaaaaaa..', 'abbbbbbbbbbbb'] },
    colours: { a: '#7a6650', b: '#5a4a3a' },
  },
  'party hat': {
    sprite: {
      x: 16,
      y: 0,
      rows: ['...w...', '...a...', '..aba..', '..bab..', '.ababa.', 'bababab'],
    },
    colours: { w: '#fff6a8', a: '#e8467c', b: '#46b3e8' },
  },
  beanie: {
    sprite: {
      x: 14,
      y: 1,
      rows: ['.....p.....', '...aaaaa...', '..aaaaaaa..', '.aaaaaaaaa.', 'bbbbbbbbbbb'],
    },
    colours: { p: '#ffffff', a: '#d9443b', b: '#f2a33a' },
  },
  headphones: {
    sprite: {
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
    },
    colours: { b: '#2e2f36', c: '#d64545' },
  },
  scarf: {
    sprite: {
      x: 11,
      y: 17,
      rows: [
        '......aabaabaa',
        '.....aabaabaab',
        '.aabaabaabaa..',
        '.ab...........',
        '.ba...........',
        '.ab...........',
        '.ww...........',
      ],
    },
    colours: { a: '#c8372d', b: '#f3ece0', w: '#f3ece0' },
  },
  'bow tie': {
    sprite: { x: 19, y: 19, rows: ['aa..aa', 'aaaaaa', 'aa..aa'] },
    colours: { a: '#2f56c8' },
  },
  monocle: {
    sprite: { x: 21, y: 8, rows: ['.ggg', 'g..g', 'g..g', '.ggg', '...g', '...g', '..g.'] },
    colours: { g: '#e2b33c' },
  },
  sunglasses: {
    sprite: { x: 19, y: 9, rows: ['kkkkkkkk', '.kwkk...', '..kk....'] },
    colours: { k: '#17181c', w: '#7f8aa6' },
  },
  flower: {
    sprite: { x: 14, y: 4, rows: ['.p.', 'pyp', '.p.'] },
    colours: { p: '#f37fb5', y: '#ffd84a' },
  },
  'paper crown': {
    sprite: { x: 16, y: 1, rows: ['a..a..a', 'aa.aa.a', 'aaaaaaa', 'abaabaa'] },
    colours: { a: '#f2c94c', b: '#d6455d' },
  },
  beret: {
    sprite: { x: 14, y: 2, rows: ['.......s...', '...aaaaaa..', '.aaaaaaaaaa', 'aaaaaaaaaa.'] },
    colours: { a: '#b8323c', s: '#7d1f27' },
  },
  'top hat': {
    sprite: {
      x: 15,
      y: 0,
      rows: ['..kkkkk..', '..kkkkk..', '..kkkkk..', '..rrrrr..', 'kkkkkkkkk'],
    },
    colours: { k: '#1f2026', r: '#c0392b' },
  },
  'wizard hat': {
    sprite: {
      x: 15,
      y: 0,
      rows: ['......a..', '.....aa..', '....aya..', '...aaaa..', '..aaaaaa.', 'bbbbbbbbb'],
    },
    colours: { a: '#4b3a9c', y: '#ffd84a', b: '#36296f' },
  },
  'round glasses': {
    sprite: {
      x: 15,
      y: 8,
      rows: ['......gggg', '.....g....g', 'ggggg.....g', '.....g....g', '......gggg'],
    },
    colours: { g: '#4a3426' },
  },
  bandana: {
    sprite: { x: 17, y: 18, rows: ['aaaaaaa', '.awaaw.', '..aaa..', '...a...'] },
    colours: { a: '#2f7fd0', w: '#ffffff' },
  },
  letter: {
    sprite: { x: 26, y: 13, rows: ['wwwwww', 'wkwwkw', 'wwkkww', 'wwwrww'] },
    colours: { w: '#f7f3e8', k: '#c4b48a', r: '#cc3b3b' },
  },
}

// Drawing ------------------------------------------------------------------------------------

/** Draws the bird the traits describe, the same every time. */
export function drawAvatar(traits: AvatarTraits): AvatarPixels {
  const pixels: string[] = new Array(AVATAR_SIZE * AVATAR_SIZE)
  const put = (x: number, y: number, colour: string) => {
    if (x >= 0 && y >= 0 && x < AVATAR_SIZE && y < AVATAR_SIZE) pixels[y * AVATAR_SIZE + x] = colour
  }

  // The tile: a gradient in four bands, dithered where the bands meet, with a pattern over it.
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

  // A soft shadow down and to the right, as XP icons have.
  for (let y = 0; y < AVATAR_SIZE; y++) {
    for (let x = 0; x < AVATAR_SIZE; x++) {
      if (inBird(x - 1, y - 1) && !inBird(x, y))
        put(x, y, darken(pixels[y * AVATAR_SIZE + x] ?? top, 0.3))
    }
  }

  // The bird: plumage lit from the upper left, outlined in a darker shade of itself.
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
        colour = '#f1f1ee'
      }
      if (inWing(x, y) && !inHead(x, y)) {
        colour = colour === '#f1f1ee' ? colour : wingBase
        // Two bars that follow the wing's curve, as a rock pigeon's do.
        const curve = Math.round((x - 10) ** 2 / 40)
        if (traits.wing === 'barred' && x >= 5 && x <= 15 && (y === 24 + curve || y === 27 + curve))
          colour = bar
        if (traits.wing === 'checkered' && (x + 2 * y) % 4 === 0 && (y + (x >> 2)) % 2 === 0)
          colour = bar
        if (traits.wing === 'white-tipped' && x <= 4 + Math.max(0, y - 25)) colour = '#f1f1ee'
      }
      if (neck !== undefined && inNeck(x, y) && !inWing(x, y) && y >= 14 && y <= 21 && x >= 13) {
        // A sheen on the neck, not a band across the chest: it fades in under the head and out
        // above the chest, the first colour above and the second below, dithered where they meet.
        const bayer = [0, 2, 3, 1][(x % 2) + 2 * (y % 2)] ?? 0
        const strength = y <= 15 ? (y - 13) / 3 : y >= 20 ? (22 - y) / 3 : 1
        const lower = y + bayer / 2 > 18
        if (bayer / 4 < strength) colour = mix(colour, lower ? neck[1] : neck[0], 0.45)
      }
      if (traits.plumage === 'grizzle' && (x * 7 + y * 11) % 5 === 0) colour = '#f1f1ee'
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
    stamp(
      put,
      { x: 14, y: 3, rows: ['.oo..', 'obbo.', '.obbo'] },
      { o: outline, b: lighten(base, 0.15) },
    )
  }

  // Face: the cere above the beak, the beak, the eye.
  const beak = traits.beak === 'pink' ? '#e7a1a1' : '#4a3f3a'
  stamp(
    put,
    { x: 25, y: 11, rows: ['ww..', 'bbbt', 'bbb.'] },
    { w: '#efe7dc', b: beak, t: darken(beak, 0.3) },
  )
  if (traits.beak === 'long') {
    put(28, 12, darken(beak, 0.3))
    put(29, 12, darken(beak, 0.45))
  }
  stamp(
    put,
    { x: 21, y: 9, rows: ['.oo.', 'ohio', 'oiko', '.oo.'] },
    {
      o: darken(base, 0.5),
      h: '#ffffff',
      i: EYE_COLOURS[traits.eye],
      k: '#141414',
    },
  )

  if (traits.accessory !== 'none') {
    const { sprite, colours } = ACCESSORY_SPRITES[traits.accessory]
    stamp(put, sprite, colours)
  }
  return pixels
}

/** The picture as an SVG, one `rect` per run of a colour along a row, sharp at any size. */
export function avatarSvg(pixels: AvatarPixels, size = AVATAR_SIZE, title?: string): string {
  const rects: string[] = []
  for (let y = 0; y < AVATAR_SIZE; y++) {
    let x = 0
    while (x < AVATAR_SIZE) {
      const colour = pixels[y * AVATAR_SIZE + x]
      let run = 1
      while (x + run < AVATAR_SIZE && pixels[y * AVATAR_SIZE + x + run] === colour) run++
      rects.push(`<rect x="${x}" y="${y}" width="${run}" height="1" fill="${colour}"/>`)
      x += run
    }
  }
  const label =
    title === undefined ? ' aria-hidden="true"' : ` role="img"><title>${escapeXml(title)}</title`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${AVATAR_SIZE} ${AVATAR_SIZE}" width="${size}" height="${size}" shape-rendering="crispEdges"${label}>${rects.join('')}</svg>`
}

const escapeXml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** "A slate pigeon with a copper neck, wearing a flat cap": for alt text and the profile. */
export function describeAvatar(traits: AvatarTraits): string {
  const neck = traits.neck === 'plain' ? '' : ` with a ${traits.neck} neck`
  const plural = /phones|glasses$/.test(traits.accessory)
  const wearing =
    traits.accessory === 'none'
      ? ''
      : traits.accessory === 'letter'
        ? ', carrying a letter'
        : `, wearing ${plural ? '' : `${article(traits.accessory)} `}${traits.accessory}`
  return `${article(traits.plumage, true)} ${traits.plumage} pigeon${neck}${wearing}`
}

const article = (word: string, capital = false) => {
  const a = /^[aeiou]/.test(word) ? 'an' : 'a'
  return capital ? a[0]?.toUpperCase() + a.slice(1) : a
}
