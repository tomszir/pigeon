// The Pigeon Messenger main window: you, your friends, and the ways to add one. Shows the
// Desktop board's sample instead when asked, and says so.
import type { AvatarTraits, Status } from '@pigeon/core'
import { createEffect, createSignal, Match, Show, Switch } from 'solid-js'
import { Avatar } from '../../../ui/avatar/avatar.tsx'
import { classes } from '../../../ui/classes/classes.ts'
import {
  type ContactGroup,
  ContactList,
  type ContactRow,
} from '../../../ui/contact-list/contact-list.tsx'
import { tango } from '../../../ui/icons/icons.ts'
import { useLayout } from '../../../ui/layout/layout.ts'
import { Menu, type MenuEntry } from '../../../ui/menu/menu.tsx'
import { MenuBar } from '../../../ui/menu-bar/menu-bar.tsx'
import { StatusBar } from '../../../ui/status-bar/status-bar.tsx'
import { ProfileForm } from '../profile-form/profile-form.tsx'
import { SAMPLE_GROUPS, SAMPLE_SELF, sampleConversation } from '../sample/sample.ts'
import type { FriendView, Messenger } from '../service/service.ts'
import styles from './buddy-list.module.css'

export interface BuddyListProps {
  /** Show the board's sample friends instead of yours. */
  sample: boolean
  /** Undefined while starting, or when this browser can't run Pigeon (see `problem`). */
  messenger: Messenger | undefined
  problem?: string | undefined
  onShowSample: () => void
  onHideSample: () => void
  onOpenConversation: (contactId: string) => void
  onAddFriend: () => void
  /** What a friend's right-click menu offers; none for the sample. */
  menuFor?: ((id: string) => readonly MenuEntry[]) | undefined
  onBlockedPeople?: (() => void) | undefined
  /** File, My Devices, Link a Device and Link to My Other Device (decision 0024). */
  onMyDevices?: (() => void) | undefined
  onLinkDevice?: (() => void) | undefined
  onJoinDevice?: (() => void) | undefined
  /** File, Export My Data and Import My Data (M13). */
  onExportData?: (() => void) | undefined
  onImportData?: (() => void) | undefined
  /** File, Always Go Through the Relay: turns relay-only connections on or off (0026). */
  onRelayOnly?: ((on: boolean) => void) | undefined
  onCopyInvite: () => void
  onAbout: () => void
  onClose: () => void
}

const STATUS_LABEL: Record<Status, string> = { online: 'Online', away: 'Away', busy: 'Busy' }

export function friendRow(view: FriendView, muted = false, avatar?: AvatarTraits): ContactRow {
  const notes = [
    view.online && view.presence.status !== 'online'
      ? `(${STATUS_LABEL[view.presence.status]})`
      : '',
    view.unread > 0 ? `- ${view.unread} new` : '',
    view.removedYouAt !== undefined ? '(removed you)' : '',
    muted ? '(muted)' : '',
  ].filter((note) => note !== '')
  return {
    id: view.id,
    name: view.name,
    presence: !view.online ? 'offline' : view.presence.status === 'online' ? 'online' : 'away',
    ...(notes.length > 0 ? { note: notes.join(' ') } : {}),
    ...(avatar === undefined ? {} : { avatar }),
  }
}

export function friendGroups(
  friends: readonly FriendView[],
  muted: (view: FriendView) => boolean = () => false,
  avatars: ReadonlyMap<string, AvatarTraits> = new Map(),
): readonly ContactGroup[] {
  const online = friends.filter((view) => view.online)
  const offline = friends.filter((view) => !view.online)
  const row = (view: FriendView) => friendRow(view, muted(view), avatars.get(view.id))
  return [
    { id: 'online', label: 'Online', contacts: online.map(row) },
    { id: 'offline', label: 'Offline', contacts: offline.map(row) },
  ].filter((group) => group.contacts.length > 0)
}

export function BuddyList(props: BuddyListProps) {
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
  const live = () => (props.sample ? undefined : props.messenger)
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

  const open = (id: string) => {
    if (props.sample ? sampleConversation(id) !== undefined : live()?.friend(id) !== undefined)
      props.onOpenConversation(id)
  }
  const setStatus = (status: Status) => {
    const messenger = live()
    if (messenger !== undefined) void messenger.setProfile({ ...messenger.profile(), status })
  }
  /** The selected friend's menu, its access keys dropped: the status items already use them. */
  const selectedActions = (): readonly MenuEntry[] => {
    const id = selected()
    const entries = id === undefined || props.sample ? [] : (props.menuFor?.(id) ?? [])
    if (entries.length === 0) return [{ label: 'Select a friend for more', disabled: true }]
    return entries.map((entry) =>
      entry.kind === 'separator' ? entry : { ...entry, label: entry.label.replace('&', '') },
    )
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
                // Only the first device links devices (decision 0024).
                disabled:
                  !named() || live()?.isFirstDevice() !== true || props.onLinkDevice === undefined,
                onSelect: () => props.onLinkDevice?.(),
              },
              // Only a Pigeon with nobody on it yet can become another one.
              ...(live()?.canJoin() === true && props.onJoinDevice !== undefined
                ? [{ label: 'Link to My &Other Device...', onSelect: () => props.onJoinDevice?.() }]
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
              ...selectedActions(),
              { kind: 'separator' },
              props.sample
                ? { label: '&Leave the sample', onSelect: props.onHideSample }
                : { label: '&Show the sample', onSelect: props.onShowSample },
            ],
          },
          { label: '&Help', entries: [{ label: '&About Pigeon', onSelect: props.onAbout }] },
        ]}
      />
      <div class={styles.me}>
        <Show
          when={props.sample}
          fallback={
            <Avatar
              traits={avatars().get(live()?.self ?? '')}
              size={32}
              name="Your"
              decorative
              status={live()?.profile().status}
            />
          }
        >
          <div class={styles.avatar} aria-hidden="true">
            <span class={styles.initial}>R</span>
          </div>
        </Show>
        <div class={styles.who}>
          <Switch>
            <Match when={props.sample}>
              <span>
                <strong>{SAMPLE_SELF.name}</strong> <span class={styles.muted}>(Online)</span>
              </span>
              <span class={styles.personal}>{SAMPLE_SELF.personalMessage}</span>
              <span class={styles.letters}>{SAMPLE_SELF.lettersCarried} letters carried</span>
            </Match>
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
      <div ref={listBox} class={styles.list}>
        <Switch
          fallback={
            <ContactList
              label="Friends"
              groups={
                props.sample
                  ? SAMPLE_GROUPS
                  : friendGroups(
                      live()?.friends() ?? [],
                      (view) => live()?.muted(view.id) === true,
                      avatars(),
                    )
              }
              pictures={!props.sample}
              selected={selected()}
              onSelect={setSelected}
              onOpen={open}
              onMenu={props.sample || props.menuFor === undefined ? undefined : openMenu}
              empty="No friends yet."
            />
          }
        >
          <Match when={!props.sample && props.problem !== undefined}>
            <p class={styles.hint}>{props.problem}</p>
          </Match>
          <Match
            when={!props.sample && live() !== undefined && live()?.deviceStatus() !== 'active'}
          >
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
                  setEditing(false)
                  void messenger().setProfile({ ...messenger().profile(), handle, message })
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
        <Show when={!props.sample && named() && live()?.friends().length === 0 && !editing()}>
          <p class={styles.hint}>
            Add a friend by sending them your invite link.{' '}
            <button type="button" class={styles.linkButton} onClick={() => props.onShowSample()}>
              See a sample conversation
            </button>
          </p>
        </Show>
      </div>
      <div class={classes(styles.tasks, useLayout() === 'phone' && styles.phoneTasks)}>
        <button
          type="button"
          class={styles.task}
          disabled={live() === undefined}
          onClick={() => props.onAddFriend()}
        >
          <img src={tango('contact-new', 22)} alt="" width="22" height="22" />
          Add a Friend
        </button>
        <button
          type="button"
          class={styles.task}
          disabled={!named()}
          onClick={() => props.onCopyInvite()}
        >
          <img src={tango('internet-mail', 22)} alt="" width="22" height="22" />
          Copy invite link
        </button>
      </div>
      <StatusBar
        fields={
          props.sample
            ? [{ content: 'Sample: nothing leaves this tab', grow: true }, { content: 'Direct' }]
            : [
                {
                  content: `${live()?.onlineCount() ?? 0} of ${live()?.friends().length ?? 0} friends online`,
                  grow: true,
                },
                { content: (live()?.onlineCount() ?? 0) > 0 ? 'Direct' : 'Offline' },
              ]
        }
      />
    </>
  )
}
