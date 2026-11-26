// What happened while you were away: new messages from each friend, people waiting for you to
// add them, and friends who just added you. Today on the Pocket and the tray's flyout on the
// desktop show the same list; Clear All takes what's there now off it, everywhere.
import { type Accessor, createMemo, createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import { tango } from '../../../ui/icons/icons.ts'
import { shortWhen } from '../buddy-list/buddy-list.tsx'
import { FriendAvatar } from '../friend-avatar/friend-avatar.tsx'
import type { Messenger } from '../service/messenger.ts'
import styles from './notifications.module.css'

/** A friend who added you this long ago is still news. */
const NEW_FRIEND_MS = 24 * 60 * 60 * 1000

/** One thing that happened while you were away. */
export type AwayItem =
  | { readonly kind: 'messages'; readonly id: string; readonly at: number }
  | { readonly kind: 'requests'; readonly at: number }
  | { readonly kind: 'new-friend'; readonly id: string; readonly at: number }

export const badgeText = (n: number): string => (n > 99 ? '99+' : String(n))

/** The list, worked out from the Messenger as it is now, with Clear All. */
export function createNotifications(
  messenger: Accessor<Messenger | undefined>,
  now: Accessor<number>,
) {
  /** Clear All: what came before this stays read or unread in its chat, but leaves the list. */
  const [clearedAt, setClearedAt] = createSignal(0)
  const requests = () =>
    messenger()
      ?.inviteLinks()
      .flatMap((link) => link.requests)
      .filter((request) => request.state === 'waiting') ?? []
  const items = createMemo((): readonly AwayItem[] => {
    const running = messenger()
    if (running === undefined) return []
    const at = now()
    const out: AwayItem[] = []
    for (const friend of running.friends()) {
      const last = friend.log.entries.at(-1)
      if (friend.unread > 0 && last !== undefined && last.at > clearedAt())
        out.push({ kind: 'messages', id: friend.id, at: last.at })
      else if (
        friend.log.entries.length === 0 &&
        at - friend.addedAt < NEW_FRIEND_MS &&
        friend.addedAt > clearedAt()
      )
        out.push({ kind: 'new-friend', id: friend.id, at: friend.addedAt })
    }
    const newest = Math.max(0, ...requests().map((request) => request.at))
    if (requests().length > 0 && newest > clearedAt()) out.push({ kind: 'requests', at: newest })
    return out.sort((a, b) => b.at - a.at)
  })
  return {
    items,
    requests,
    /** How many things wait: each unread message, each request, each new friend. */
    count: () =>
      items().reduce((sum, item) => {
        if (item.kind === 'requests') return sum + requests().length
        if (item.kind === 'new-friend') return sum + 1
        return sum + (messenger()?.friend(item.id)?.unread ?? 0)
      }, 0),
    clear: () => setClearedAt(Date.now()),
  }
}

export type Notifications = ReturnType<typeof createNotifications>

export interface NotificationListProps {
  notifications: Notifications
  messenger: Messenger
  now: number
  onOpenConversation: (id: string) => void
  onOpenRequests: () => void
  /** The desktop's size: 24px birds and tighter rows, as the buddy list has. */
  compact?: boolean | undefined
}

/** The list itself: one row per thing, newest first; on the Pocket each is finger-sized. */
export function NotificationList(props: NotificationListProps) {
  return (
    <ul
      class={props.compact === true ? `${styles.list} ${styles.compact}` : styles.list}
      aria-label="While you were away"
    >
      <For each={props.notifications.items()}>
        {(item) => (
          <li>
            <AwayRow
              item={item}
              messenger={props.messenger}
              now={props.now}
              requests={props.notifications.requests().length}
              firstRequest={props.notifications.requests()[0]?.name ?? ''}
              onOpenConversation={props.onOpenConversation}
              onOpenRequests={props.onOpenRequests}
            />
          </li>
        )}
      </For>
    </ul>
  )
}

/** The Lighthouse that brought a friend's last message, when it came by letter. */
function arrivedThrough(messenger: Messenger, id: string): string | undefined {
  const last = messenger.friend(id)?.log.entries.at(-1)
  if (last === undefined) return undefined
  const route = messenger.messageRoute(id, last)
  return route?.kind === 'arrived' ? route.through : undefined
}

function AwayRow(props: {
  item: AwayItem
  messenger: Messenger
  now: number
  requests: number
  firstRequest: string
  onOpenConversation: (id: string) => void
  onOpenRequests: () => void
}) {
  const friend = () =>
    props.item.kind === 'requests' ? undefined : props.messenger.friend(props.item.id)
  const byLetter = (id: string) => arrivedThrough(props.messenger, id)
  return (
    <Show
      when={props.item.kind !== 'requests' && friend()}
      fallback={
        <button
          type="button"
          class={`${styles.row} ${styles.request}`}
          onClick={() => props.onOpenRequests()}
        >
          <img src={tango('contact-new', 32)} alt="" width="32" height="32" />
          <span class={styles.text}>
            <span>
              {props.requests === 1 ? (
                <>
                  <strong>{props.firstRequest}</strong> asks to be friends
                </>
              ) : (
                <>
                  <strong>{props.requests} people</strong> ask to be friends
                </>
              )}
            </span>
            <span class={styles.muted}>Look in Add a Friend</span>
          </span>
          <span class={styles.end}>
            <span class={styles.time}>{shortWhen(props.item.at, props.now)}</span>
          </span>
        </button>
      }
    >
      {(view) => (
        <button
          type="button"
          class={styles.row}
          onClick={() => props.onOpenConversation(view().id)}
        >
          <FriendAvatar
            messenger={props.messenger}
            id={view().id}
            name={view().name}
            size={32}
            decorative
          />
          <Show
            when={props.item.kind === 'messages'}
            fallback={
              <span class={styles.text}>
                <span>
                  <strong>{view().name}</strong> is your friend now
                </span>
                <span class={styles.muted}>Say hello</span>
              </span>
            }
          >
            <span class={styles.text}>
              <strong>{view().name}</strong>
              <span class={styles.preview}>{view().log.entries.at(-1)?.text.split('\n')[0]}</span>
              <Show when={byLetter(view().id)}>
                {(through) => <span class={styles.letter}>By letter, through {through()}</span>}
              </Show>
            </span>
          </Show>
          <span class={styles.end}>
            <span class={styles.time}>{shortWhen(props.item.at, props.now)}</span>
            <Show when={view().unread > 0 && props.item.kind === 'messages'}>
              <span class={styles.rowBadge}>
                {badgeText(view().unread)}
                <span class={styles.hidden}> new</span>
              </span>
            </Show>
          </span>
        </button>
      )}
    </Show>
  )
}

export interface NotificationFlyoutProps extends Omit<NotificationListProps, 'compact'> {
  onClose: () => void
}

/**
 * The desktop tray's list: what happened while you were away, opened from Pigeon's icon. It
 * closes on Escape, on a click outside it, and when one of its rows is opened.
 */
export function NotificationFlyout(props: NotificationFlyoutProps) {
  let panel: HTMLElement | undefined
  const outside = (event: PointerEvent) => {
    const target = event.target as Element | null
    if (panel?.contains(target) === true) return
    // The tray's own button toggles it; a press there isn't outside.
    if (target?.closest('[aria-haspopup="dialog"]') !== null) return
    props.onClose()
  }
  const key = (event: KeyboardEvent) => {
    if (event.key === 'Escape') props.onClose()
  }
  onMount(() => {
    document.addEventListener('pointerdown', outside, true)
    document.addEventListener('keydown', key)
    panel?.focus()
  })
  onCleanup(() => {
    document.removeEventListener('pointerdown', outside, true)
    document.removeEventListener('keydown', key)
  })
  const count = () => props.notifications.items().length
  const open =
    <T extends unknown[]>(run: (...args: T) => void) =>
    (...args: T) => {
      run(...args)
      props.onClose()
    }
  return (
    <section ref={panel} class={styles.flyout} aria-label="Notifications" tabIndex={-1}>
      <header class={styles.flyoutHead}>
        <span>{count() > 0 ? `Notifications (${count()})` : 'Notifications'}</span>
        <Show when={count() > 0}>
          <button
            type="button"
            class={styles.flyoutClear}
            onClick={() => props.notifications.clear()}
          >
            Clear all
          </button>
        </Show>
      </header>
      <Show when={count() > 0} fallback={<p class={styles.nothing}>Nothing new.</p>}>
        <NotificationList
          {...props}
          compact
          onOpenConversation={open(props.onOpenConversation)}
          onOpenRequests={open(props.onOpenRequests)}
        />
      </Show>
    </section>
  )
}
