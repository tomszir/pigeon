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
  begin,
  consider,
  fetchSecrets,
  heardFrom,
  mailSecret,
  needsReplacing,
  priorWinner,
  propose,
  roomSecrets,
  type SecretState,
  settle,
  winner,
} from './rekeys.ts'

const OLD = 'a'.repeat(52)
const S1 = `${'b'.repeat(51)}a`
const S2 = `${'c'.repeat(51)}a`
const S3 = `${'d'.repeat(51)}a`
const S4 = `${'e'.repeat(51)}a`
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

describe('a new round after a removal', () => {
  /** Rook and Mika, settled on S1 in a round that replaced OLD, as both of them keep it. */
  async function settledOnS1(): Promise<SecretState> {
    const { next } = await propose(fakeCrypto, signerOf(rook), { secret: OLD }, S1, 10)
    return settle(heardFrom(next, mika, 20) as SecretState, [mika]) as SecretState
  }
  /** A proposal for a new round from `from`, as `by` signs it. */
  const fromSecret = async (from: string, secret: string, at: number, by = rook) =>
    signRekey(signerOf(by), { replaces: await replacesId(fakeCrypto, from), secret, at })

  it('begins a round for the secret held now, keeping the one before', async () => {
    const before = { ...(await settledOnS1()), renew: true }
    const { rekey, next } = await begin(fakeCrypto, signerOf(rook), before, S2, 100)
    // It names S1, not OLD, so it doesn't lose to S1 in the round S1 won.
    expect(rekey).toEqual(await fromSecret(S1, S2, 100))
    expect(next.secret).toBe(S2)
    expect(next.replacing).toEqual({ old: S1, at: 100, by: rook, sig: rekey.sig })
    expect(next.prior).toEqual(before.replacing)
    expect(next.renew).toBeUndefined()
    // Mika is on S1: its rooms and tags until she's seen with S2, and OLD's tags looked under
    // for a device still in that round.
    expect(mailSecret(next)).toBe(S1)
    expect(roomSecrets(next)).toEqual([S2, S1])
    expect(fetchSecrets(next)).toEqual([S2, S1, OLD])
    // Sent with S1's own proposal, so a device that never took S1 can follow.
    expect(await priorWinner(fakeCrypto, next)).toEqual(await proposal(S1, 10))
    const seen = settle(heardFrom(next, mika, 110) as SecretState, [mika]) as SecretState
    expect(fetchSecrets(seen)).toEqual([S2])
    expect(seen.prior).toEqual(before.replacing)
  })

  it('keeps the round before’s rooms too while that one wasn’t seen either', async () => {
    // Rook proposed S1 for OLD and nobody was seen with it yet; then a device was removed.
    const { next: unseen } = await propose(fakeCrypto, signerOf(rook), { secret: OLD }, S1, 10)
    const { next } = await begin(fakeCrypto, signerOf(rook), unseen, S2, 100)
    expect(mailSecret(next)).toBe(OLD)
    expect(roomSecrets(next)).toEqual([S2, S1, OLD])
  })

  it('takes a new round that names the secret it holds, from the other side or a copy', async () => {
    const theirs = await fromSecret(S1, S2, 100, mika)
    const step = await consider(fakeCrypto, await settledOnS1(), theirs, fromMika, 120, everyone)
    expect(step).toMatchObject({ changed: true, answer: false })
    const next = step.next as SecretState
    expect(next.secret).toBe(S2)
    expect(next.replacing).toEqual({
      old: S1,
      at: 100,
      by: mika,
      sig: theirs.sig,
      heardAt: 120,
      heard: [mika],
    })
    expect(next.prior?.old).toBe(OLD)
    expect(roomSecrets(next)).toEqual([S2])
    // From another of Rook's devices: Mika isn't known to hold it, so S1's rooms are kept, even
    // though the round before had settled.
    const copy = { other: false, device: rookPhone }
    const mine = await consider(
      fakeCrypto,
      await settledOnS1(),
      await fromSecret(S1, S2, 100, rookPhone),
      copy,
      120,
      everyone,
    )
    expect(roomSecrets(mine.next as SecretState)).toEqual([S2, S1])
    expect(mailSecret(mine.next as SecretState)).toBe(S1)
  })

  it('never takes a new round from a device taken off its list', async () => {
    const step = await consider(
      fakeCrypto,
      await settledOnS1(),
      await fromSecret(S1, S2, 100, lost),
      fromMika,
      120,
      notLost,
    )
    expect(step).toEqual({ answer: false, changed: false })
  })

  it('still takes a winner for the round under way, keeping the round before', async () => {
    const { next: mine } = await begin(fakeCrypto, signerOf(rook), await settledOnS1(), S3, 100)
    const earlier = await fromSecret(S1, S2, 90, mika)
    const step = await consider(fakeCrypto, mine, earlier, fromMika, 120, everyone)
    expect(step.changed).toBe(true)
    expect(step.next?.secret).toBe(S2)
    expect(step.next?.prior).toEqual(mine.prior)
  })

  it('keeps a mark to renew through a proposal taken meanwhile', async () => {
    const marked = { ...(await settledOnS1()), renew: true }
    const step = await consider(
      fakeCrypto,
      marked,
      await fromSecret(S1, S2, 100, mika),
      fromMika,
      120,
      everyone,
    )
    // Mika's round may have been sealed to a device she didn't know Rook had removed.
    expect(step.next?.renew).toBe(true)
  })

  it('answers a device still in the round before with where it went, under its tags', async () => {
    const { next } = await begin(fakeCrypto, signerOf(rook), await settledOnS1(), S2, 100)
    // Mika's tablet was away, and only now proposes S3 for OLD.
    const behind = await proposal(S3, 5, mikaTablet)
    const step = await consider(fakeCrypto, next, behind, fromMika, 120, everyone)
    expect(step).toEqual({ answer: true, changed: false, under: [S3] })
  })

  it('follows a new round shown with the proposal it began from, whatever won here', async () => {
    // Mika's tablet took S3 for OLD, which lost everywhere else to S1; it never saw S1 win.
    const { next: tablet } = await propose(fakeCrypto, signerOf(mikaTablet), { secret: OLD }, S3, 5)
    const s1 = await proposal(S1, 10)
    const s2 = await fromSecret(S1, S2, 100)
    // Without the proposal it began from, a round from S1 means nothing here.
    expect(await consider(fakeCrypto, tablet, s2, fromRook, 120, everyone)).toEqual({
      answer: false,
      changed: false,
    })
    const step = await consider(fakeCrypto, tablet, s2, fromRook, 120, everyone, s1)
    expect(step.changed).toBe(true)
    const next = step.next as SecretState
    expect(next.secret).toBe(S2)
    expect(next.replacing).toMatchObject({ old: S1, by: rook, at: 100, heardAt: 120 })
    expect(next.prior).toMatchObject({ old: OLD, by: rook, at: 10, sig: s1.sig })
    expect(await priorWinner(fakeCrypto, next)).toEqual(s1)
    // A forged proposal to begin from counts for nothing.
    const forged = { ...s1, by: mika }
    expect(
      (await consider(fakeCrypto, tablet, s2, fromRook, 120, everyone, forged)).next,
    ).toBeUndefined()
  })

  it('begins again when it takes a winner from before the removal was heard of', async () => {
    const { next: mine } = await begin(fakeCrypto, signerOf(rook), await settledOnS1(), S2, 100)
    expect(mine.begun).toBe(S2)
    // Mika proposed for S1 too, earlier by her clock, before she knew Rook's phone was gone.
    const hers = await fromSecret(S1, S3, 90, mika)
    const step = await consider(fakeCrypto, mine, hers, fromMika, 120, everyone)
    expect(step.next?.secret).toBe(S3)
    expect(step.next?.renew).toBe(true)
    expect(step.next?.begun).toBeUndefined()
    // Beginning again starts from S3, the winner, which the removed phone may know.
    const again = await begin(fakeCrypto, signerOf(rook), step.next as SecretState, S4, 130)
    expect(again.rekey.replaces).toBe(await replacesId(fakeCrypto, S3))
    expect(again.next.begun).toBe(S4)
  })

  it('takes a round begun from its own proposal as it is, and stops watching', async () => {
    const { next: mine } = await begin(fakeCrypto, signerOf(rook), await settledOnS1(), S2, 100)
    const step = await consider(
      fakeCrypto,
      mine,
      await fromSecret(S2, S3, 110, mika),
      fromMika,
      120,
      everyone,
    )
    expect(step.next?.secret).toBe(S3)
    expect(step.next?.renew).toBeUndefined()
    expect(step.next?.begun).toBeUndefined()
    // Hearing its own winner back changes nothing.
    const echo = await consider(
      fakeCrypto,
      mine,
      await fromSecret(S1, S2, 100),
      fromMika,
      120,
      everyone,
    )
    expect(echo.next?.begun).toBe(S2)
    expect(echo.next?.renew).toBeUndefined()
  })

  it('begins again when a round shown by its prior began from another proposal', async () => {
    const { next: mine } = await begin(fakeCrypto, signerOf(rook), await settledOnS1(), S2, 100)
    // Mika's S3 for S1, and a round from it: whatever its time, it didn't begin from S2.
    const s3 = await fromSecret(S1, S3, 150, mika)
    const step = await consider(
      fakeCrypto,
      mine,
      await fromSecret(S3, S4, 160, mika),
      fromMika,
      170,
      everyone,
      s3,
    )
    expect(step.next?.secret).toBe(S4)
    expect(step.next?.renew).toBe(true)
  })

  it('settles rival new rounds begun from different winners on the earliest', async () => {
    // Before S1 had won everywhere, Rook began a round from S1 and Mika one from S3.
    const s1 = await proposal(S1, 10)
    const s3 = await proposal(S3, 5, mika)
    const rookSide = (await begin(fakeCrypto, signerOf(rook), await settledOnS1(), S2, 100)).next
    const { next: mikaS3 } = await propose(fakeCrypto, signerOf(mika), { secret: OLD }, S3, 5)
    const mikaSide = (await begin(fakeCrypto, signerOf(mika), mikaS3, S4, 90)).next
    const rookRound = (await winner(fakeCrypto, rookSide)) as Rekey
    const mikaRound = (await winner(fakeCrypto, mikaSide)) as Rekey
    const here = await consider(fakeCrypto, rookSide, mikaRound, fromMika, 120, everyone, s3)
    const there = await consider(fakeCrypto, mikaSide, rookRound, fromRook, 120, everyone, s1)
    // Mika's began earlier: Rook takes it, Mika answers with it.
    expect(here.changed).toBe(true)
    expect(here.next?.secret).toBe(S4)
    expect(here.next?.replacing?.old).toBe(S3)
    expect(await priorWinner(fakeCrypto, here.next as SecretState)).toEqual(s3)
    expect(there).toEqual({ answer: true, changed: false })
  })
})
