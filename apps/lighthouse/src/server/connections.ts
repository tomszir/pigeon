// The Node Lighthouse's connections, apart from the WebSocket library: which are let in, which
// are closed for room or for going quiet, keepalives, and the time-driven half of waits. The
// server hands it sockets and frames and calls `tick` every second; tests drive it with a clock.
import { KEEPALIVE, KEEPALIVE_ANSWER } from '@pigeon/core'
import {
  addressRange,
  type Lighthouse,
  type Limits,
  roomForConnection,
  type Scope,
  wideRange,
} from '@pigeon/lighthouse'

/** What the connections need of a socket. */
export interface ClientSocket {
  send(frame: string): void
  close(code: number, reason: string): void
}

/** One open connection. */
export interface Connection {
  /** A text frame from the client: a keepalive, or a request. */
  message(text: string): Promise<void>
  /** The socket closed, from either end. */
  closed(): void
}

export interface Connections {
  /** A socket from `address`; undefined when there's no room for it, and it's to be dropped. */
  open(socket: ClientSocket, address: string): Connection | undefined
  /** Answers leases that have ended and closes connections gone quiet; called every second. */
  tick(): Promise<void>
  /** How many are open. */
  count(): number
}

export function createConnections(options: {
  readonly lighthouse: Lighthouse
  readonly limits: Limits
  readonly now: () => number
}): Connections {
  const { lighthouse, limits, now } = options
  /** Connections open now, by address range and by IPv6 /48. */
  const open = new Map<string, number>()
  const live = new Set<{
    readonly range: string
    readonly wide: string | undefined
    heard: number
    shut: (code: number, reason: string) => void
  }>()
  let total = 0
  const move = (key: string | undefined, by: number) => {
    if (key === undefined) return
    const count = (open.get(key) ?? 0) + by
    if (count <= 0) open.delete(key)
    else open.set(key, count)
  }
  const quiet = (heard: number) => now() - heard >= limits.idleSeconds * 1000
  const room = (range: string, wide: string | undefined) =>
    roomForConnection(limits, {
      total,
      range: open.get(range) ?? 0,
      wide: wide === undefined ? 0 : (open.get(wide) ?? 0),
    })
  /** The limit that's full, so closing a waiter within it makes room. */
  const scope = (range: string, wide: string | undefined): Scope =>
    (open.get(range) ?? 0) >= limits.connectionsPerRange
      ? { kind: 'range', range }
      : wide !== undefined && (open.get(wide) ?? 0) >= limits.connectionsPer48
        ? { kind: 'wide', wide }
        : { kind: 'any' }

  return {
    open(socket, address) {
      const range = addressRange(address)
      const wide = wideRange(range)
      // No room: those gone quiet go first, then the waiter that has stood longest.
      if (!room(range, wide))
        for (const other of [...live]) if (quiet(other.heard)) other.shut(1000, 'idle')
      if (!room(range, wide)) lighthouse.evict(scope(range, wide))
      if (!room(range, wide)) return undefined
      let counted = true
      total += 1
      move(range, 1)
      move(wide, 1)
      const entry = {
        range,
        wide,
        heard: now(),
        shut: (code: number, reason: string) => {
          release()
          socket.close(code, reason)
        },
      }
      // Its place is given back the moment it's closed, so a newcomer can have it at once.
      const release = () => {
        if (!counted) return
        counted = false
        total -= 1
        move(range, -1)
        move(wide, -1)
        live.delete(entry)
        connection.gone()
      }
      live.add(entry)
      const connection = lighthouse.connect(address, undefined, {
        push: (frame) => socket.send(frame),
        close: (code, reason) => entry.shut(code, reason),
        heard: () => entry.heard,
      })
      return {
        async message(text) {
          entry.heard = now()
          // A keepalive: no request, nothing signed, no limit counts it.
          if (text === KEEPALIVE) {
            socket.send(KEEPALIVE_ANSWER)
            return
          }
          const reply = await connection.receive(text)
          if (reply === undefined) entry.shut(1008, 'limit')
          else if (reply !== null) socket.send(reply)
        },
        closed: release,
      }
    },
    async tick() {
      await lighthouse.expireWaits()
      for (const entry of [...live]) if (quiet(entry.heard)) entry.shut(1000, 'idle')
    },
    count: () => total,
  }
}
