import { appendMessage, emptyLog, fakeSigner } from '@pigeon/core'
import { describe, expect, it } from 'vitest'
import type { MessageRoute } from '../service/letters.ts'
import type { FriendView } from '../service/service.ts'
import {
  clockTime,
  conversationFileName,
  conversationText,
  SAVED_LINE_WIDTH,
  transcriptFor,
  wayText,
} from './live-conversation.tsx'

/** 18:38 local time today, so the expected clock text doesn't depend on the time zone. */
const at = new Date(2026, 10, 24, 18, 38).getTime()

describe('transcriptFor', () => {
  it('lays buzzes and comings and goings between the messages they came after', async () => {
    const rook = fakeSigner('rook')
    const mika = fakeSigner('mika')
    let log = emptyLog('pair:x')
    log = (await appendMessage(log, mika, 'prove it', 0)).log
    log = (await appendMessage(log, rook, 'ok', 0)).log
    const view: FriendView = {
      id: mika.id,
      handle: 'Mika',
      name: 'Mika',
      addedAt: at,
      fingerprint: '0'.repeat(16),
      devices: 1,
      seesThisDevice: true,
      online: true,
      presence: { status: 'online', message: '' },
      typing: false,
      log,
      unread: 0,
      notes: [
        { id: 1, kind: 'online', after: 0, at },
        { id: 2, kind: 'buzz-out', after: 1, at },
        { id: 3, kind: 'buzz-in', after: 2, at },
        { id: 4, kind: 'offline', after: 2, at },
      ],
    }
    expect(
      transcriptFor(view, rook.id, 'Rook').map((entry) => [
        entry.kind,
        'text' in entry ? entry.text : '',
      ]),
    ).toEqual([
      ['system', 'Rook and Mika became friends on November 24 at 6:38 PM.'],
      ['system', 'Mika came online at 6:38 PM.'],
      ['message', 'prove it'],
      ['buzz', 'You have just sent a buzz!'],
      ['message', 'ok'],
      ['buzz', 'Mika has just sent you a buzz!'],
      ['system', 'Mika went offline at 6:38 PM.'],
    ])
  })
})

describe('a message of yours and its way', () => {
  it('words each way for the icon', () => {
    expect(wayText({ kind: 'sealing' }, 'Mika')).toEqual({ state: 'sealing', text: 'Sealing...' })
    expect(wayText({ kind: 'left', where: ['Dovecote', 'Perch'] }, 'Mika')).toEqual({
      state: 'left',
      text: "Left at Dovecote and Perch for when Mika's back",
    })
    expect(wayText({ kind: 'has' }, 'Mika')).toEqual({ state: 'has', text: 'Mika has it' })
    expect(wayText({ kind: 'waiting' }, 'Mika')?.text).toBe('Waits until Mika is online')
    expect(wayText({ kind: 'retrying' }, 'Mika')?.state).toBe('retrying')
    // A letter that came in is not one of yours.
    expect(wayText({ kind: 'arrived', through: 'Loft' }, 'Mika')).toBeUndefined()
    expect(wayText(undefined, 'Mika')).toBeUndefined()
  })

  it('spells out the newest message and any that needs attention, and only those', async () => {
    const rook = fakeSigner('rook')
    const mika = fakeSigner('mika')
    let log = emptyLog('pair:x')
    log = (await appendMessage(log, rook, 'one', 0)).log
    log = (await appendMessage(log, rook, 'two', 0)).log
    log = (await appendMessage(log, rook, 'three', 0)).log
    log = (await appendMessage(log, rook, 'four', 0)).log
    log = (await appendMessage(log, mika, 'later', 0)).log
    const view = {
      id: mika.id,
      handle: 'Mika',
      name: 'Mika',
      addedAt: 0,
      log,
      notes: [],
    } as unknown as FriendView
    const routes: Record<string, MessageRoute> = {
      one: { kind: 'has' },
      two: { kind: 'waiting' },
      three: { kind: 'left', where: ['Loft'] },
      four: { kind: 'left', where: ['Loft'] },
    }
    const spelled = transcriptFor(view, rook.id, 'Rook', (entry) => routes[entry.text]).flatMap(
      (entry) =>
        entry.kind === 'message' && entry.way !== undefined
          ? [[entry.text, entry.way.state, entry.way.spelled]]
          : [],
    )
    expect(spelled).toEqual([
      ['one', 'has', false],
      ['two', 'waiting', true],
      ['three', 'left', false],
      ['four', 'left', true],
    ])
  })
})

it('leaves out the start of a friendship it has no date for', () => {
  const view = {
    id: fakeSigner('mika').id,
    handle: 'Mika',
    name: 'Mika',
    addedAt: 0,
    log: emptyLog('pair:x'),
    notes: [],
  } as unknown as FriendView
  expect(transcriptFor(view, fakeSigner('rook').id, 'Rook')).toEqual([])
})

it('spells times like the taskbar clock', () => {
  expect(clockTime(new Date(2026, 0, 1, 0, 5).getTime())).toBe('12:05 AM')
  expect(clockTime(new Date(2026, 0, 1, 12, 0).getTime())).toBe('12:00 PM')
  expect(clockTime(new Date(2026, 0, 1, 9, 41).getTime())).toBe('9:41 AM')
})

describe('Save Conversation As', () => {
  it('writes each message on a line with its day and time, and who wrote it', async () => {
    const rook = fakeSigner('rook')
    const mika = fakeSigner('mika')
    let log = emptyLog('pair:x')
    log = (await appendMessage(log, mika, 'prove it', at)).log
    log = (await appendMessage(log, rook, 'ok', at)).log
    const view = {
      id: mika.id,
      handle: 'Mika',
      name: 'Mika',
      addedAt: at,
      fingerprint: '7f3a91c204bed817',
      log,
    } as FriendView
    expect(conversationText(view, (author) => author === rook.id, 'Rook', at)).toBe(
      [
        'Conversation with Mika <7f3a 91c2 04be d817>',
        'Saved from Pigeon on November 24, 2026 at 6:38 PM',
        '',
        'Rook and Mika became friends on November 24, 6:38 PM.',
        '',
        '[November 24, 6:38 PM] Mika: prove it',
        '[November 24, 6:38 PM] Rook: ok',
        '',
      ].join('\n'),
    )
  })

  it("indents a message's later lines, so none can pass for a message of its own", async () => {
    const rook = fakeSigner('rook')
    const mika = fakeSigner('mika')
    const forged = 'ok\n[November 24, 6:39 PM] Rook: I agree\r\nreally\u2028truly\ryes'
    const log = (await appendMessage(emptyLog('pair:x'), mika, forged, at)).log
    const view = {
      id: mika.id,
      handle: 'Mika',
      name: 'Mika',
      addedAt: 0,
      fingerprint: '7f3a91c204bed817',
      log,
    } as FriendView
    const lines = conversationText(view, (author) => author === rook.id, 'Rook', at).split('\n')
    expect(lines.slice(3)).toEqual([
      '[November 24, 6:38 PM] Mika: ok',
      '    \u200e[November 24, 6:39 PM] Rook: I agree',
      '    \u200ereally',
      '    \u200etruly',
      '    \u200eyes',
      '',
    ])
  })

  it('keeps every row within the width, so a wrapping viewer has nothing to move', async () => {
    const rook = fakeSigner('rook')
    const mika = fakeSigner('mika')
    const forged = '[November 24, 6:39 PM] Rook: I agree to the terms and will pay in full'
    const texts = [
      `ok${' '.repeat(400)}${forged}`,
      `ok ${forged.replaceAll(' ', '\u00a0')}`,
      `ok ${forged.replaceAll(' ', '\u2060 \u2060')}`,
      `ok ${'漢'.repeat(60)}${forged}`,
      `ok\n${'α'.repeat(38)}${forged}`,
      `ok\n${'°'.repeat(36)}${forged}`,
    ]
    let log = emptyLog('pair:x')
    for (const text of texts) log = (await appendMessage(log, mika, text, at)).log
    const view = {
      id: mika.id,
      handle: 'Mika',
      name: 'Mika',
      addedAt: 0,
      fingerprint: '7f3a91c204bed817',
      log,
    } as FriendView
    const lines = conversationText(view, (author) => author === rook.id, 'Rook', at)
      .split('\n')
      .slice(3, -1)
    for (const line of lines) {
      const width = [...line].reduce(
        (sum, c) => sum + ((c.codePointAt(0) ?? 0) >= 0x1100 ? 2 : 1),
        0,
      )
      expect(width, line).toBeLessThanOrEqual(SAVED_LINE_WIDTH)
      expect(
        line.startsWith('[November 24, 6:38 PM] Mika: ') || line.startsWith('    \u200e'),
        line,
      ).toBe(true)
    }
  })

  it('marks a friend whose name starts with yours or holds a colon', async () => {
    const rook = fakeSigner('rook')
    const mika = fakeSigner('mika')
    const log = (await appendMessage(emptyLog('pair:x'), mika, 'yes', at)).log
    const lineFor = (name: string) =>
      conversationText(
        {
          id: mika.id,
          handle: name,
          name,
          addedAt: 0,
          fingerprint: '0'.repeat(16),
          log,
        } as FriendView,
        (author) => author === rook.id,
        'Rook',
        at,
      ).split('\n')[3]
    expect(lineFor('Rook')).toBe('[November 24, 6:38 PM] Rook (friend): yes')
    expect(lineFor('rook jr')).toBe('[November 24, 6:38 PM] rook jr (friend): yes')
    expect(lineFor('Mika: My answer is')).toBe(
      '[November 24, 6:38 PM] Mika: My answer is (friend): yes',
    )
    expect(lineFor('Mika')).toBe('[November 24, 6:38 PM] Mika: yes')
    expect(lineFor('\u200bRook')).toBe('[November 24, 6:38 PM] \u200bRook (friend): yes')
    expect(lineFor('中'.repeat(32))).toBe(`[November 24, 6:38 PM] ${'中'.repeat(14)}...: yes`)
  })

  it('marks a friend who copies how a long name of yours is cut short', async () => {
    const rook = fakeSigner('rook')
    const mika = fakeSigner('mika')
    const self = 'Александр Петрович'
    const log = (await appendMessage(emptyLog('pair:x'), mika, 'ok', at)).log
    const name = 'Александр Петро...'
    const view = {
      id: mika.id,
      handle: name,
      name,
      addedAt: 0,
      fingerprint: '0'.repeat(16),
      log,
    } as FriendView
    const line = conversationText(view, (author) => author === rook.id, self, at).split('\n')[3]
    expect(line).toBe(`[November 24, 6:38 PM] ${name} (friend): ok`)
  })

  it("doesn't start the farewell line with the friend's name", () => {
    const name = '[November 24, 6:39 PM] Rook: I'
    const view = {
      id: fakeSigner('mika').id,
      handle: name,
      name,
      addedAt: 0,
      removedYouAt: at,
      fingerprint: '0'.repeat(16),
      log: emptyLog('pair:x'),
    } as FriendView
    const lines = conversationText(view, () => false, 'Rook', at).split('\n')
    expect(lines.at(-2)).toBe(
      `You were removed as a friend by ${name} (friend) on November 24, 6:38 PM.`,
    )
  })

  it('makes control characters in a message harmless', async () => {
    const rook = fakeSigner('rook')
    const mika = fakeSigner('mika')
    const text = 'ok\x1b[2K\x1b[G\b\b[November 24, 6:39 PM] Rook: I agree'
    const log = (await appendMessage(emptyLog('pair:x'), mika, text, at)).log
    const view = {
      id: mika.id,
      handle: 'Mika',
      name: 'Mika',
      addedAt: 0,
      fingerprint: '0'.repeat(16),
      log,
    } as FriendView
    const saved = conversationText(view, (author) => author === rook.id, 'Rook', at)
    expect(saved.replaceAll('\n', '')).not.toMatch(/\p{Cc}/u)
  })

  it('names the file after the friend, leaving out what file systems refuse', () => {
    expect(conversationFileName('Mika')).toBe('Conversation with Mika.txt')
    expect(conversationFileName('a/b:c?')).toBe('Conversation with abc.txt')
    expect(conversationFileName('***')).toBe('Conversation with a friend.txt')
  })
})
