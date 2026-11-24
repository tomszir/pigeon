// Where two friends meet (decision 0026). Pairing gives them a 256-bit secret only they hold;
// their room is named from it and the UTC date, so it changes every day, and it's locked with a
// password derived from it. Friends from before the secret meet in the old room named from both
// ids until they've moved (docs/protocol.md, "Rooms").
import { base32Decode, base32Encode, concatBytes, utf8Encode } from '../encoding/bytes.ts'
import type { Crypto } from '../identity/crypto.ts'
import type { RoomName } from '../transport/transport.ts'

export const PAIR_SECRET_BYTES = 32
const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

/** A pair secret as it travels and is stored: 52 base32 characters. */
export const encodePairSecret = (secret: Uint8Array): string => base32Encode(secret)

export function isPairSecret(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const bytes = base32Decode(value)
  return bytes.ok && bytes.value.length === PAIR_SECRET_BYTES && base32Encode(bytes.value) === value
}

const secretBytes = (secret: string): Uint8Array => {
  const bytes = base32Decode(secret)
  if (!bytes.ok) throw new Error('not a pair secret')
  return bytes.value
}

/** "2026-11-24": the UTC day `ms` falls on. */
export const utcDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10)

/** The room for one UTC day: `pair:<base32 HMAC-SHA256(secret, "pigeon/pair/v2/" + day)>`. */
export async function pairRoomOn(
  crypto: Crypto,
  secret: string,
  day: string,
): Promise<`pair:${string}`> {
  const mac = await crypto.hmacSha256(secretBytes(secret), utf8Encode(`pigeon/pair/v2/${day}`))
  return `pair:${base32Encode(mac)}`
}

/**
 * The room's Trystero password: HKDF-SHA256 of the secret with info `pigeon/pair/password`,
 * no salt, 32 bytes (RFC 5869), as base32.
 */
export const pairPassword = (crypto: Crypto, secret: string): Promise<string> =>
  derivePassword(crypto, secret, 'pigeon/pair/password')

async function derivePassword(crypto: Crypto, secret: string, info: string): Promise<string> {
  const prk = await crypto.hmacSha256(new Uint8Array(32), secretBytes(secret))
  const okm = await crypto.hmacSha256(prk, concatBytes(utf8Encode(info), new Uint8Array([1])))
  return base32Encode(okm)
}

/**
 * Where your own devices meet (decision 0024): named and locked like a pair room, from a self
 * secret only your devices hold, with the `self` prefix and `pigeon/self/v1/` and
 * `pigeon/self/password` in place of the pair's. Device logs travel here until M8's self space.
 */
export async function selfRoomsAt(
  crypto: Crypto,
  secret: string,
  now: number,
): Promise<readonly PairRoomSpec[]> {
  const password = await derivePassword(crypto, secret, 'pigeon/self/password')
  return Promise.all(
    pairDaysAt(now).map(async (day) => {
      const mac = await crypto.hmacSha256(secretBytes(secret), utf8Encode(`pigeon/self/v1/${day}`))
      return { name: `self:${base32Encode(mac)}` as RoomName, password }
    }),
  )
}

/**
 * The days whose rooms to be in at `now`: today, and around midnight the neighbouring day too
 * (the last hour of a day joins tomorrow's, the first hour yesterday's), so friends whose clocks
 * are a little apart still meet.
 */
export function pairDaysAt(now: number): readonly string[] {
  const hour = new Date(now).getUTCHours()
  if (hour === 23) return [utcDay(now), utcDay(now + DAY_MS)]
  if (hour === 0) return [utcDay(now - DAY_MS), utcDay(now)]
  return [utcDay(now)]
}

/** Milliseconds from `now` until the set of days changes: 23:00, 00:00 or 01:00 UTC. */
export function untilPairDaysChange(now: number): number {
  const intoDay = now % DAY_MS
  const changes = [0, HOUR_MS, 23 * HOUR_MS, DAY_MS]
  const next = changes.find((at) => at > intoDay) ?? DAY_MS
  return next - intoDay
}

/** A room to join and how. */
export interface PairRoomSpec {
  readonly name: RoomName
  readonly password?: string
}

export interface PairPlace {
  /** The old room named from both ids (`pairRoom`), which is also the chat's id. */
  readonly legacy: `pair:${string}`
  readonly secret?: string | undefined
  /** Both sides hold the secret: the old room is no longer used. */
  readonly moved?: boolean | undefined
}

/**
 * The rooms to be in for one friend at `now`: the old room until you've moved, and the secret's
 * rooms once you have a secret.
 */
export async function pairRoomsAt(
  crypto: Crypto,
  place: PairPlace,
  now: number,
): Promise<readonly PairRoomSpec[]> {
  const { secret } = place
  if (secret === undefined) return [{ name: place.legacy }]
  const legacy: PairRoomSpec[] = place.moved === true ? [] : [{ name: place.legacy }]
  const password = await pairPassword(crypto, secret)
  const daily = await Promise.all(
    pairDaysAt(now).map(async (day) => ({
      name: await pairRoomOn(crypto, secret, day),
      password,
    })),
  )
  return [...legacy, ...daily]
}
