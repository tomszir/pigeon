import { emptyDeviceLog, fakeSigner, type LighthouseAddress } from '@pigeon/core'
import { describe, expect, it } from 'vitest'
import { readSelfNews, selfNewsBody } from './self-mail.ts'

const rook = fakeSigner('rook').id
const address: LighthouseAddress = { id: fakeSigner('lh').id, name: 'Loft', url: 'wss://lh.test/' }

describe('self mail', () => {
  it('reads back what it wrote', () => {
    const news = {
      log: emptyDeviceLog(rook),
      keys: [],
      profile: { handle: 'Rook', message: 'hi', changedAt: 5 },
      lighthouses: { list: [address], changedAt: 7 },
    }
    expect(readSelfNews(rook, selfNewsBody(news))).toEqual(news)
  })

  it('takes nothing without a device log of your own identity', () => {
    expect(readSelfNews(rook, { keys: [] })).toBeUndefined()
    expect(readSelfNews(rook, { log: emptyDeviceLog(fakeSigner('mika').id), keys: [] })).toBe(
      undefined,
    )
    expect(readSelfNews(rook, [])).toBeUndefined()
  })

  it('leaves out a part that doesn’t hold, and keeps the rest', () => {
    const read = readSelfNews(rook, {
      log: emptyDeviceLog(rook),
      keys: [{ device: 1 }],
      profile: { handle: '  ', message: '', changedAt: 5 },
      lighthouses: { list: [address, address, address, address, address], changedAt: 7 },
    })
    expect(read).toEqual({
      log: emptyDeviceLog(rook),
      keys: [],
      profile: undefined,
      lighthouses: undefined,
    })
  })
})
