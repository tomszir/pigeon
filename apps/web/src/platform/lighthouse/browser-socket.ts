// The browser's socket for core's Lighthouse client: a WebSocket, text frames
// only. Clients reach Lighthouses over WebSocket alone, so a Lighthouse sees this browser's
// address and nobody else does.
import type { OpenSocket } from '@pigeon/core'

export const openBrowserSocket =
  (Socket: typeof WebSocket = WebSocket): OpenSocket =>
  (url, events) => {
    const socket = new Socket(url)
    let gone = false
    const close = (code?: number) => {
      if (gone) return
      gone = true
      events.onClose(code)
    }
    socket.addEventListener('open', () => {
      if (!gone) events.onOpen()
    })
    socket.addEventListener('message', (event) => {
      if (!gone && typeof event.data === 'string') events.onMessage(event.data)
    })
    // The code says why: a Lighthouse that closed it for room says so (1013).
    socket.addEventListener('close', (event) => close(event.code))
    socket.addEventListener('error', () => close())
    return {
      send: (text) => socket.send(text),
      close: () => {
        socket.close()
        close()
      },
    }
  }
