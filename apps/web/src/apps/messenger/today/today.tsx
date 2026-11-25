// The Pocket's Today screen, its home: the greeting with your programs under it, as a phone's
// home screen has them, then what happened while you were away (new messages, people waiting
// for you, friends who just added you), then who's online now. Each is a finger-sized target.
import { For, Show } from 'solid-js'
import { brand, type Icon, tango } from '../../../ui/icons/icons.ts'
import wallpaper from '../../../wallpapers/hills-800x600.jpg'
import type { AddFriendTab } from '../add-friend/add-friend.tsx'
import { FriendAvatar } from '../friend-avatar/friend-avatar.tsx'
import { badgeText, NotificationList, type Notifications } from '../notifications/notifications.tsx'
import type { Messenger } from '../service/service.ts'
import styles from './today.module.css'

/** A program on the home screen, with how many things wait in it. */
export interface HomeApp {
  readonly id: string
  readonly label: string
  readonly icon: Icon
  readonly onOpen: () => void
  readonly badge?: (() => number) | undefined
}

export interface TodayProps {
  messenger: Messenger | undefined
  /** Why Pigeon can't run here, when it can't. */
  problem?: string | undefined
  /** The time, ticking: for the greeting and when each thing happened. */
  time: () => Date
  notifications: Notifications
  apps: readonly HomeApp[]
  onOpenMessenger: () => void
  onOpenConversation: (id: string) => void
  /** Add a Friend, on its Invite Links tab, where requests wait. */
  onOpenRequests: () => void
  /** Add a Friend on one of its tabs: a link to send, a quick code, or one you were sent. */
  onAddFriend: (tab: AddFriendTab) => void
}

const GREETINGS = [
  { from: 0, text: 'Good evening' },
  { from: 5, text: 'Good morning' },
  { from: 12, text: 'Good afternoon' },
  { from: 18, text: 'Good evening' },
] as const

export function greeting(date: Date): string {
  const hour = date.getHours()
  let text: string = GREETINGS[0].text
  for (const entry of GREETINGS) if (hour >= entry.from) text = entry.text
  return text
}

export function Today(props: TodayProps) {
  const time = () => props.time()
  const name = () => props.messenger?.profile().handle ?? ''
  const online = () => props.messenger?.friends().filter((friend) => friend.online) ?? []
  const date = () =>
    time().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
  const away = () => props.notifications.items()

  return (
    <div class={styles.today}>
      <div class={styles.hero} style={{ 'background-image': `url("${wallpaper}")` }}>
        <p class={styles.date}>{date()}</p>
        <p class={styles.greeting}>
          {greeting(time())}
          {name() === '' ? '' : `, ${name()}`}
        </p>
        <nav class={styles.apps} aria-label="Programs">
          <For each={props.apps}>
            {(app) => {
              const count = () => app.badge?.() ?? 0
              return (
                <button
                  type="button"
                  class={styles.app}
                  aria-label={count() > 0 ? `${app.label}, ${count()} waiting` : app.label}
                  onClick={() => app.onOpen()}
                >
                  <span class={styles.tile} aria-hidden="true">
                    <img src={app.icon.src} alt="" width="32" height="32" />
                    <Show when={count() > 0}>
                      <span class={styles.badge}>{badgeText(count())}</span>
                    </Show>
                  </span>
                  <span class={styles.label} aria-hidden="true">
                    {app.label}
                  </span>
                </button>
              )
            }}
          </For>
        </nav>
      </div>
      <Show
        when={props.messenger}
        fallback={<p class={styles.note}>{props.problem ?? 'Pigeon is starting...'}</p>}
      >
        {(messenger) => (
          <div class={styles.rows}>
            <Show when={name() === ''}>
              <button type="button" class={styles.row} onClick={() => props.onOpenMessenger()}>
                <img src={brand('pigeon-32')} alt="" width="32" height="32" />
                <span class={styles.text}>
                  <strong>Choose your name</strong>
                  <span class={styles.muted}>Friends see it when you invite them.</span>
                </span>
              </button>
            </Show>

            <Show when={away().length > 0}>
              <div class={styles.heading}>
                <h2 class={styles.title}>While you were away ({away().length})</h2>
                <button
                  type="button"
                  class={styles.clear}
                  onClick={() => props.notifications.clear()}
                >
                  Clear all
                </button>
              </div>
              <NotificationList
                notifications={props.notifications}
                messenger={messenger()}
                now={time().getTime()}
                onOpenConversation={props.onOpenConversation}
                onOpenRequests={props.onOpenRequests}
              />
            </Show>

            <Show when={online().length > 0}>
              <h2 class={`${styles.title} ${styles.onlineTitle}`}>
                Online now ({online().length})
              </h2>
              <ul class={styles.online} aria-label="Friends online now">
                <For each={online()}>
                  {(friend) => (
                    <li>
                      <button
                        type="button"
                        class={styles.friend}
                        onClick={() => props.onOpenConversation(friend.id)}
                      >
                        <FriendAvatar
                          messenger={messenger()}
                          id={friend.id}
                          name={friend.name}
                          size={64}
                          decorative
                        />
                        <span class={styles.friendName}>{friend.name}</span>
                      </button>
                    </li>
                  )}
                </For>
              </ul>
            </Show>

            <Show when={name() !== '' && away().length === 0 && online().length === 0}>
              <Show
                when={messenger().friends().length === 0}
                fallback={
                  <p class={styles.caughtUp}>
                    <img src={tango('face-smile', 22)} alt="" width="22" height="22" />
                    All caught up. None of your friends is online right now.
                  </p>
                }
              >
                <button type="button" class={styles.row} onClick={() => props.onAddFriend('links')}>
                  <img src={tango('contact-new', 32)} alt="" width="32" height="32" />
                  <span class={styles.text}>
                    <strong>Invite your first friend</strong>
                    <span class={styles.muted}>Send a link, or show a quick code</span>
                  </span>
                </button>
              </Show>
            </Show>
          </div>
        )}
      </Show>
    </div>
  )
}
