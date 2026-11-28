import { appendMessage, emptyLog } from '@pigeon/core'
import { fakeSigner } from '@pigeon/core/testing'
import { describe, expect, it } from 'vitest'
import type { MessageEntry, TranscriptEntry } from '../../../ui/transcript/entries.ts'
import type { MessageRoute } from '../service/letters.ts'
import type { FriendView } from '../service/messenger.ts'
import { letterSections, readAtOpen, showsMark, transcriptFor, wayOf } from './panels.ts'

/** 18:38 local time today, so the expected clock text doesn't depend on the time zone. */
const at = new Date(2026, 10, 24, 18, 38).getTime()

const rook = fakeSigner('rook')
const mika = fakeSigner('mika')

/** A chat of the given messages, each written by `rook` (you) or `mika`, at `when`. */
async function chat(
  messages: readonly (readonly [typeof rook, string] | readonly [typeof rook, string, number])[],
) {
  let log = emptyLog('pair:x')
  for (const [who, text, when] of messages)
    log = (await appendMessage(log, who, text, when ?? at)).log
  return {
    id: mika.id,
    handle: 'Mika',
    name: 'Mika',
    addedAt: 0,
    log,
    notes: [],
  } as unknown as FriendView
}

const messages = (entries: readonly TranscriptEntry[]) =>
  entries.filter((entry): entry is MessageEntry => entry.kind === 'message')

describe('transcriptFor', () => {
  it('lays buzzes and comings and goings between the messages they came after', async () => {
    const view = {
      ...(await chat([
        [mika, 'prove it'],
        [rook, 'ok'],
      ])),
      addedAt: at,
      fingerprint: '0'.repeat(16),
      notes: [
        { id: 1, kind: 'online', after: 0, at },
        { id: 2, kind: 'buzz-out', after: 1, at },
        { id: 3, kind: 'buzz-in', after: 2, at },
        { id: 4, kind: 'offline', after: 2, at },
      ],
    } as unknown as FriendView
    expect(
      transcriptFor(view, rook.id, 'Rook', undefined, undefined, at).map((entry) => [
        entry.kind,
        'text' in entry ? entry.text : '',
      ]),
    ).toEqual([
      ['system', 'Rook and Mika became friends on November 24 at 6:38 PM.'],
      ['system', 'Mika came online at 6:38 PM.'],
      ['day', 'Today'],
      ['message', 'prove it'],
      ['buzz', 'You have just sent a buzz!'],
      ['message', 'ok'],
      ['buzz', 'Mika has just sent you a buzz!'],
      ['system', 'Mika went offline at 6:38 PM.'],
    ])
  })

  it('puts a day line before each day’s first message, and gives each message its time', async () => {
    const yesterday = new Date(2026, 10, 23, 21, 58).getTime()
    const view = await chat([
      [mika, 'one', yesterday],
      [rook, 'two', yesterday + 60_000],
      [mika, 'three', at],
    ])
    const out = transcriptFor(view, rook.id, 'Rook', undefined, undefined, at)
    expect(out.map((entry) => entry.kind)).toEqual(['day', 'message', 'message', 'day', 'message'])
    expect(out.flatMap((entry) => (entry.kind === 'day' ? [entry.text] : []))).toEqual([
      'Yesterday',
      'Today',
    ])
    expect(messages(out).map((entry) => entry.time)).toEqual(['9:58 PM', '9:59 PM', '6:38 PM'])
    expect(messages(out)[2]?.when).toBe('November 24, 2026 at 6:38 PM')
  })

  it('names who sent each message, so a friend named like you stays apart', async () => {
    const view = {
      ...(await chat([
        [mika, 'theirs'],
        [rook, 'mine'],
      ])),
      name: 'Rook',
    } as FriendView
    const out = messages(transcriptFor(view, rook.id, 'Rook'))
    expect(out.map((entry) => [entry.from, entry.own, entry.author])).toEqual([
      ['Rook', false, mika.id],
      ['Rook', true, rook.id],
    ])
  })

  it('leaves out the start of a friendship it has no date for', () => {
    const view = {
      id: mika.id,
      handle: 'Mika',
      name: 'Mika',
      addedAt: 0,
      log: emptyLog('pair:x'),
      notes: [],
    } as unknown as FriendView
    expect(transcriptFor(view, rook.id, 'Rook')).toEqual([])
  })
})

describe('the marks on a message of yours', () => {
  const routes: Record<string, MessageRoute | undefined> = {
    sealing: { kind: 'sealing' },
    left: { kind: 'left', where: ['Loft'] },
    has: { kind: 'has' },
    waiting: { kind: 'waiting' },
    retrying: { kind: 'retrying' },
    straight: undefined,
  }
  const route = (state: string): MessageRoute | undefined => routes[state]

  /** Two messages of yours, then one of theirs: which of yours wear a mark, and which. */
  const marksOf = async (first: string, second: string) => {
    const view = await chat([
      [rook, 'one'],
      [rook, 'two'],
      [mika, 'later'],
    ])
    const byText: Record<string, MessageRoute | undefined> = {
      one: route(first),
      two: route(second),
    }
    return messages(transcriptFor(view, rook.id, 'Rook', (entry) => byText[entry.text])).map(
      (entry) => entry.mark?.state,
    )
  }

  it('only shows a mark on the newest, and on any that isn’t received yet', async () => {
    // Received settles: the older one shows none, the newest keeps its mark.
    expect(await marksOf('has', 'has')).toEqual([undefined, 'received', undefined])
    // Not received yet: mailed, sealing and failing ones carry a mark wherever they are.
    expect(await marksOf('left', 'has')).toEqual(['mailed', 'received', undefined])
    expect(await marksOf('sealing', 'left')).toEqual(['sealing', 'mailed', undefined])
    expect(await marksOf('retrying', 'has')).toEqual(['failed', 'received', undefined])
  })

  it('says nothing for a message that went straight, whatever its place', async () => {
    // Nothing proves a friend who was online has it: no mark, not even on the newest.
    expect(await marksOf('straight', 'straight')).toEqual([undefined, undefined, undefined])
    expect(await marksOf('straight', 'has')).toEqual([undefined, 'received', undefined])
  })

  it('shows a mark on yours alone, never on the friend’s messages', async () => {
    const view = await chat([[mika, 'hi']])
    const theirs = messages(transcriptFor(view, rook.id, 'Rook', () => ({ kind: 'has' })))
    expect(theirs.map((entry) => entry.mark)).toEqual([undefined])
  })

  it('takes yours from any of your devices', async () => {
    const view = await chat([[rook, 'from here']])
    const out = transcriptFor(
      view,
      (author) => author === rook.id,
      'Rook',
      () => ({ kind: 'has' }),
    )
    expect(messages(out).map((entry) => entry.mark?.state)).toEqual(['received'])
  })

  it('has the rule in one place', () => {
    const mark = (state: 'received' | 'mailed' | 'sealing' | 'failed') => ({ state, text: state })
    expect(showsMark(mark('received'), true)).toBe(true)
    expect(showsMark(mark('received'), false)).toBe(false)
    for (const state of ['mailed', 'sealing', 'failed'] as const)
      expect([showsMark(mark(state), true), showsMark(mark(state), false)]).toEqual([true, true])
  })
})

describe('the words of a way', () => {
  it('calls the two settled states Mailed and Received', () => {
    expect(wayOf({ kind: 'left', where: ['Dovecote', 'Perch'] }, 'Mika')).toEqual({
      mark: {
        state: 'mailed',
        text: 'Mailed',
        detail: "Left at Dovecote and Perch for when Mika's back",
      },
    })
    expect(wayOf({ kind: 'has' }, 'Mika')).toEqual({
      mark: { state: 'received', text: 'Received' },
    })
  })

  it('says waiting quietly, with no mark and nothing in red', () => {
    expect(wayOf({ kind: 'waiting' }, 'Mika')).toEqual({
      note: { text: 'Waiting for Mika to be online', bad: false },
    })
  })

  it('keeps red for the one that needs a look, with Try Again once it can be called', () => {
    const run = () => undefined
    const idle = wayOf({ kind: 'retrying' }, 'Jo', run)
    expect(idle?.mark?.state).toBe('failed')
    expect(idle?.note).toEqual({
      text: 'Not mailed yet. Pigeon tries again at the next mail check.',
      bad: true,
      action: { label: 'Try Again', run },
    })
    expect(wayOf({ kind: 'retrying' }, 'Jo')?.note?.action).toBeUndefined()
    const failed = wayOf({ kind: 'retrying', attempt: 'failed' }, 'Jo', run)
    expect(failed?.note?.text).toMatch(/^Not mailed yet\. No Lighthouse answered/)
    expect(failed?.note?.bad).toBe(true)
    expect(failed?.note?.action?.label).toBe('Try Again')
  })

  it('says a try is under way quietly, and offers no second one', () => {
    const trying = wayOf({ kind: 'retrying', attempt: 'trying' }, 'Jo', () => undefined)
    expect(trying?.note).toEqual({ text: 'Trying to mail it...', bad: false })
    expect(trying?.mark?.state).toBe('sealing')
  })

  it('offers Try Again for no other way, and says nothing for the rest', () => {
    const run = () => undefined
    for (const route of [{ kind: 'waiting' }, { kind: 'left', where: ['Loft'] }] as const)
      expect(wayOf(route, 'Jo', run)?.note?.action).toBeUndefined()
    expect(wayOf({ kind: 'arrived', through: 'Loft' }, 'Mika')).toBeUndefined()
    expect(wayOf(undefined, 'Mika')).toBeUndefined()
  })

  it('has no dot separators in its words', () => {
    const routes: MessageRoute[] = [
      { kind: 'sealing' },
      { kind: 'left', where: ['Loft', 'Dovecote'] },
      { kind: 'has' },
      { kind: 'waiting' },
      { kind: 'retrying' },
      { kind: 'retrying', attempt: 'trying' },
      { kind: 'retrying', attempt: 'failed' },
    ]
    for (const route of routes)
      expect(JSON.stringify(wayOf(route, 'Mika', () => undefined))).not.toContain('·')
  })
})

describe('messages that came by letter', () => {
  const by = (id: string, through: string, from = 'Mika'): TranscriptEntry => ({
    kind: 'message',
    id,
    from,
    own: false,
    text: id,
    letter: { through },
  })
  const plain = (id: string, own = false): TranscriptEntry => ({
    kind: 'message',
    id,
    from: own ? 'Rook' : 'Mika',
    own,
    text: id,
  })
  const shape = (entries: readonly TranscriptEntry[]) =>
    entries.map((entry) =>
      entry.kind === 'section'
        ? [entry.label, entry.entries.map((message) => message.id)]
        : entry.id,
    )

  it('gathers unread ones that arrived together into one envelope', () => {
    const out = letterSections(
      [plain('a'), by('b', 'Dovecote'), by('c', 'Dovecote'), by('d', 'Dovecote')],
      new Set(['a']),
    )
    expect(shape(out)).toEqual(['a', ['3 messages by letter, through Dovecote', ['b', 'c', 'd']]])
    const envelope = out[1]
    if (envelope?.kind !== 'section') throw new Error('no envelope')
    expect(envelope.title).toBe('Mika left 3 messages while you were away')
    expect(envelope.how).toBe('By letter, through Dovecote')
  })

  it('counts one message, and names every Lighthouse the run came through once', () => {
    const one = letterSections([by('a', 'Loft')], new Set())[0]
    if (one?.kind !== 'section') throw new Error('no envelope')
    expect(one.title).toBe('Mika left 1 message while you were away')
    expect(one.label).toBe('1 message by letter, through Loft')
    expect(
      shape(letterSections([by('a', 'Loft'), by('b', 'Dovecote'), by('c', 'Loft')], new Set())),
    ).toEqual([['3 messages by letter, through Loft and Dovecote', ['a', 'b', 'c']]])
  })

  it('has no dot separators in its words', () => {
    const [envelope] = letterSections([by('a', 'Loft'), by('b', 'Dovecote')], new Set())
    expect(
      JSON.stringify(envelope, (key, value) => (key === 'entries' ? undefined : value)),
    ).not.toContain('·')
  })

  it('ends an envelope at anything that is not one of them', () => {
    const entries = [
      by('a', 'Loft'),
      plain('b'),
      by('c', 'Loft'),
      plain('d', true),
      by('e', 'Loft'),
    ]
    expect(
      shape(letterSections(entries, new Set())).map((item) =>
        typeof item === 'string' ? item : item[1],
      ),
    ).toEqual([['a'], 'b', ['c'], 'd', ['e']])
    const buzz: TranscriptEntry = { kind: 'buzz', id: 'z', text: 'buzz' }
    expect(
      letterSections([by('a', 'Loft'), buzz, by('b', 'Loft')], new Set()).map((e) => e.kind),
    ).toEqual(['section', 'buzz', 'section'])
    const day: TranscriptEntry = { kind: 'day', id: 'd', text: 'Today' }
    expect(
      letterSections([by('a', 'Loft'), day, by('b', 'Loft')], new Set()).map((e) => e.kind),
    ).toEqual(['section', 'day', 'section'])
  })

  it('shows messages read before the chat opened like any other, with no envelope', () => {
    const out = letterSections([by('a', 'Loft'), by('b', 'Loft')], new Set(['a', 'b']))
    expect(out.map((entry) => entry.kind)).toEqual(['message', 'message'])
    expect(out.map((entry) => ('letter' in entry ? entry.letter : undefined))).toEqual([
      undefined,
      undefined,
    ])
  })

  it('draws a message that came by letter from the route, and no other', async () => {
    const view = await chat([
      [mika, 'one'],
      [mika, 'two'],
    ])
    const out = transcriptFor(view, rook.id, 'Rook', (entry) =>
      entry.text === 'one' ? { kind: 'arrived', through: 'Loft' } : undefined,
    )
    expect(messages(out).map((entry) => entry.letter)).toEqual([{ through: 'Loft' }, undefined])
  })

  it('takes the friends last unread messages as unread when the chat opens', async () => {
    let log = emptyLog('pair:x')
    const sigs: string[] = []
    for (const [who, text] of [
      [mika, 'one'],
      [rook, 'two'],
      [mika, 'three'],
      [mika, 'four'],
    ] as const) {
      const done = await appendMessage(log, who, text, at)
      log = done.log
      sigs.push(done.entry.sig)
    }
    const view = { id: mika.id, log, unread: 2 } as unknown as FriendView
    const read = readAtOpen(view, (author) => author === rook.id)
    expect([...read].sort()).toEqual([sigs[0], sigs[1]].sort())
  })
})
