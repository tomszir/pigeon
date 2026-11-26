import { describe, expect, it } from 'vitest'
import { createBrowserWake } from './browser-wake.ts'

function pages() {
  const win = new EventTarget()
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' })
  const wake = createBrowserWake(win as unknown as Window, doc as unknown as Document)
  return { win, doc, wake }
}

describe('the browser wake', () => {
  it('fires when the tab becomes visible, not when it is hidden', () => {
    const { doc, wake } = pages()
    let woken = 0
    wake.on(() => woken++)
    doc.visibilityState = 'hidden'
    doc.dispatchEvent(new Event('visibilitychange'))
    expect(woken).toBe(0)
    doc.visibilityState = 'visible'
    doc.dispatchEvent(new Event('visibilitychange'))
    expect(woken).toBe(1)
  })

  it('fires when the window gets focus', () => {
    const { win, wake } = pages()
    let woken = 0
    wake.on(() => woken++)
    win.dispatchEvent(new Event('focus'))
    expect(woken).toBe(1)
  })

  it('fires when the network comes back', () => {
    const { win, wake } = pages()
    let woken = 0
    wake.on(() => woken++)
    win.dispatchEvent(new Event('offline'))
    expect(woken).toBe(0)
    win.dispatchEvent(new Event('online'))
    expect(woken).toBe(1)
  })

  it('stops when told to', () => {
    const { win, doc, wake } = pages()
    let woken = 0
    const stop = wake.on(() => woken++)
    stop()
    win.dispatchEvent(new Event('focus'))
    win.dispatchEvent(new Event('online'))
    doc.dispatchEvent(new Event('visibilitychange'))
    expect(woken).toBe(0)
  })
})
