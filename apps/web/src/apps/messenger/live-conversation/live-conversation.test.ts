import { appendMessage, emptyLog, fakeSigner } from '@pigeon/core'
import { describe, expect, it } from 'vitest'
import type { FriendView } from '../service/service.ts'
import {
  clockTime,
  conversationFileName,
  conversationText,
  transcriptFor,
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

  it('names the file after the friend, leaving out what file systems refuse', () => {
    expect(conversationFileName('Mika')).toBe('Conversation with Mika.txt')
    expect(conversationFileName('a/b:c?')).toBe('Conversation with abc.txt')
    expect(conversationFileName('***')).toBe('Conversation with a friend.txt')
  })
})
