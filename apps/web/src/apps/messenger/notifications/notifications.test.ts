import { emptyLog } from '@pigeon/core'
import { createRoot, createSignal } from 'solid-js'
import { expect, it } from 'vitest'
import type { Messenger } from '../service/service.ts'
import { createNotifications } from './notifications.tsx'

const NOW = 10_000_000
const friend = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  name: id,
  addedAt: 0,
  unread: 0,
  log: emptyLog(`pair:${id}`),
  ...over,
})
const said = (at: number) => ({
  ...emptyLog('pair:x'),
  entries: [{ author: 'x', seq: 1, lamport: 1, at, text: 'hi', sig: 's' }],
})

function messengerWith(friends: ReturnType<typeof friend>[], waiting = 0): Messenger {
  const requests = Array.from({ length: waiting }, (_, i) => ({
    name: `Asker ${i}`,
    state: 'waiting',
    at: NOW - 100 + i,
  }))
  return {
    friends: () => friends,
    friend: (id: string) => friends.find((view) => view.id === id),
    inviteLinks: () => [{ requests }],
  } as unknown as Messenger
}

it('lists unread chats, new friends and requests, newest first, and counts what waits', () => {
  createRoot((dispose) => {
    const messenger = messengerWith(
      [
        friend('mika', { unread: 3, log: said(NOW - 50) }),
        friend('kestrel', { addedAt: NOW - 1000 }),
        friend('old', { addedAt: NOW - 3 * 24 * 60 * 60 * 1000 }),
        friend('read', { log: said(NOW - 10) }),
      ],
      2,
    )
    const notifications = createNotifications(
      () => messenger,
      () => NOW,
    )
    expect(notifications.items().map((item) => item.kind)).toEqual([
      'messages',
      'requests',
      'new-friend',
    ])
    expect(notifications.count()).toBe(3 + 2 + 1)
    dispose()
  })
})

it('clears what is there now, and shows what comes after', () => {
  createRoot((dispose) => {
    const [friends, setFriends] = createSignal([friend('mika', { unread: 1, log: said(1) })])
    const messenger = {
      ...messengerWith([]),
      friends,
      friend: (id: string) => friends().find((view) => view.id === id),
    } as unknown as Messenger
    const notifications = createNotifications(
      () => messenger,
      () => NOW,
    )
    expect(notifications.items()).toHaveLength(1)
    notifications.clear()
    expect(notifications.items()).toEqual([])
    setFriends([friend('mika', { unread: 2, log: said(Date.now() + 1000) })])
    expect(notifications.items()).toHaveLength(1)
    dispose()
  })
})
