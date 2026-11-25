import { describe, expect, it, vi } from 'vitest'
import { openBrowserSocket } from './browser-socket.ts'

class FakeSocket extends EventTarget {
  static last: FakeSocket | undefined
  sent: string[] = []
  constructor(readonly url: string) {
    super()
    FakeSocket.last = this
  }
  send(text: string) {
    this.sent.push(text)
  }
  close() {
    this.dispatchEvent(new Event('close'))
  }
}

describe('the browser socket', () => {
  it('passes text frames each way, and says it closed once', () => {
    const events = { onOpen: vi.fn(), onMessage: vi.fn(), onClose: vi.fn() }
    const socket = openBrowserSocket(FakeSocket as unknown as typeof WebSocket)(
      'wss://l.example/',
      events,
    )
    const fake = FakeSocket.last as FakeSocket
    fake.dispatchEvent(new Event('open'))
    fake.dispatchEvent(new MessageEvent('message', { data: 'reply' }))
    fake.dispatchEvent(new MessageEvent('message', { data: new ArrayBuffer(2) }))
    socket.send('request')
    socket.close()
    fake.dispatchEvent(new Event('error'))
    expect(fake.url).toBe('wss://l.example/')
    expect(events.onOpen).toHaveBeenCalledOnce()
    expect(events.onMessage.mock.calls).toEqual([['reply']])
    expect(fake.sent).toEqual(['request'])
    expect(events.onClose).toHaveBeenCalledOnce()
  })
})
