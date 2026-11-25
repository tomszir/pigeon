import { emptyLog } from '@pigeon/core'
import { expect, it } from 'vitest'
import type { FriendView } from '../service/service.ts'
import { friendGroups } from './buddy-list.tsx'

const friend = (over: Partial<FriendView>): FriendView => ({
  id: 'x',
  handle: 'X',
  addedAt: 0,
  fingerprint: '0'.repeat(16),
  online: false,
  presence: { status: 'online', message: '' },
  typing: false,
  log: emptyLog('pair:x'),
  unread: 0,
  notes: [],
  devices: 1,
  seesThisDevice: true,
  ...over,
  name: over.name ?? over.handle ?? 'X',
})

it('groups friends by online, marks away and busy, and counts unread as a badge', () => {
  const groups = friendGroups([
    friend({ id: 'a', handle: 'Mika', online: true }),
    friend({ id: 'b', handle: 'Ola', online: true, presence: { status: 'busy', message: '' } }),
    friend({ id: 'c', handle: 'Jo', unread: 2, presence: { status: 'away', message: '' } }),
  ])
  expect(groups).toEqual([
    {
      id: 'online',
      label: 'Online',
      contacts: [
        { id: 'a', name: 'Mika', presence: 'online' },
        { id: 'b', name: 'Ola', presence: 'away', note: '(Busy)' },
      ],
    },
    {
      id: 'offline',
      label: 'Offline',
      contacts: [{ id: 'c', name: 'Jo', presence: 'offline', unread: 2 }],
    },
  ])
  expect(friendGroups([])).toEqual([])
})

const NOW = new Date(2026, 10, 25, 21, 30).getTime()
const entry = (author: string, text: string, at: number) => ({
  author,
  seq: 1,
  lamport: 1,
  at,
  text,
  sig: 'sig',
})

it('shows the last message, yours as "You:", and typing over it', () => {
  const log = (author: string, text: string, at = NOW - 60_000) => ({
    ...emptyLog('pair:x'),
    entries: [entry(author, text, at)],
  })
  const context = { isMine: (author: string) => author === 'me', now: NOW }
  const [group] = friendGroups(
    [
      friend({
        id: 'a',
        handle: 'Mika',
        online: true,
        unread: 3,
        log: log('mika', 'payback\nmore'),
      }),
      friend({ id: 'b', handle: 'Ren', online: true, typing: true, log: log('ren', 'hi') }),
      friend({
        id: 'c',
        handle: 'Ola',
        online: true,
        log: log('me', 'ok, talk later', NOW - 2 * 86_400_000),
      }),
    ],
    () => false,
    new Map(),
    context,
  )
  expect(group?.contacts.map((row) => [row.name, row.preview, row.time, row.unread])).toEqual([
    ['Mika', { text: 'payback', kind: 'unread' }, '21:29', 3],
    ['Ren', { text: 'typing...', kind: 'typing' }, '21:29', undefined],
    ['Ola', { text: 'You: ok, talk later' }, 'Mon', undefined],
  ])
})

it('lists people you asked, until they add you, after your friends', () => {
  const ask = {
    secret: 'a'.repeat(26),
    identity: 'k',
    name: 'Kestrel',
    fingerprint: '',
    keys: [],
    lighthouses: [],
    reply: 'b'.repeat(26),
    expires: NOW,
    at: NOW,
    state: 'waiting' as const,
  }
  const groups = friendGroups([], () => false, new Map(), {}, [ask, { ...ask, state: 'declined' }])
  expect(groups).toEqual([
    {
      id: 'asked',
      label: 'Asked, not added yet',
      contacts: [
        {
          id: `ask:${ask.secret}`,
          name: 'Kestrel',
          presence: 'offline',
          pending: true,
          preview: { text: 'You asked to be friends' },
        },
      ],
    },
  ])
})
