// Add a Friend: share your invite (a code to type, a link, its QR code), or open one a friend
// sent. Opening one asks the inviter who they are and shows their fingerprint; nothing is agreed
// until you choose Add (decision 0018).
import {
  decodeInvite,
  formatFingerprint,
  formatInviteCode,
  type Invite,
  type OpenStep,
  type PeerId,
} from '@pigeon/core'
import { createSignal, Match, onCleanup, onMount, Show, Switch } from 'solid-js'
import { Button } from '../../../ui/button/button.tsx'
import { classes } from '../../../ui/classes/classes.ts'
import { GroupBox } from '../../../ui/group-box/group-box.tsx'
import { useLayout } from '../../../ui/layout/layout.ts'
import { MessageBox } from '../../../ui/message-box/message-box.tsx'
import { TextField } from '../../../ui/text-field/text-field.tsx'
import { Connecting, type StepState } from '../connecting/connecting.tsx'
import { FriendAvatar } from '../friend-avatar/friend-avatar.tsx'
import { ProfileForm } from '../profile-form/profile-form.tsx'
import { QrCode } from '../qr-code/qr-code.tsx'
import type { Messenger, FriendOffer as Offer } from '../service/service.ts'
import styles from './add-friend.module.css'

/** How long to wait for the inviter's Pigeon to answer, and then to confirm. */
export const ANSWER_TIMEOUT_MS = 45_000
export const CONFIRM_TIMEOUT_MS = 20_000

export interface AddFriendProps {
  messenger: Messenger
  /** A link opened from the address bar. */
  incoming?: Invite | undefined
  copyText: (text: string) => Promise<boolean>
  sleep: (ms: number) => Promise<void>
  onOpenConversation: (id: PeerId) => void
  onClose: () => void
  /** The clock the countdown reads; Date.now unless a test says otherwise. */
  now?: () => number
}

type Failure = 'no-answer' | 'impostor' | 'no-confirm' | 'blocked'

type View =
  | { readonly kind: 'share' }
  | {
      readonly kind: 'looking'
      readonly code: string
      readonly step: 'joining' | OpenStep
      readonly startedAt: number
    }
  | { readonly kind: 'offer'; readonly offer: Offer }
  | { readonly kind: 'adding'; readonly offer: Offer; readonly startedAt: number }
  | { readonly kind: 'failed'; readonly failure: Failure }

const FAILURES: Record<Failure, string> = {
  'no-answer':
    "Nobody answered. An invite works once, for 30 minutes, and only while Pigeon is open on your friend's side. Ask them for a new one.",
  impostor:
    "Someone answered this link, but not the person who made it: their fingerprint doesn't match the one in the link. Pigeon didn't add them. Ask your friend for a new invite.",
  blocked:
    'This invite is from someone you blocked. To add them, unblock them first in Contacts, Blocked People.',
  'no-confirm':
    "Your friend's Pigeon stopped answering before it added you. Ask them for a new invite and try again.",
}

export function AddFriend(props: AddFriendProps) {
  const phone = useLayout() === 'phone'
  const [view, setView] = createSignal<View>({ kind: 'share' })
  const [typed, setTyped] = createSignal('')
  const [typedError, setTypedError] = createSignal('')
  const [copied, setCopied] = createSignal('')
  let stopWaiting: (() => void) | undefined
  const now = () => (props.now ?? Date.now)()

  const hasName = () => props.messenger.profile().handle !== ''
  const yourBird = () => (
    <FriendAvatar
      messenger={props.messenger}
      id={props.messenger.self}
      name="You"
      size={32}
      decorative
    />
  )
  const wait = (ms: number) =>
    new Promise<void>((resolve) => {
      stopWaiting = resolve
      void props.sleep(ms).then(resolve)
    })

  const open = async (invite: Invite) => {
    setTypedError('')
    const looking = {
      kind: 'looking',
      code: formatInviteCode(invite.code),
      startedAt: now(),
    } as const
    setView({ ...looking, step: 'joining' })
    const opened = await props.messenger.open(invite, wait(ANSWER_TIMEOUT_MS), (step) => {
      if (view().kind === 'looking') setView({ ...looking, step })
    })
    if (view().kind !== 'looking') {
      if (opened.ok) await opened.offer.cancel()
      return
    }
    if (opened.ok) {
      // Already friends: go straight to the conversation.
      if (props.messenger.friend(opened.offer.friend.id) !== undefined) {
        await opened.offer.cancel()
        props.onOpenConversation(opened.offer.friend.id)
        props.onClose()
        return
      }
      setView({ kind: 'offer', offer: opened.offer })
      return
    }
    if (opened.error === 'own') {
      setView({ kind: 'share' })
      setTypedError("That's your own invite. Send it to a friend instead.")
      return
    }
    setView({
      kind: 'failed',
      failure:
        opened.error === 'impostor'
          ? 'impostor'
          : opened.error === 'blocked'
            ? 'blocked'
            : 'no-answer',
    })
  }

  const add = async (offer: Offer) => {
    setView({ kind: 'adding', offer, startedAt: now() })
    const accepted = await offer.confirm(wait(CONFIRM_TIMEOUT_MS))
    if (view().kind !== 'adding') return
    if (!accepted) {
      setView({ kind: 'failed', failure: 'no-confirm' })
      return
    }
    // Friends now: the chat opens, and its first line says so.
    props.onOpenConversation(offer.friend.id)
    props.onClose()
  }

  const back = () => {
    const current = view()
    stopWaiting?.()
    if (current.kind === 'offer') void current.offer.cancel()
    setView({ kind: 'share' })
  }
  onCleanup(() => {
    const current = view()
    stopWaiting?.()
    if (current.kind === 'offer') void current.offer.cancel()
  })

  onMount(() => {
    if (props.incoming !== undefined && hasName()) void open(props.incoming)
    else if (hasName() && props.messenger.invite() === undefined) void props.messenger.newInvite()
  })

  const submit = () => {
    const invite = decodeInvite(typed())
    if (!invite.ok) {
      setTypedError('Type the 8-character code, or paste the whole link.')
      return
    }
    void open(invite.value)
  }

  const copy = async (what: 'code' | 'link') => {
    const text = what === 'code' ? props.messenger.inviteCode() : props.messenger.inviteLink()
    if (text === undefined) return
    const done = await props.copyText(text)
    setCopied(done ? `${what === 'code' ? 'Code' : 'Link'} copied.` : 'Select it and copy it.')
  }

  const saveName = (handle: string, message: string) =>
    void props.messenger.setProfile({ ...props.messenger.profile(), handle, message }).then(() => {
      if (props.incoming !== undefined) void open(props.incoming)
      else if (props.messenger.invite() === undefined) void props.messenger.newInvite()
    })

  const current = <K extends View['kind']>(kind: K) => {
    const shown = view()
    return shown.kind === kind ? (shown as Extract<View, { kind: K }>) : undefined
  }

  return (
    <div class={classes(styles.addFriend, phone && styles.phone)}>
      <Switch>
        <Match when={!hasName()}>
          <ProfileForm handle="" message="" first onSave={saveName} />
        </Match>
        <Match when={view().kind === 'share'}>
          <GroupBox legend="Invite a friend">
            <Show
              when={props.messenger.inviteCode()}
              fallback={
                <div class={styles.column}>
                  <p class={styles.text}>Your last invite was used or has run out.</p>
                  <Button
                    label="&Make a new invite"
                    onClick={() => void props.messenger.newInvite()}
                  />
                </div>
              }
            >
              {(code) => (
                <div class={styles.share}>
                  <QrCode
                    text={props.messenger.inviteLink() ?? ''}
                    label="Invite link as a QR code"
                    scale={4}
                  />
                  <div class={styles.column}>
                    <p class={styles.text}>
                      Tell a friend this code, send them the link, or let them scan the picture. It
                      works once, for 30 minutes, while Pigeon is open here.
                    </p>
                    <p class={styles.code} data-selectable data-invite-code>
                      {code()}
                    </p>
                    <div class={styles.actions}>
                      <Button label="Copy &code" isDefault onClick={() => void copy('code')} />
                      <Button label="Copy &link" onClick={() => void copy('link')} />
                      <Button
                        label={phone ? '&New invite' : '&New'}
                        onClick={() => {
                          setCopied('')
                          void props.messenger.newInvite()
                        }}
                      />
                    </div>
                    <span class={styles.note} aria-live="polite">
                      {copied()}
                    </span>
                  </div>
                </div>
              )}
            </Show>
            <p class={styles.fingerprint}>
              Your fingerprint:{' '}
              <code data-selectable>{formatFingerprint(props.messenger.selfFingerprint)}</code>
            </p>
          </GroupBox>
          <GroupBox legend="Got an invite?">
            <form
              class={styles.column}
              onSubmit={(event) => {
                event.preventDefault()
                submit()
              }}
            >
              <TextField
                label="&Type a code or paste a link:"
                stacked={phone}
                value={typed()}
                onInput={(text) => {
                  setTyped(text)
                  setTypedError('')
                }}
              />
              <div class={styles.actions}>
                <Button label="&Open" type="submit" disabled={typed().trim() === ''} />
                <span class={styles.error} role="alert">
                  {typedError()}
                </span>
              </div>
            </form>
          </GroupBox>
        </Match>
        <Match when={current('looking')}>
          {(shown) => {
            const order = ['joining', 'listening', 'reached'] as const
            const at = () => order.indexOf(shown().step)
            const state = (index: number): StepState =>
              index < at() ? 'done' : index === at() ? 'current' : 'pending'
            return (
              <Connecting
                friend="Friend"
                you={yourBird()}
                startedAt={shown().startedAt}
                timeoutMs={ANSWER_TIMEOUT_MS}
                now={now}
                onCancel={back}
                steps={[
                  { label: 'Reaching the relays', state: state(0) },
                  {
                    label: (
                      <>
                        Looking for whoever made <code>{shown().code}</code>
                      </>
                    ),
                    state: state(1),
                  },
                  { label: 'Asking who they are', state: state(2) },
                ]}
                hint={
                  shown().step === 'reached'
                    ? {
                        afterMs: 10_000,
                        text: "Their Pigeon is there but hasn't answered yet. It may be on a slow connection.",
                      }
                    : {
                        afterMs: 12_000,
                        text: "Nobody there yet. Pigeon has to be open on your friend's side, with this invite still showing in Add a Friend, and the code has to be right.",
                      }
                }
              />
            )
          }}
        </Match>
        <Match when={current('offer')}>
          {(shown) => {
            const { friend, fingerprint, checked } = shown().offer
            return (
              <MessageBox
                kind={checked ? 'information' : 'warning'}
                picture={
                  <FriendAvatar
                    messenger={props.messenger}
                    id={friend.id}
                    name={friend.handle}
                    size={64}
                  />
                }
                buttons={[
                  {
                    label: `&Add ${friend.handle}`,
                    isDefault: true,
                    onClick: () => void add(shown().offer),
                  },
                  { label: 'Cancel', onClick: back },
                ]}
              >
                <p>
                  <strong>{friend.handle}</strong> wants to be your friend. Their fingerprint is{' '}
                  <code data-selectable>{formatFingerprint(fingerprint)}</code>.
                </p>
                <Show
                  when={checked}
                  fallback={
                    <p class={styles.warning}>
                      Check it before you add them: it should match the fingerprint in{' '}
                      {friend.handle}'s Add a Friend window. Anyone who saw the code could have
                      answered it.
                    </p>
                  }
                >
                  <p>It matches the link, so this is the person who made it.</p>
                </Show>
              </MessageBox>
            )
          }}
        </Match>
        <Match when={current('adding')}>
          {(shown) => {
            const name = shown().offer.friend.handle
            const friendId = shown().offer.friend.id
            return (
              <Connecting
                friend={name}
                you={yourBird()}
                them={
                  <FriendAvatar
                    messenger={props.messenger}
                    id={friendId}
                    name={name}
                    size={32}
                    decorative
                  />
                }
                startedAt={shown().startedAt}
                timeoutMs={CONFIRM_TIMEOUT_MS}
                now={now}
                onCancel={back}
                steps={[
                  { label: `Found ${name}`, state: 'done' },
                  { label: `You said yes to ${name}`, state: 'done' },
                  { label: `Waiting for ${name}'s Pigeon to add you`, state: 'current' },
                ]}
              />
            )
          }}
        </Match>
        <Match when={current('failed')}>
          {(shown) => (
            <MessageBox
              kind="warning"
              buttons={[
                { label: '&Back', isDefault: true, onClick: back },
                { label: 'Close', onClick: props.onClose },
              ]}
            >
              <p>{FAILURES[shown().failure]}</p>
            </MessageBox>
          )}
        </Match>
      </Switch>
    </div>
  )
}
