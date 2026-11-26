import {
  fakeCrypto,
  fakeSigner,
  type Rekey,
  replacesId,
  type Signer,
  signRekey,
} from '@pigeon/core'
import { describe, expect, it } from 'vitest'
import {
  consider,
  fetchSecrets,
  heardFrom,
  mailSecret,
  needsReplacing,
  propose,
  roomSecrets,
  type SecretState,
  settle,
} from './rekeys.ts'

const OLD = 'a'.repeat(52)
const S1 = `${'b'.repeat(51)}a`
const S2 = `${'c'.repeat(51)}a`
const rook = fakeSigner('rook').id
const rookPhone = fakeSigner('rook-phone').id
const mika = fakeSigner('mika').id
const mikaTablet = fakeSigner('mika-tablet').id
const lost = fakeSigner('lost').id

const signers = new Map<string, Signer>(
  ['rook', 'rook-phone', 'mika', 'mika-tablet', 'lost'].map((name) => {
    const signer = fakeSigner(name)
    return [signer.id, signer]
  }),
)
const signerOf = (id: string): Signer => {
  const signer = signers.get(id)
  if (signer === undefined) throw new Error('no such signer')
  return signer
}
/** A proposal as `by` signs it. */
const proposal = async (secret: string, at: number, by = rook): Promise<Rekey> =>
  signRekey(signerOf(by), { replaces: await replacesId(fakeCrypto, OLD), secret, at })
const fromMika = { other: true, device: mika }
const fromRook = { other: true, device: rook }
const everyone = () => true
const notLost = (device: string) => device !== lost

describe('replacing a secret from before', () => {
  it('proposes once, keeping the old rooms and mail until the other side is seen', async () => {
    const before: SecretState = { secret: OLD }
    expect(needsReplacing(before)).toBe(true)
    const { rekey, next } = await propose(fakeCrypto, signerOf(rook), before, S1, 10)
    expect(rekey).toEqual(await proposal(S1, 10))
    expect(needsReplacing(next)).toBe(false)
    expect(mailSecret(next)).toBe(OLD)
    expect(roomSecrets(next)).toEqual([S1, OLD])
    expect(fetchSecrets(next)).toEqual([S1, OLD])
  })

  it('takes a friend’s proposal, then leaves the old rooms but not the old mail', async () => {
    const theirs = await proposal(S1, 10, mika)
    const step = await consider(fakeCrypto, { secret: OLD }, theirs, fromMika, 20, everyone)
    expect(step).toMatchObject({ answer: false, changed: true })
    // Kept with Mika's signature, so it can be sent on as hers.
    expect(step.next).toEqual({
      secret: S1,
      sealed: true,
      replacing: { old: OLD, at: 10, by: mika, sig: theirs.sig, heardAt: 20, heard: [mika] },
    })
    const next = step.next as SecretState
    expect(mailSecret(next)).toBe(S1)
    expect(roomSecrets(next)).toEqual([S1])
    expect(fetchSecrets(next)).toEqual([S1, OLD])
  })

  it('lets the old secret go only once every device on the other side holds the new', async () => {
    const { next } = await propose(fakeCrypto, signerOf(rook), { secret: OLD }, S1, 10)
    const one = heardFrom(next, mika, 20) as SecretState
    expect(one.replacing?.heardAt).toBe(20)
    expect(settle(one, [mika, mikaTablet])).toBeUndefined()
    const both = heardFrom(one, mikaTablet, 30) as SecretState
    expect(both.replacing?.heardAt).toBe(20)
    expect(heardFrom(both, mika, 40)).toBeUndefined()
    const settled = settle(both, [mika, mikaTablet]) as SecretState
    expect(settled.replacing?.settled).toBe(true)
    expect(fetchSecrets(settled)).toEqual([S1])
    expect(settle(settled, [mika, mikaTablet])).toBeUndefined()
    // A device taken off their list no longer holds it back.
    expect(settle(one, [mika])?.replacing?.settled).toBe(true)
  })

  it('settles two proposals made at once on the same one, whichever comes first', async () => {
    const mine = (await propose(fakeCrypto, signerOf(rook), { secret: OLD }, S1, 10)).next
    const theirs = (await propose(fakeCrypto, signerOf(mika), { secret: OLD }, S2, 10)).next
    const here = await consider(
      fakeCrypto,
      mine,
      await proposal(S2, 10, mika),
      fromMika,
      11,
      everyone,
    )
    const there = await consider(fakeCrypto, theirs, await proposal(S1, 10), fromRook, 11, everyone)
    const end = (state: SecretState, step: { next?: SecretState }) => (step.next ?? state).secret
    expect(end(mine, here)).toBe(end(theirs, there))
    // One side's lost and is answered with the winner; the other takes it and tells everyone.
    expect([here.answer, there.answer].filter(Boolean)).toHaveLength(1)
    expect([here.changed, there.changed].filter(Boolean)).toHaveLength(1)
  })

  it('hears its own winner back and stops waiting, saying nothing', async () => {
    const { next } = await propose(fakeCrypto, signerOf(rook), { secret: OLD }, S1, 10)
    const echo = await consider(fakeCrypto, next, await proposal(S1, 10), fromMika, 30, everyone)
    expect(echo).toMatchObject({ answer: false, changed: false })
    expect(echo.next?.replacing?.heard).toEqual([mika])
    // A copy from your own other device says nothing about the friend.
    const copy = { other: false, device: rookPhone }
    const kept = await consider(fakeCrypto, next, await proposal(S1, 10), copy, 30, everyone)
    expect(kept).toEqual({ answer: false, changed: false })
  })

  it('takes a winning copy from your own device and tells both sides', async () => {
    const { next } = await propose(fakeCrypto, signerOf(rook), { secret: OLD }, S2, 20)
    const copy = { other: false, device: rookPhone }
    const step = await consider(
      fakeCrypto,
      next,
      await proposal(S1, 10, rookPhone),
      copy,
      30,
      everyone,
    )
    expect(step).toMatchObject({ changed: true, answer: false })
    expect(step.next?.secret).toBe(S1)
    // Not heard from the friend: the old rooms are kept.
    expect(step.next?.replacing?.heardAt).toBeUndefined()
  })

  it('never lets a device taken off its list choose the secret', async () => {
    // A removed device proposes as early as it likes; it doesn't count, so ours is sent back.
    const { next } = await propose(fakeCrypto, signerOf(rook), { secret: OLD }, S1, 10)
    const early = await proposal(S2, 0, lost)
    const step = await consider(fakeCrypto, next, early, fromMika, 30, notLost)
    expect(step).toEqual({ answer: true, changed: false })
    // A winner taken from it before the removal was known gives way to any that counts.
    const taken = (await consider(fakeCrypto, { secret: OLD }, early, fromMika, 5, everyone))
      .next as SecretState
    const later = await consider(fakeCrypto, taken, await proposal(S1, 10), fromMika, 30, notLost)
    expect(later.next?.secret).toBe(S1)
    expect(later.changed).toBe(true)
  })

  it('ignores a proposal for some other secret', async () => {
    const other: Rekey = { ...(await proposal(S1, 1)), replaces: await replacesId(fakeCrypto, S2) }
    const nothing = { answer: false, changed: false }
    expect(await consider(fakeCrypto, { secret: OLD }, other, fromMika, 5, everyone)).toEqual(
      nothing,
    )
    const { next } = await propose(fakeCrypto, signerOf(rook), { secret: OLD }, S1, 10)
    expect(await consider(fakeCrypto, next, other, fromMika, 5, everyone)).toEqual(nothing)
  })

  it('takes a proposal even for a secret it holds as sealed, so the other side can move', async () => {
    const step = await consider(
      fakeCrypto,
      { secret: OLD, sealed: true },
      await proposal(S1, 10, mika),
      fromMika,
      12,
      everyone,
    )
    expect(step.next?.secret).toBe(S1)
    expect(step.changed).toBe(true)
  })

  it('never takes the old secret as its own replacement', async () => {
    const { next } = await propose(fakeCrypto, signerOf(mika), { secret: OLD }, S1, 10)
    const step = await consider(fakeCrypto, next, await proposal(OLD, 1), fromRook, 11, everyone)
    expect(step).toEqual({ answer: false, changed: false })
    const fresh = await consider(
      fakeCrypto,
      { secret: OLD },
      await proposal(OLD, 1),
      fromRook,
      11,
      everyone,
    )
    expect(fresh.next).toBeUndefined()
  })

  it('moves a settled device to a later winner without going back to the old rooms', async () => {
    const { next } = await propose(fakeCrypto, signerOf(rook), { secret: OLD }, S2, 20)
    const seen = heardFrom(next, mika, 30) as SecretState
    const settled = settle(seen, [mika]) as SecretState
    // A copy of an earlier proposal, from another of Rook's devices whose letter was held up.
    const copy = { other: false, device: rookPhone }
    const step = await consider(
      fakeCrypto,
      settled,
      await proposal(S1, 10, rookPhone),
      copy,
      40,
      everyone,
    )
    expect(step.changed).toBe(true)
    const moved = step.next as SecretState
    expect(moved.secret).toBe(S1)
    expect(moved.replacing?.settled).toBeUndefined()
    expect(roomSecrets(moved)).toEqual([S1])
    expect(mailSecret(moved)).toBe(S1)
    // Still looked for under the old secret until Mika is seen holding S1.
    expect(fetchSecrets(moved)).toEqual([S1, OLD])
    expect(settle(moved, [mika])).toBeUndefined()
  })
})
