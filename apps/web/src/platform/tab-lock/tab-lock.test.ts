import { flush } from '@pigeon/core'
import { describe, expect, it } from 'vitest'
import { type Channel, createTabLock, type Locks } from './tab-lock.ts'

/** One browser: a lock manager and a channel every tab shares. */
function fakeBrowser() {
  let held = false
  const waiting: (() => void)[] = []
  const locks: Locks = {
    async request(_name, options, callback) {
      if (held && options.ifAvailable === true) return callback(null)
      if (held) await new Promise<void>((resolve) => waiting.push(resolve))
      held = true
      await callback({})
      held = false
      waiting.shift()?.()
    },
  }
  const channels: Channel[] = []
  const channel = (): Channel => {
    const own: Channel = {
      onmessage: null,
      postMessage(message) {
        for (const other of channels)
          if (other !== own) queueMicrotask(() => other.onmessage?.({ data: message }))
      },
    }
    channels.push(own)
    return own
  }
  return { locks, channel }
}

describe('one tab at a time', () => {
  it('lets the first tab run, tells the second, and hands over when asked', async () => {
    const browser = fakeBrowser()
    const lost: string[] = []
    const tab = (name: string) =>
      createTabLock({
        locks: browser.locks,
        channel: browser.channel(),
        onLost: async () => void lost.push(name),
      })
    const first = tab('first')
    const second = tab('second')
    expect(await first.tryHold()).toBe(true)
    expect(await second.tryHold()).toBe(false)
    await second.takeOver()
    expect(lost).toEqual(['first'])
    expect(await first.tryHold()).toBe(false)
    // And back again.
    await first.takeOver()
    await flush()
    expect(lost).toEqual(['first', 'second'])
  })

  it('runs every tab where the browser has no Web Locks', async () => {
    const lock = createTabLock({ locks: undefined, channel: undefined, onLost: async () => {} })
    expect(await lock.tryHold()).toBe(true)
  })
})
