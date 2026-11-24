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
  ...over,
  name: over.name ?? over.handle ?? 'X',
})

it('groups friends by online, marks away and busy, and counts unread', () => {
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
      contacts: [{ id: 'c', name: 'Jo', presence: 'offline', note: '- 2 new' }],
    },
  ])
  expect(friendGroups([])).toEqual([])
})
