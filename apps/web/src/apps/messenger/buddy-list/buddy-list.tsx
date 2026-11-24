// The Pigeon Messenger main window: you, your friends, and the ways to add one. Shows the
// Desktop board's sample instead when asked, and says so.
import type { Status } from '@pigeon/core'
import { createSignal, Match, Show, Switch } from 'solid-js'
import {
  type ContactGroup,
  ContactList,
  type ContactRow,
} from '../../../ui/contact-list/contact-list.tsx'
import { brand, tango } from '../../../ui/icons/icons.ts'
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
  onCopyInvite: () => void
  onAbout: () => void
  onClose: () => void
}

const STATUS_LABEL: Record<Status, string> = { online: 'Online', away: 'Away', busy: 'Busy' }

export function friendRow(view: FriendView): ContactRow {
  const notes = [
    view.online && view.presence.status !== 'online'
      ? `(${STATUS_LABEL[view.presence.status]})`
      : '',
    view.unread > 0 ? `- ${view.unread} new` : '',
  ].filter((note) => note !== '')
  return {
    id: view.id,
    name: view.handle,
    presence: !view.online ? 'offline' : view.presence.status === 'online' ? 'online' : 'away',
    ...(notes.length > 0 ? { note: notes.join(' ') } : {}),
  }
}

export function friendGroups(friends: readonly FriendView[]): readonly ContactGroup[] {
  const online = friends.filter((view) => view.online)
  const offline = friends.filter((view) => !view.online)
  return [
    { id: 'online', label: 'Online', contacts: online.map(friendRow) },
    { id: 'offline', label: 'Offline', contacts: offline.map(friendRow) },
  ].filter((group) => group.contacts.length > 0)
}

export function BuddyList(props: BuddyListProps) {
  const [selected, setSelected] = createSignal<string | undefined>(undefined)
  const [editing, setEditing] = createSignal(false)
  const live = () => (props.sample ? undefined : props.messenger)
  const named = () => (live()?.profile().handle ?? '') !== ''

  const open = (id: string) => {
    if (props.sample ? sampleConversation(id) !== undefined : live()?.friend(id) !== undefined)
      props.onOpenConversation(id)
  }
  const setStatus = (status: Status) => {
    const messenger = live()
    if (messenger !== undefined) void messenger.setProfile({ ...messenger.profile(), status })
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
            ],
          },
          {
            label: '&Actions',
            entries: [
              statusEntry('online', 'Appear &Online'),
              statusEntry('away', 'Appear &Away'),
              statusEntry('busy', 'Appear &Busy'),
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
        <div class={styles.avatar} aria-hidden="true">
          <Show
            when={props.sample}
            fallback={<img src={brand('pigeon-32')} alt="" width="32" height="32" />}
          >
            <span class={styles.initial}>R</span>
          </Show>
        </div>
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
      <div class={styles.list}>
        <Switch
          fallback={
            <ContactList
              label="Friends"
              groups={props.sample ? SAMPLE_GROUPS : friendGroups(live()?.friends() ?? [])}
              selected={selected()}
              onSelect={setSelected}
              onOpen={open}
              empty="No friends yet."
            />
          }
        >
          <Match when={!props.sample && props.problem !== undefined}>
            <p class={styles.hint}>{props.problem}</p>
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
        <Show when={!props.sample && named() && live()?.friends().length === 0 && !editing()}>
          <p class={styles.hint}>
            Add a friend by sending them your invite link.{' '}
            <button type="button" class={styles.linkButton} onClick={() => props.onShowSample()}>
              See a sample conversation
            </button>
          </p>
        </Show>
      </div>
      <div class={styles.tasks}>
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
