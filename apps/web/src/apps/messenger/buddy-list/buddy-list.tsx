// The Pigeon Messenger main window: you, your friends, and the ways to add one.
import type { AvatarTraits, Status } from '@pigeon/core'
import { createEffect, createSignal, Match, onCleanup, Show, Switch } from 'solid-js'
import { Avatar } from '../../../ui/avatar/avatar.tsx'
import { Button } from '../../../ui/button/button.tsx'
import { classes } from '../../../ui/classes/classes.ts'
import {
  type ContactGroup,
  ContactList,
  type ContactRow,
} from '../../../ui/contact-list/contact-list.tsx'
import { brand, tango } from '../../../ui/icons/icons.ts'
import { useLayout } from '../../../ui/layout/layout.ts'
import { Menu, type MenuEntry } from '../../../ui/menu/menu.tsx'
import { MenuBar } from '../../../ui/menu-bar/menu-bar.tsx'
import { StatusBar } from '../../../ui/status-bar/status-bar.tsx'
import type { AddFriendTab } from '../add-friend/add-friend.tsx'
import { waitingCount } from '../invite-links/invite-links.tsx'
import { clockTime } from '../live-conversation/live-conversation.tsx'
import { ProfileForm } from '../profile-form/profile-form.tsx'
import type { SentAsk } from '../service/invite-links.ts'
import type { FriendView, Messenger } from '../service/messenger.ts'
import styles from './buddy-list.module.css'

export interface BuddyListProps {
  /** Undefined while starting, or when this browser can't run Pigeon (see `problem`). */
  messenger: Messenger | undefined
  problem?: string | undefined
  onOpenConversation: (contactId: string) => void
  /** Opens Add a Friend, on one of its tabs if said. */
  onAddFriend: (tab?: AddFriendTab) => void
  /** What a friend's right-click menu offers. */
  menuFor?: ((id: string) => readonly MenuEntry[]) | undefined
  onBlockedPeople?: (() => void) | undefined
  /** File, My Devices, Link a Device and Link to My Other Device. */
  onMyDevices?: (() => void) | undefined
  onLinkDevice?: (() => void) | undefined
  onJoinDevice?: (() => void) | undefined
  /** File, Make a Recovery Key, Use My Recovery Key and Recover My Pigeon. */
  onMakeRecoveryKey?: (() => void) | undefined
  onUseRecoveryKey?: (() => void) | undefined
  onRecoverPigeon?: (() => void) | undefined
  /** File, Export My Data and Import My Data. */
  onExportData?: (() => void) | undefined
  onImportData?: (() => void) | undefined
  /** File, Always Go Through the Relay: turns relay-only connections on or off. */
  onRelayOnly?: ((on: boolean) => void) | undefined
  onAbout: () => void
  onClose: () => void
}

const STATUS_LABEL: Record<Status, string> = { online: 'Online', away: 'Away', busy: 'Busy' }

const DAY = 24 * 60 * 60 * 1000
const two = (n: number) => String(n).padStart(2, '0')

/**
 * When a message was, as a list shows it: the time today, the day this week, the date before.
 * "21:03", "Mon", "Nov 3".
 */
export function shortWhen(at: number, now: number): string {
  const when = new Date(at)
  const today = new Date(now)
  if (when.toDateString() === today.toDateString())
    return `${two(when.getHours())}:${two(when.getMinutes())}`
  if (now - at < 6 * DAY) return when.toLocaleDateString('en-US', { weekday: 'short' })
  return when.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** What a list says of a chat: who wrote last, what, and when. */
export interface ListContext {
  readonly isMine?: (author: string) => boolean
  readonly now?: number
}

export function friendRow(
  view: FriendView,
  muted = false,
  avatar?: AvatarTraits,
  context: ListContext = {},
): ContactRow {
  const notes = [
    view.online && view.presence.status !== 'online'
      ? `(${STATUS_LABEL[view.presence.status]})`
      : '',
    view.removedYouAt !== undefined ? '(removed you)' : '',
    muted ? '(muted)' : '',
  ].filter((note) => note !== '')
  const last = view.log.entries[view.log.entries.length - 1]
  const mine = last !== undefined && context.isMine?.(last.author) === true
  const line = last?.text.split('\n')[0] ?? ''
  const preview: ContactRow['preview'] = view.typing
    ? { text: 'typing...', kind: 'typing' }
    : last === undefined
      ? undefined
      : {
          text: mine ? `You: ${line}` : line,
          ...(view.unread > 0 && !mine ? { kind: 'unread' as const } : {}),
        }
  return {
    id: view.id,
    name: view.name,
    presence: !view.online ? 'offline' : view.presence.status === 'online' ? 'online' : 'away',
    ...(notes.length > 0 ? { note: notes.join(' ') } : {}),
    ...(avatar === undefined ? {} : { avatar }),
    ...(preview === undefined ? {} : { preview }),
    ...(last === undefined ? {} : { time: shortWhen(last.at, context.now ?? Date.now()) }),
    ...(view.unread > 0 ? { unread: view.unread } : {}),
  }
}

/** Someone you asked through their link, until they add you: a row of its own. */
export const ASK_PREFIX = 'ask:'
export const askRow = (ask: SentAsk): ContactRow => ({
  id: `${ASK_PREFIX}${ask.secret}`,
  name: ask.name,
  presence: 'offline',
  pending: true,
  preview: { text: 'You asked to be friends' },
})

export function friendGroups(
  friends: readonly FriendView[],
  muted: (view: FriendView) => boolean = () => false,
  avatars: ReadonlyMap<string, AvatarTraits> = new Map(),
  context: ListContext = {},
  asks: readonly SentAsk[] = [],
): readonly ContactGroup[] {
  // The latest chat first in each group, as a list of conversations has it.
  const latest = (view: FriendView) => view.log.entries[view.log.entries.length - 1]?.at ?? 0
  const sorted = [...friends].sort((a, b) => latest(b) - latest(a))
  const online = sorted.filter((view) => view.online)
  const offline = sorted.filter((view) => !view.online)
  const row = (view: FriendView) => friendRow(view, muted(view), avatars.get(view.id), context)
  const asked = asks.filter((ask) => ask.state === 'waiting')
  return [
    { id: 'online', label: 'Online', contacts: online.map(row) },
    { id: 'offline', label: 'Offline', contacts: offline.map(row) },
    { id: 'asked', label: 'Asked, not added yet', contacts: asked.map(askRow) },
  ].filter((group) => group.contacts.length > 0)
}

export function BuddyList(props: BuddyListProps) {
  const layout = useLayout()
  const [selected, setSelected] = createSignal<string | undefined>(undefined)
  const [editing, setEditing] = createSignal(false)
  const [menu, setMenu] = createSignal<{ id: string; x: number; y: number } | undefined>()
  let listBox: HTMLDivElement | undefined
  /** A point on the page as a spot inside the list, allowing for the stage's scale. */
  const openMenu = (id: string, at: { x: number; y: number }) => {
    if (listBox === undefined || props.menuFor === undefined) return
    const box = listBox.getBoundingClientRect()
    const scale = listBox.offsetWidth > 0 ? box.width / listBox.offsetWidth : 1
    setMenu({
      id,
      x: (at.x - box.left) / scale + listBox.scrollLeft,
      y: (at.y - box.top) / scale + listBox.scrollTop,
    })
  }
  /** Keeps the menu inside the list: shifted left, or opened upwards, when it would spill. */
  const place = (element: HTMLDivElement) => {
    requestAnimationFrame(() => {
      if (listBox === undefined) return
      const room = {
        width: listBox.clientWidth,
        height: listBox.scrollTop + listBox.clientHeight,
      }
      const left = Math.max(0, Math.min(element.offsetLeft, room.width - element.offsetWidth))
      const top =
        element.offsetTop + element.offsetHeight > room.height
          ? Math.max(0, element.offsetTop - element.offsetHeight)
          : element.offsetTop
      element.style.left = `${left}px`
      element.style.top = `${top}px`
    })
  }
  const live = () => props.messenger
  // Everyone's pixel pigeon, yours included, worked out once per id.
  const [avatars, setAvatars] = createSignal<ReadonlyMap<string, AvatarTraits>>(new Map())
  createEffect(() => {
    const messenger = live()
    if (messenger === undefined) return
    for (const id of [messenger.self, ...messenger.friends().map((view) => view.id)]) {
      if (avatars().has(id)) continue
      void messenger
        .avatarOf(id)
        .then((traits) => setAvatars((known) => new Map(known).set(id, traits)))
    }
  })
  const named = () => (live()?.profile().handle ?? '') !== ''
  const phone = () => layout === 'phone'
  // Times in the list ("21:03", "Mon") move on as the day does.
  const [clock, setClock] = createSignal(Date.now())
  const ticker = setInterval(() => setClock(Date.now()), 60_000)
  onCleanup(() => clearInterval(ticker))
  /** People waiting for you to add them, through your invite links. */
  const waiting = () => {
    const messenger = live()
    return messenger === undefined ? 0 : waitingCount(messenger)
  }
  const waitingText = () => {
    const messenger = live()
    const first = messenger
      ?.inviteLinks()
      .flatMap((link) => link.requests)
      .find((request) => request.state === 'waiting')
    if (waiting() === 1 && first !== undefined) return `${first.name} asks to be friends`
    return `${waiting()} people ask to be friends`
  }

  const open = (id: string) => {
    // Someone you asked: what's become of it is in Add a Friend.
    if (id.startsWith(ASK_PREFIX)) {
      props.onAddFriend('enter')
      return
    }
    if (live()?.friend(id) !== undefined) props.onOpenConversation(id)
  }
  const setStatus = (status: Status) => {
    const messenger = live()
    if (messenger !== undefined) void messenger.setProfile({ ...messenger.profile(), status })
  }
  /** The selected friend's menu, its access keys dropped: the status items already use them. */
  const selectedActions = (): readonly MenuEntry[] => {
    const id = selected()
    const entries = id === undefined ? [] : (props.menuFor?.(id) ?? [])
    if (entries.length === 0) return [{ label: 'Select a friend for more', disabled: true }]
    return entries.map((entry) =>
      entry.kind === 'separator' ? entry : { ...entry, label: entry.label.replace('&', '') },
    )
  }
  const mailLook = () => live()?.mailLook()
  /** Check Now: the scheduler keeps its gap and its one-at-a-time, and the bar says what's up. */
  const checkNow = () => void live()?.checkNow()
  const mailText = () => {
    const look = mailLook()
    if (look === undefined) return ''
    if (look.state === 'checking') return 'Looking for mail...'
    if (look.state === 'waiting') return 'Looking for mail in a moment...'
    return look.at === undefined
      ? 'Not looked for mail yet'
      : `Looked for mail at ${clockTime(look.at)}`
  }
  const statusEntry = (status: Status, label: string) => ({
    label,
    checked: live()?.profile().status === status,
    disabled: !named(),
    onSelect: () => setStatus(status),
  })

  return (
    <>
      <MenuBar
        label="Pigeon Messenger"
        menus={[
          {
            label: '&File',
            entries: [
              { label: 'Change my &name...', disabled: !named(), onSelect: () => setEditing(true) },
              { kind: 'separator' },
              {
                label: 'My &Devices...',
                disabled: live() === undefined || props.onMyDevices === undefined,
                onSelect: () => props.onMyDevices?.(),
              },
              {
                label: 'Link a De&vice...',
                // Only the first device links devices.
                disabled:
                  !named() ||
                  live()?.isFirstDevice() !== true ||
                  live()?.waitingForList() === true ||
                  props.onLinkDevice === undefined,
                onSelect: () => props.onLinkDevice?.(),
              },
              // A Pigeon with nobody on it becomes another one; one with friends or devices is
              // offered to leave first. Never while a recovery waits.
              ...(live() !== undefined &&
              live()?.waitingForList() !== true &&
              props.onJoinDevice !== undefined
                ? [{ label: 'Link to My &Other Device...', onSelect: () => props.onJoinDevice?.() }]
                : []),
              // The recovery key: made once on the first device, used anywhere.
              ...(live()?.recoveryKey() === undefined &&
              live()?.isFirstDevice() === true &&
              live()?.nextEpoch() === 1 &&
              named() &&
              props.onMakeRecoveryKey !== undefined
                ? [
                    {
                      label: 'Make a Recovery &Key...',
                      onSelect: () => props.onMakeRecoveryKey?.(),
                    },
                  ]
                : []),
              ...(props.onRecoverPigeon !== undefined &&
              (live()?.canJoin() === true || live()?.waitingForList() === true)
                ? [{ label: 'Recover My &Pigeon...', onSelect: () => props.onRecoverPigeon?.() }]
                : []),
              ...(props.onUseRecoveryKey !== undefined &&
              live()?.recoveryKey() !== undefined &&
              live()?.waitingForList() !== true
                ? [{ label: 'Use My Recovery &Key...', onSelect: () => props.onUseRecoveryKey?.() }]
                : []),
              { kind: 'separator' },
              {
                label: '&Export My Data...',
                disabled: !named() || props.onExportData === undefined,
                onSelect: () => props.onExportData?.(),
              },
              {
                label: '&Import My Data...',
                disabled: live() === undefined || props.onImportData === undefined,
                onSelect: () => props.onImportData?.(),
              },
              { kind: 'separator' },
              {
                label: 'Always Go Through the &Relay',
                checked: live()?.settings().relayOnly === true,
                disabled: live() === undefined || props.onRelayOnly === undefined,
                onSelect: () => props.onRelayOnly?.(live()?.settings().relayOnly !== true),
              },
              { kind: 'separator' },
              { label: 'C&lose', onSelect: props.onClose },
            ],
          },
          {
            label: '&Contacts',
            entries: [
              {
                label: '&Add a Friend...',
                disabled: live() === undefined,
                onSelect: props.onAddFriend,
              },
              { kind: 'separator' },
              {
                label: '&Blocked People...',
                disabled: live() === undefined || props.onBlockedPeople === undefined,
                onSelect: () => props.onBlockedPeople?.(),
              },
            ],
          },
          {
            label: '&Actions',
            entries: [
              statusEntry('online', 'Appear &Online'),
              statusEntry('away', 'Appear &Away'),
              statusEntry('busy', 'Appear &Busy'),
              { kind: 'separator' },
              {
                label: 'Check for &Mail Now',
                disabled: live() === undefined || mailLook()?.state !== 'idle',
                onSelect: checkNow,
              },
              { kind: 'separator' },
              ...selectedActions(),
            ],
          },
          { label: '&Help', entries: [{ label: '&About Pigeon', onSelect: props.onAbout }] },
        ]}
      />
      <div class={styles.me}>
        <Avatar
          traits={avatars().get(live()?.self ?? '')}
          size={32}
          name="Your"
          decorative
          status={live()?.profile().status}
        />
        <div class={styles.who}>
          <Switch>
            <Match when={live()}>
              {(messenger) => (
                <>
                  <span>
                    <strong>{named() ? messenger().profile().handle : 'You'}</strong>{' '}
                    <span class={styles.muted}>
                      ({named() ? STATUS_LABEL[messenger().profile().status] : 'Offline'})
                    </span>
                  </span>
                  <span class={styles.personal}>
                    {named() ? messenger().profile().message : 'No name yet'}
                  </span>
                </>
              )}
            </Match>
            <Match when={true}>
              <span>
                <strong>You</strong> <span class={styles.muted}>(Offline)</span>
              </span>
              <span class={styles.personal}>{props.problem ?? 'Starting...'}</span>
            </Match>
          </Switch>
        </div>
      </div>
      <Show when={live() !== undefined && waiting() > 0}>
        <button type="button" class={styles.requests} onClick={() => props.onAddFriend('links')}>
          <img src={tango('contact-new', 16)} alt="" width="16" height="16" />
          <span class={styles.requestsText}>{waitingText()}</span>
          <span class={styles.requestsLook}>Look</span>
        </button>
      </Show>
      <div ref={listBox} class={styles.list}>
        <Switch
          fallback={
            <ContactList
              label="Friends"
              groups={friendGroups(
                live()?.friends() ?? [],
                (view) => live()?.muted(view.id) === true,
                avatars(),
                { isMine: (author) => live()?.isMine(author) === true, now: clock() },
                live()?.sentAsks() ?? [],
              )}
              pictures
              selected={selected()}
              onSelect={setSelected}
              onOpen={open}
              onMenu={
                props.menuFor === undefined
                  ? undefined
                  : (id, at) => (id.startsWith(ASK_PREFIX) ? undefined : openMenu(id, at))
              }
              empty=""
            />
          }
        >
          <Match when={props.problem !== undefined}>
            <p class={styles.hint}>{props.problem}</p>
          </Match>
          <Match when={live() !== undefined && live()?.deviceStatus() !== 'active'}>
            <p class={styles.hint}>
              This device was removed from your Pigeon. It keeps the chats it had, but talks to
              nobody now.
            </p>
          </Match>
          <Match when={live() !== undefined && (!named() || editing()) && live()}>
            {(messenger) => (
              <ProfileForm
                handle={messenger().profile().handle}
                message={messenger().profile().message}
                first={!named()}
                onSave={(handle, message) => {
                  // Read before the form closes: closing it unmounts this branch, and its
                  // `messenger` accessor throws once it has.
                  const current = messenger()
                  setEditing(false)
                  void current.setProfile({ ...current.profile(), handle, message })
                }}
                onCancel={() => setEditing(false)}
              />
            )}
          </Match>
        </Switch>
        <Show when={menu()}>
          {(at) => (
            <Menu
              label="Friend menu"
              entries={props.menuFor?.(at().id) ?? []}
              onClose={() => setMenu(undefined)}
              style={{ left: `${at().x}px`, top: `${at().y}px` }}
              ref={place}
            />
          )}
        </Show>
        <Show
          when={
            named() &&
            live()?.friends().length === 0 &&
            (live()?.sentAsks().length ?? 0) === 0 &&
            !editing()
          }
        >
          <div class={classes(styles.emptyState, phone() && styles.phoneEmpty)}>
            <img src={brand('messenger-48')} alt="" width="48" height="48" />
            <strong>No friends yet</strong>
            <p class={styles.emptyText}>
              There's no directory on Pigeon. Send a friend an invite, and they can open it even
              when you're offline.
            </p>
            <div class={styles.emptyActions}>
              <Button
                label={phone() ? '&Invite link' : '&Make an invite link'}
                isDefault
                onClick={() => props.onAddFriend('links')}
              />
              <Button
                label={phone() ? '&Quick code' : 'Show a &quick code'}
                onClick={() => props.onAddFriend('code')}
              />
            </div>
            <button
              type="button"
              class={styles.linkButton}
              onClick={() => props.onAddFriend('enter')}
            >
              I have an invite
            </button>
          </div>
        </Show>
      </div>
      <div class={styles.tasks}>
        {/* On the Pocket the left soft key is Add Friend already. */}
        <Show when={!phone()}>
          <button
            type="button"
            class={styles.task}
            disabled={live() === undefined}
            onClick={() => props.onAddFriend()}
          >
            <img src={tango('contact-new', 22)} alt="" width="22" height="22" />
            Add a Friend
          </button>
        </Show>
        <Show when={live()}>
          <button
            type="button"
            class={styles.task}
            disabled={mailLook()?.state !== 'idle'}
            onClick={checkNow}
          >
            <img src={tango('view-refresh', 22)} alt="" width="22" height="22" />
            Check Now
          </button>
          <span class={styles.mailLooked} role="status">
            {mailText()}
          </span>
        </Show>
      </div>
      <StatusBar
        fields={[
          {
            content: `${live()?.onlineCount() ?? 0} of ${live()?.friends().length ?? 0} friends online`,
            grow: true,
          },
          { content: (live()?.onlineCount() ?? 0) > 0 ? 'Direct' : 'Offline' },
        ]}
      />
    </>
  )
}
