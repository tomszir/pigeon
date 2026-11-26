import { emptyLog } from '@pigeon/core'
import { fireEvent, render, screen } from '@solidjs/testing-library'
import { createSignal } from 'solid-js'
import { describe, expect, it, vi } from 'vitest'
import type { FriendView, Messenger } from '../service/messenger.ts'
import { BuddyList, friendGroups } from './buddy-list.tsx'

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

/** Only what the buddy list reads of a named Pigeon with no friends. */
function named() {
  const [profile, setProfile] = createSignal({
    handle: 'Rook',
    status: 'online' as const,
    message: '',
  })
  const [look, setLook] = createSignal<{
    at: number | undefined
    state: 'idle' | 'waiting' | 'checking'
  }>({ at: undefined, state: 'idle' })
  const checkNow = vi.fn(() => 0)
  const setProfileSpy = vi.fn(async (next: ReturnType<typeof profile>) => setProfile(next))
  const messenger = {
    self: 'rook',
    profile,
    setProfile: setProfileSpy,
    friends: () => [],
    sentAsks: () => [],
    inviteLinks: () => [],
    settings: () => ({ relayOnly: false }),
    deviceStatus: () => 'active',
    onlineCount: () => 0,
    muted: () => false,
    isMine: () => false,
    avatarOf: async () => undefined,
    isFirstDevice: () => false,
    waitingForList: () => false,
    recoveryKey: () => undefined,
    nextEpoch: () => 0,
    canJoin: () => false,
    mailLook: look,
    checkNow,
  } as unknown as Messenger
  return { messenger, setProfile: setProfileSpy, setLook, checkNow }
}

it('saves a new name and personal message from File, Change my name', async () => {
  const { messenger, setProfile } = named()
  render(() => (
    <BuddyList
      messenger={messenger}
      onOpenConversation={() => undefined}
      onAddFriend={() => undefined}
      onAbout={() => undefined}
      onClose={() => undefined}
    />
  ))
  fireEvent.click(screen.getByRole('menuitem', { name: 'File' }))
  fireEvent.click(screen.getByRole('menuitem', { name: 'Change my name...' }))
  // The labels' access keys split their text, so the fields are found by order.
  const fields = screen.getAllByRole('textbox')
  fireEvent.input(fields[0] as HTMLElement, {
    target: { value: 'Rook II' },
  })
  fireEvent.input(fields[1] as HTMLElement, {
    target: { value: 'on the roof' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'OK' }))
  // The form closes at once, and the new name is saved, not lost to the form going away.
  expect(screen.queryByRole('form', { name: /^Your/ })).toBeNull()
  expect(setProfile).toHaveBeenCalledWith({
    handle: 'Rook II',
    status: 'online',
    message: 'on the roof',
  })
  expect(await screen.findByText('Rook II')).toBeTruthy()
  expect(screen.getByText('on the roof')).toBeTruthy()
})

describe('looking for mail', () => {
  const show = () => {
    const world = named()
    render(() => (
      <BuddyList
        messenger={world.messenger}
        onOpenConversation={() => undefined}
        onAddFriend={() => undefined}
        onAbout={() => undefined}
        onClose={() => undefined}
      />
    ))
    return world
  }

  it('says when it last looked, and Check Now looks', () => {
    const { checkNow, setLook } = show()
    expect(screen.getByText('Not looked for mail yet')).toBeTruthy()
    setLook({ at: new Date(2026, 10, 24, 18, 38).getTime(), state: 'idle' })
    expect(screen.getByText('Looked for mail at 6:38 PM')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Check Now' }))
    expect(checkNow).toHaveBeenCalledOnce()
  })

  it('shows a look under way or waiting, and offers no second one', () => {
    const { setLook } = show()
    setLook({ at: undefined, state: 'waiting' })
    expect(screen.getByText('Looking for mail in a moment...')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Check Now' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
    setLook({ at: undefined, state: 'checking' })
    expect(screen.getByText('Looking for mail...')).toBeTruthy()
  })

  it('offers Check for Mail Now in the Actions menu', () => {
    const { checkNow } = show()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Actions' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Check for Mail Now' }))
    expect(checkNow).toHaveBeenCalledOnce()
  })
})
