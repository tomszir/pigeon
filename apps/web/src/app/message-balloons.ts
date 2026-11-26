// The balloons the Messenger raises on the desktop: new messages, batched so a busy evening isn't
// a stream of them, a friend's own bird on each, and the offer of a recovery key. Only
// programs.tsx imports this; it hands in the shell's notify, the clock, a timer and the openers.

import type { PeerId } from '@pigeon/core'
import { type Accessor, createEffect, on } from 'solid-js'
import type { FriendView, Messenger } from '../apps/messenger/service/service.ts'
import type { ShellApi } from '../shell/shell/types.ts'
import { avatarIcon } from '../ui/avatar/avatar.tsx'
import { brandIcon, type Icon, tangoIcon } from '../ui/icons/icons.ts'

/** At most one balloon for messages every 10 seconds. */
export const MESSAGE_BALLOON_GAP_MS = 10_000

/** A message waiting for its balloon: who it is from, and its first 120 characters. */
export interface HeldMessage {
  readonly friend: Pick<FriendView, 'id' | 'name'>
  readonly text: string
}

/** The balloon for several messages at once: "Mika and Ren", "3 new messages. Click to read." */
export interface MessageSummary {
  readonly title: string
  readonly body: string
  /** Every message is from the same friend, so the balloon can be theirs. */
  readonly fromOne: boolean
}

/** Folds the waiting messages into one balloon's words. */
export function summarizeMessages(waiting: readonly HeldMessage[]): MessageSummary {
  const names = [...new Set(waiting.map((message) => message.friend.name))]
  const who =
    names.length === 1
      ? names[0]
      : names.length === 2
        ? `${names[0]} and ${names[1]}`
        : `${names[0]}, ${names[1]} and ${names.length - 2} more`
  return {
    title: who ?? '',
    body: `${waiting.length} new messages. Click to read.`,
    fromOne: names.length === 1,
  }
}

export interface MessageBalloonsDeps {
  readonly api: Pick<ShellApi, 'notify'>
  readonly messenger: Accessor<Pick<Messenger, 'avatarOf'> | undefined>
  /** The time in milliseconds, for spacing balloons. */
  readonly now: () => number
  /** Runs `run` after `ms`; the function it returns cancels that. */
  readonly schedule: (run: () => void, ms: number) => () => void
  readonly openFriendConversation: (id: PeerId) => void
  readonly openMessenger: () => void
}

export interface MessageBalloons {
  /** Holds a message for the next balloon, which is raised once the gap since the last has passed. */
  readonly hold: (friend: HeldMessage['friend'], text: string) => void
  /** A balloon about a friend, with their own bird on it once it is known. */
  readonly notifyFrom: (
    friend: Pick<FriendView, 'id'>,
    notice: { title: string; body: string },
  ) => void
  /** Cancels the balloon still waiting. */
  readonly dispose: () => void
}

export function createMessageBalloons(deps: MessageBalloonsDeps): MessageBalloons {
  const { api, now, schedule } = deps
  const friendIcon = brandIcon('messenger-16')
  // A balloon about a friend carries their own bird, which says who it is before the name does.
  // Each friend's is worked out once, so later balloons show at once and stay in order.
  const birds = new Map<PeerId, Icon>()
  const notifyFrom = (friend: Pick<FriendView, 'id'>, notice: { title: string; body: string }) => {
    const known = birds.get(friend.id)
    if (known !== undefined) return api.notify({ ...notice, icon: known })
    const messenger = deps.messenger()
    if (messenger === undefined) return api.notify({ ...notice, icon: friendIcon })
    void messenger.avatarOf(friend.id).then(
      (traits) => {
        const icon = avatarIcon(traits)
        birds.set(friend.id, icon)
        api.notify({ ...notice, icon })
      },
      () => api.notify({ ...notice, icon: friendIcon }),
    )
  }

  // Messages get one balloon at a time: at most one every 10 seconds, and what comes meanwhile is
  // folded into one ("Mika and Ren: 3 new messages"), so a busy evening isn't a stream of them.
  // Every message is in the tray's list and on Today anyway.
  let lastMessageBalloon = 0
  let held: HeldMessage[] = []
  let cancelFlush: (() => void) | undefined
  const sayMessages = () => {
    cancelFlush = undefined
    const waiting = held
    held = []
    const first = waiting[0]
    if (first === undefined) return
    lastMessageBalloon = now()
    if (waiting.length === 1) {
      notifyFrom(first.friend, { title: `${first.friend.name} says:`, body: first.text })
      return
    }
    const { title, body, fromOne } = summarizeMessages(waiting)
    api.notify({
      title,
      icon: fromOne ? (birds.get(first.friend.id) ?? friendIcon) : brandIcon('messenger-16'),
      body,
      onClick: fromOne ? () => deps.openFriendConversation(first.friend.id) : deps.openMessenger,
    })
  }
  const hold = (friend: HeldMessage['friend'], text: string) => {
    held.push({ friend, text })
    if (cancelFlush !== undefined) return
    const wait = Math.max(0, lastMessageBalloon + MESSAGE_BALLOON_GAP_MS - now())
    cancelFlush = schedule(sayMessages, wait)
  }
  return { hold, notifyFrom, dispose: () => cancelFlush?.() }
}

/**
 * Right after a new Pigeon gets its name, the key is offered once; "Later" is fine, and a
 * balloon on a later visit reminds you, once.
 */
export function remindAboutRecoveryKey(
  api: Pick<ShellApi, 'isOpen' | 'notify'>,
  messenger: Accessor<Messenger | undefined>,
  openMakeRecoveryKey: () => void,
): void {
  createEffect(
    on(
      () => {
        const running = messenger()
        return running === undefined ? undefined : ([running, running.profile().handle] as const)
      },
      (now, before) => {
        if (now === undefined) return
        const [running, handle] = now
        const offerable =
          handle !== '' &&
          running.recoveryKey() === undefined &&
          running.isFirstDevice() &&
          running.nextEpoch() === 1
        if (!offerable) return
        if (before !== undefined && before[0] === running && before[1] === '') {
          // Named while answering an invite: a balloon, so pairing isn't covered up.
          if (!api.isOpen('add-friend')) openMakeRecoveryKey()
          else
            api.notify({
              title: 'Make a recovery key',
              icon: tangoIcon('dialog-information', 16),
              body: 'If you lose every device, a recovery key brings your Pigeon back. Make one now?',
              onClick: openMakeRecoveryKey,
            })
          return
        }
        if (before === undefined)
          void running.remindRecoveryOnce().then((remind) => {
            if (!remind) return
            api.notify({
              title: 'Make a recovery key',
              icon: tangoIcon('dialog-information', 16),
              body: 'If you lose every device, a recovery key brings your Pigeon back. Make one now?',
              onClick: openMakeRecoveryKey,
            })
          })
      },
    ),
  )
}
