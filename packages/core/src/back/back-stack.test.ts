import { describe, expect, it } from 'vitest'
import { type BackStack, createBackStack } from './back-stack.ts'

/**
 * A browser's history: entries with the depth Pigeon marked them at (undefined for none), and
 * moves that land later, as `history.go` does, when `land()` is called.
 */
function fakeBrowser() {
  const entries: (number | undefined)[] = [0]
  let index = 0
  const moves: number[] = []
  let stack: BackStack | undefined
  let left = false
  const browser = {
    port: {
      push: (depth: number) => {
        entries.splice(index + 1, entries.length, depth)
        index++
      },
      go: (delta: number) => {
        moves.push(delta)
      },
      mark: (depth: number) => {
        entries[index] = depth
      },
    },
    attach: (attached: BackStack) => {
      stack = attached
    },
    /** Lands every move on its way, and those the landings start. */
    land: () => {
      while (moves.length > 0) {
        const delta = moves.shift() ?? 0
        if (index + delta < 0) {
          left = true
          return
        }
        index = Math.min(entries.length - 1, index + delta)
        stack?.moved(entries[index])
      }
    },
    /** The browser's own Back button: one move, landed at once. */
    back: () => {
      if (index === 0) return 'left'
      index--
      stack?.moved(entries[index])
      browser.land()
      return left ? 'left' : 'stayed'
    },
    /** A jump through the history menu, `delta` entries at once. */
    jump: (delta: number) => {
      index += delta
      stack?.moved(entries[index])
      browser.land()
    },
    forward: () => {
      if (index === entries.length - 1) return
      index++
      stack?.moved(entries[index])
      browser.land()
    },
    /** Following a link to `#i/...`: a new entry Pigeon didn't mark. */
    openHash: () => {
      entries.splice(index + 1, entries.length, undefined)
      index++
      stack?.moved(undefined)
      browser.land()
    },
    length: () => index,
  }
  return browser
}

function setUp() {
  const browser = fakeBrowser()
  const stack = createBackStack(browser.port)
  browser.attach(stack)
  return { browser, stack }
}

describe('back stack', () => {
  it('runs the newest entry on Back, then the one under it, then leaves', () => {
    const { browser, stack } = setUp()
    const ran: string[] = []
    stack.push(() => ran.push('window'))
    stack.push(() => ran.push('page'))
    expect(browser.length()).toBe(2)
    expect(browser.back()).toBe('stayed')
    expect(ran).toEqual(['page'])
    expect(browser.back()).toBe('stayed')
    expect(ran).toEqual(['page', 'window'])
    expect(browser.back()).toBe('left')
  })

  it('takes the history entry out when something is closed inside Pigeon', () => {
    const { browser, stack } = setUp()
    const ran: string[] = []
    stack.push(() => ran.push('window'))
    const menu = stack.push(() => ran.push('menu'))
    menu.done()
    browser.land()
    expect(browser.length()).toBe(1)
    expect(browser.back()).toBe('stayed')
    expect(ran).toEqual(['window'])
    expect(browser.back()).toBe('left')
  })

  it("doesn't run an entry Back already ran when it then closes itself", () => {
    const { browser, stack } = setUp()
    let runs = 0
    const entry = stack.push(() => {
      runs++
      entry.done()
    })
    browser.back()
    expect(runs).toBe(1)
    expect(browser.length()).toBe(0)
  })

  it('passes over an entry closed inside Pigeon under a newer one in a single press', () => {
    const { browser, stack } = setUp()
    const ran: string[] = []
    stack.push(() => ran.push('first'))
    const middle = stack.push(() => ran.push('middle'))
    stack.push(() => ran.push('top'))
    middle.done()
    browser.back()
    expect(ran).toEqual(['top'])
    browser.back()
    expect(ran).toEqual(['top', 'first'])
    expect(browser.length()).toBe(0)
  })

  it('adds an entry that comes while a move is on its way once it has landed', () => {
    const { browser, stack } = setUp()
    const ran: string[] = []
    const a = stack.push(() => ran.push('a'))
    // One window replacing another on the Pocket: the first is done, the next comes at once.
    a.done()
    stack.push(() => ran.push('b'))
    browser.land()
    expect(browser.length()).toBe(1)
    browser.back()
    expect(ran).toEqual(['b'])
    expect(browser.back()).toBe('left')
  })

  it("doesn't mirror Forward: what Back closed stays closed", () => {
    const { browser, stack } = setUp()
    const ran: string[] = []
    stack.push(() => ran.push('page'))
    browser.back()
    browser.forward()
    expect(browser.length()).toBe(0)
    expect(ran).toEqual(['page'])
    expect(stack.size()).toBe(0)
  })

  it('passes an invite link opened in the address bar, without closing anything', () => {
    const { browser, stack } = setUp()
    const ran: string[] = []
    stack.push(() => ran.push('window'))
    browser.openHash()
    stack.push(() => ran.push('dialog'))
    browser.back()
    expect(ran).toEqual(['dialog'])
    browser.back()
    expect(ran).toEqual(['dialog', 'window'])
    expect(browser.back()).toBe('left')
  })

  it('goes past entries left from before a reload, which nothing answers', () => {
    const browser = fakeBrowser()
    browser.port.push(1)
    browser.port.push(2)
    const stack = createBackStack(browser.port, 2)
    browser.attach(stack)
    // Nothing answers them, so a single Back leaves, as it would have before.
    expect(browser.back()).toBe('left')
  })

  it('keeps entries apart after a jump below the first one through the history menu', () => {
    const browser = fakeBrowser()
    browser.port.push(1)
    browser.port.push(2)
    browser.port.push(3)
    const stack = createBackStack(browser.port, 3)
    browser.attach(stack)
    const ran: string[] = []
    stack.push(() => ran.push('first'))
    browser.jump(-3)
    stack.push(() => ran.push('a'))
    stack.push(() => ran.push('b'))
    browser.back()
    expect(ran).toEqual(['first', 'b'])
    browser.back()
    expect(ran).toEqual(['first', 'b', 'a'])
  })

  it('leaves in one press from an invite link opened over nothing else', () => {
    const { browser } = setUp()
    browser.openHash()
    expect(browser.back()).toBe('left')
  })
})
