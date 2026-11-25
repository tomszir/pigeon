// The Pocket's Today screen, shown at start and on the home key: who you are, who's around,
// what's new and your live invite, each a 44px row that opens where it says.
import { createSignal, For, onCleanup, Show } from 'solid-js'
import { brand, tango } from '../../../ui/icons/icons.ts'
import { Marquee } from '../../../ui/marquee/marquee.tsx'
import wallpaper from '../../../wallpapers/hills-800x600.jpg'
import { FriendAvatar } from '../friend-avatar/friend-avatar.tsx'
import type { Messenger } from '../service/service.ts'
import styles from './today.module.css'

export interface TodayProps {
  messenger: Messenger | undefined
  /** Why Pigeon can't run here, when it can't. */
  problem?: string | undefined
  now: () => Date
  onOpenMessenger: () => void
  onOpenConversation: (id: string) => void
  onAddFriend: () => void
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
  const [time, setTime] = createSignal(props.now())
  const timer = setInterval(() => setTime(props.now()), 30_000)
  onCleanup(() => clearInterval(timer))

  const name = () => props.messenger?.profile().handle ?? ''
  const online = () => props.messenger?.friends().filter((friend) => friend.online) ?? []
  const unread = () => props.messenger?.friends().filter((friend) => friend.unread > 0) ?? []
  const minutesLeft = () => {
    const invite = props.messenger?.invite()
    if (invite === undefined) return 0
    return Math.max(1, Math.ceil((invite.expiresAt - time().getTime()) / 60_000))
  }
  const date = () =>
    time().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })

  return (
    <div class={styles.today}>
      <div class={styles.hero} style={{ 'background-image': `url("${wallpaper}")` }}>
        <p class={styles.date}>{date()}</p>
        <p class={styles.greeting}>
          {greeting(time())}
          {name() === '' ? '' : `, ${name()}`}
        </p>
      </div>
      <Show
        when={props.messenger}
        fallback={<p class={styles.note}>{props.problem ?? 'Pigeon is starting...'}</p>}
      >
        {(messenger) => (
          <div class={styles.rows}>
            <button type="button" class={styles.row} onClick={() => props.onOpenMessenger()}>
              <Show
                when={name() !== ''}
                fallback={<img src={brand('pigeon-32')} alt="" width="32" height="32" />}
              >
                <FriendAvatar
                  messenger={messenger()}
                  id={messenger().self}
                  name="You"
                  size={32}
                  decorative
                />
              </Show>
              <Show
                when={name() !== ''}
                fallback={
                  <span class={styles.text}>
                    <strong>Choose your name</strong>
                    <Marquee class={styles.muted}>Friends see it when you invite them.</Marquee>
                  </span>
                }
              >
                <span class={styles.text}>
                  <strong>{name()}</strong>
                  <Marquee class={styles.muted}>
                    {messenger().profile().message || 'No personal message'}
                  </Marquee>
                </span>
              </Show>
            </button>
            <button type="button" class={styles.row} onClick={() => props.onOpenMessenger()}>
              <img
                class={styles.small}
                src={brand(online().length > 0 ? 'presence-16-online' : 'presence-16-offline')}
                alt=""
                width="16"
                height="16"
              />
              <span class={styles.text}>
                <Show
                  when={online().length > 0}
                  fallback={
                    messenger().friends().length === 0 ? 'No friends yet' : 'No friends online'
                  }
                >
                  <span>
                    <strong>
                      {online().length} {online().length === 1 ? 'friend' : 'friends'} online:
                    </strong>{' '}
                    {online()
                      .map((friend) => friend.name)
                      .join(', ')}
                  </span>
                </Show>
              </span>
            </button>
            <For each={unread()}>
              {(friend) => (
                <button
                  type="button"
                  class={`${styles.row} ${styles.news}`}
                  onClick={() => props.onOpenConversation(friend.id)}
                >
                  <FriendAvatar
                    messenger={messenger()}
                    id={friend.id}
                    name={friend.name}
                    size={32}
                    decorative
                  />
                  <span class={styles.text}>
                    <strong>
                      {friend.unread} new from {friend.name}
                    </strong>
                    <Marquee class={styles.muted}>
                      {
                        friend.log.entries.filter((entry) => entry.author === friend.id).at(-1)
                          ?.text
                      }
                    </Marquee>
                  </span>
                </button>
              )}
            </For>
            <button type="button" class={styles.row} onClick={() => props.onAddFriend()}>
              <img
                class={styles.icon22}
                src={tango('contact-new', 22)}
                alt=""
                width="22"
                height="22"
              />
              <Show
                when={messenger().inviteCode()}
                fallback={<span class={styles.text}>Invite a friend</span>}
              >
                {(code) => (
                  <span class={styles.text}>
                    <span>
                      Invite code <strong class={styles.code}>{code()}</strong>
                    </span>
                    <Marquee class={styles.muted}>
                      works once, {minutesLeft()} {minutesLeft() === 1 ? 'minute' : 'minutes'} left
                    </Marquee>
                  </span>
                )}
              </Show>
            </button>
            <p class={styles.note}>
              <img src={tango('network-transmit-receive', 16)} alt="" width="16" height="16" />
              {online().length > 0
                ? `Direct to ${online().length} ${online().length === 1 ? 'peer' : 'peers'}. Nothing goes through a server.`
                : 'Nothing goes through a server: friends connect straight to you.'}
            </p>
          </div>
        )}
      </Show>
    </div>
  )
}
