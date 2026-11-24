import { describe, expect, it } from 'vitest'
import { appendDeviceEntry, deviceState, emptyDeviceLog } from '../devices/device-log.ts'
import { fingerprint } from '../identity/identity.ts'
import { createMemoryNetwork, fakeCrypto, fakeSigner, flush } from '../testing/testing.ts'
import { decodeDeviceLink, decodeInvite, encodeDeviceLink } from './invite.ts'
import { hostLink, type LinkRequest, linkCheck, openLink } from './link.ts'

const laptop = fakeSigner('toms-laptop')
const phone = fakeSigner('toms-phone')
const code = 'k7rtvp2b'
const never = new Promise<void>(() => undefined)
const common = { crypto: fakeCrypto, now: () => 0 }

describe('linking a device', () => {
  it('shows the same check on both, and hands over the bundle once confirmed', async () => {
    const network = createMemoryNetwork()
    const requests: LinkRequest[] = []
    await hostLink({
      ...common,
      signer: laptop,
      transport: network.transport(),
      code,
      handle: 'Toms',
      sleep: () => never,
      onRequest: (request) => requests.push(request),
    })
    const opened = await openLink({
      ...common,
      signer: phone,
      transport: network.transport(),
      code,
      fingerprint: await fingerprint(fakeCrypto, laptop.id),
      until: never,
    })
    if (!opened.ok) throw new Error(opened.error)
    await flush()
    const request = requests[0]
    if (request === undefined) throw new Error('no request')
    expect(opened.offer).toMatchObject({ identity: laptop.id, handle: 'Toms' })
    expect(request.device).toBe(phone.id)
    expect(request.check).toMatch(/^\d{3} \d{3}$/)
    expect(opened.offer.check).toBe(request.check)

    const waiting = opened.offer.accepted(never)
    await request.accept({ hello: 'phone' })
    expect(await waiting).toEqual({ hello: 'phone' })
  })

  it('refuses an answer from someone other than the link’s identity', async () => {
    const network = createMemoryNetwork()
    const thief = fakeSigner('thief')
    await hostLink({
      ...common,
      signer: thief,
      transport: network.transport(),
      code,
      handle: 'Toms',
      sleep: () => never,
      onRequest: () => undefined,
    })
    let stop: () => void = () => undefined
    const until = new Promise<void>((resolve) => {
      stop = resolve
    })
    const opened = openLink({
      ...common,
      signer: phone,
      transport: network.transport(),
      code,
      fingerprint: await fingerprint(fakeCrypto, laptop.id),
      until,
    })
    await flush()
    stop()
    expect(await opened).toEqual({ ok: false, error: 'impostor' })
  })

  it('answers for the identity from a second device', async () => {
    const network = createMemoryNetwork()
    const added = await appendDeviceEntry(
      fakeCrypto,
      emptyDeviceLog(laptop.id),
      laptop,
      { kind: 'add', device: phone.id, name: 'Phone' },
      1,
    )
    if (!added.ok) throw new Error(added.error)
    expect(deviceState(added.log).active.has(phone.id)).toBe(true)
    const tablet = fakeSigner('toms-tablet')
    await hostLink({
      ...common,
      signer: phone,
      transport: network.transport(),
      code,
      handle: 'Toms',
      speaker: () => ({ identity: laptop.id, devices: added.log }),
      sleep: () => never,
      onRequest: () => undefined,
    })
    const opened = await openLink({
      ...common,
      signer: tablet,
      transport: network.transport(),
      code,
      fingerprint: await fingerprint(fakeCrypto, laptop.id),
      until: never,
    })
    if (!opened.ok) throw new Error(opened.error)
    expect(opened.offer.identity).toBe(laptop.id)
  })

  it('reads device links apart from invites', async () => {
    const print = await fingerprint(fakeCrypto, laptop.id)
    const link = `https://pigeon.test/#${encodeDeviceLink(code, print)}`
    expect(decodeDeviceLink(link)).toEqual({ ok: true, value: { code, fingerprint: print } })
    expect(decodeInvite(link).ok).toBe(false)
    expect(await linkCheck(fakeCrypto, code, laptop.id, phone.id)).not.toBe(
      await linkCheck(fakeCrypto, code, laptop.id, fakeSigner('other').id),
    )
  })
})
