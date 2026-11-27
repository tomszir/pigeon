// The Node Lighthouse against the waiting model's conformance traces
// (verification/models/lighthouse-wait/model/conformance.ts): the Lighthouse, its SQLite store and
// the connections the server keeps, driven by a clock, must send every connection what the
// model's reference sends, in the same order, for every event.
import { fakeCrypto, fakeSigner } from '@pigeon/core'
import { createLighthouse, type Limits } from '@pigeon/lighthouse'
import {
  createTranslator,
  lighthouseLimitsFor,
  TRACE_LIGHTHOUSE_LIMITS,
} from '@pigeon/lighthouse/wait-traces'
import { describe, expect, it } from 'vitest'
import {
  BIG_TRACE_LIMITS,
  conform,
  type Subject,
  TRACE_CONNS,
  TRACE_LIMITS,
  TRACE_TAGS,
} from '../../../../verification/models/lighthouse-wait/model/conformance.ts'
import type { Output } from '../../../../verification/models/lighthouse-wait/model/lighthouse.ts'
import { createSqliteStore } from '../store/sqlite-store.ts'
import { type Connection, createConnections } from './connections.ts'

async function nodeSubject(limits: Limits = TRACE_LIGHTHOUSE_LIMITS): Promise<Subject> {
  let now = 0
  const tasks: (() => void)[] = []
  const lighthouse = createLighthouse({
    signer: fakeSigner('lighthouse'),
    crypto: fakeCrypto,
    store: createSqliteStore(':memory:'),
    now: () => now,
    name: 'Trace',
    software: { name: 'pigeon-lighthouse', version: '0.0.0' },
    limits,
    defer: (run) => void tasks.push(run),
  })
  const connections = createConnections({ lighthouse, limits, now: () => now })
  const translator = createTranslator(fakeCrypto)
  const open = new Map<string, Connection>()
  let out: Output[] = []
  /** Runs what puts left for after their replies, until nothing's left. */
  const flush = async () => {
    for (;;) {
      const run = tasks.shift()
      if (run !== undefined) run()
      await lighthouse.settled()
      if (tasks.length === 0) return
    }
  }
  return {
    async apply(event) {
      out = []
      if (event.kind === 'connect') {
        const connection = connections.open(
          {
            send: (text) => {
              const read = translator.read(event.conn, text)
              if (read !== undefined) out.push(read)
            },
            close: (_code, reason) =>
              out.push({
                kind: 'close',
                conn: event.conn,
                why: reason === 'room' ? 'room' : 'idle',
              }),
          },
          translator.address(event.range),
        )
        if (connection === undefined) out.push({ kind: 'refuse', conn: event.conn })
        else {
          open.set(event.conn, connection)
          await connection.message(translator.hello())
        }
      } else if (event.kind === 'frame')
        await open.get(event.conn)?.message(await translator.request(event.req, event.request, now))
      else if (event.kind === 'ping') await open.get(event.conn)?.message('ping')
      else if (event.kind === 'close') open.get(event.conn)?.closed()
      else if (event.kind === 'tick') {
        now += event.seconds * 1000
        await connections.tick()
      }
      await flush()
      return out
    },
  }
}

describe('the Node Lighthouse against the waiting model', () => {
  it('sends every connection what the reference does, on random traces', async () => {
    const mismatch = await conform(nodeSubject, {
      variant: 'node',
      limits: TRACE_LIMITS,
      conns: TRACE_CONNS,
      tags: TRACE_TAGS,
      length: 80,
      count: Number(process.env['PIGEON_TRACES'] ?? 200),
    })
    expect(
      mismatch,
      mismatch === undefined ? '' : JSON.stringify(mismatch, null, 1),
    ).toBeUndefined()
  }, 120_000)

  it('takes waits of 128 tags', async () => {
    const mismatch = await conform(() => nodeSubject(lighthouseLimitsFor(BIG_TRACE_LIMITS)), {
      variant: 'node',
      limits: BIG_TRACE_LIMITS,
      conns: TRACE_CONNS,
      tags: TRACE_TAGS,
      length: 80,
      bigWaits: true,
      count: Number(process.env['PIGEON_TRACES'] ?? 200),
    })
    expect(
      mismatch,
      mismatch === undefined ? '' : JSON.stringify(mismatch, null, 1),
    ).toBeUndefined()
  }, 120_000)
})
