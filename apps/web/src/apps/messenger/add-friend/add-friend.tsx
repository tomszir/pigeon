// Add a Friend: make invite links that wait at your Lighthouses, share a live code, or open one
// a friend sent. A code asks the inviter, online now, who they are; a link finds their card at
// the Lighthouses and leaves a request for them to answer whenever they're next on. Nothing is
// agreed until both of you say so: whoever asks through your code waits for you to add them.
import {
  decodeInvite,
  decodeInviteLink,
  formatCode,
  formatFingerprint,
  type Invite,
  MAX_WRONG_TRIES,
  type OpenStep,
  type PeerId,
} from '@pigeon/core'
import { createEffect, createSignal, For, Match, onCleanup, onMount, Show, Switch } from 'solid-js'
import { Button } from '../../../ui/button/button.tsx'
import { classes } from '../../../ui/classes/classes.ts'
import { useLayout } from '../../../ui/layout/layout.ts'
import { MessageBox } from '../../../ui/message-box/message-box.tsx'
import { Tabs } from '../../../ui/tabs/tabs.tsx'
import { TextField } from '../../../ui/text-field/text-field.tsx'
import { Connecting, type StepState } from '../connecting/connecting.tsx'
import { FriendAvatar } from '../friend-avatar/friend-avatar.tsx'
import { InviteLinks, timeLeft, waitingCount } from '../invite-links/invite-links.tsx'
import { ProfileForm } from '../profile-form/profile-form.tsx'
import { QrCode } from '../qr-code/qr-code.tsx'
import type { OpenedLink, SentAsk } from '../service/invite-links.ts'
import type { CodeAsk, Messenger, FriendOffer as Offer } from '../service/messenger.ts'
import styles from './add-friend.module.css'

/** How long to wait for the inviter's Pigeon to answer, and then for the inviter to add you. */
export const ANSWER_TIMEOUT_MS = 45_000
export const CONFIRM_TIMEOUT_MS = 3 * 60_000

/** What the address bar brought: a live invite's code, or a link through Lighthouses. */
export type IncomingInvite = Invite | { readonly link: string }

/** Add a Friend's tabs: links you send, a quick code, and one someone sent you. */
export type AddFriendTab = 'links' | 'code' | 'enter'

export interface AddFriendProps {
  messenger: Messenger
  /** The tab it opens on; Invite Links unless set. */
  tab?: AddFriendTab | undefined
  /** A link opened from the address bar. */
  incoming?: IncomingInvite | undefined
  copyText: (text: string) => Promise<boolean>
  sleep: (ms: number) => Promise<void>
  onOpenConversation: (id: PeerId) => void
  onClose: () => void
  /** The clock the countdown reads; Date.now unless a test says otherwise. */
  now?: () => number
}

type Failure =
  | 'no-answer'
  | 'impostor'
  | 'wrong-code'
  | 'no-confirm'
  | 'declined'
  | 'blocked'
  | 'link-not-found'
  | 'link-closed'
  | 'link-expired'
  | 'link-too-long'
  | 'link-unsent'
  | 'link-no-lighthouse'

type View =
  | { readonly kind: 'share' }
  | {
      readonly kind: 'looking'
      /** The typed code, as shown; a link has none to show. */
      readonly code: string | undefined
      readonly step: 'joining' | OpenStep
      readonly startedAt: number
    }
  | { readonly kind: 'offer'; readonly offer: Offer }
  | { readonly kind: 'adding'; readonly offer: Offer; readonly startedAt: number }
  | { readonly kind: 'failed'; readonly failure: Failure }
  | { readonly kind: 'link-looking' }
  | { readonly kind: 'link-offer'; readonly opened: Extract<OpenedLink, { ok: true }> }
  | { readonly kind: 'link-asking'; readonly name: string }
  | { readonly kind: 'link-asked'; readonly name: string }

const FAILURES: Record<Failure, string> = {
  'no-answer':
    "Nobody answered. An invite works once, for 30 minutes, and only while Pigeon is open on your friend's side. Ask them for a new one.",
  impostor:
    "Someone answered this link, but not the person who made it: their fingerprint doesn't match the one in the link. Pigeon didn't add them. Ask your friend for a new invite.",
  'wrong-code':
    "The Pigeon that answered says that code is wrong. Check it with your friend and type it again; after a few wrong tries the code stops working and they'll need a new one. If it keeps happening with the right code, someone else may be answering: ask for an invite link instead.",
  declined: "Your friend's Pigeon said no. Nobody was added.",
  blocked:
    'This invite is from someone you blocked. To add them, unblock them first in Contacts, Blocked People.',
  'no-confirm':
    "Your friend didn't add you in time, or their Pigeon stopped answering. Ask them for a new invite and try again.",
  'link-not-found':
    "Pigeon couldn't find this invite at the Lighthouses. Check you have the whole link, or ask your friend for a new one.",
  'link-closed':
    'This invite link is closed: it was used up, or your friend closed it. Ask them for a new one.',
  'link-expired': 'This invite link has run out. Ask your friend for a new one.',
  'link-too-long':
    "This invite link says it lasts more than a week from now, and no Pigeon link does. Check your computer's date and time, or ask your friend for a new link.",
  'link-unsent':
    "Pigeon couldn't leave your request at your friend's Lighthouses. Check your connection and try again.",
  'link-no-lighthouse':
    "Your friend's answer would come to your Lighthouses, and yours all need a pass. Add one that doesn't in Network, then try again.",
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
      code:
        invite.via === 'code'
          ? formatCode({ nameplate: invite.nameplate, password: invite.secret, secret: '' })
          : undefined,
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
      setTab('enter')
      setView({ kind: 'share' })
      setTypedError("That's your own invite. Send it to a friend instead.")
      return
    }
    setView({
      kind: 'failed',
      failure:
        opened.error === 'impostor' || opened.error === 'wrong-code' || opened.error === 'blocked'
          ? opened.error
          : 'no-answer',
    })
  }

  /** Finds a link's card at the Lighthouses and shows who made it. */
  const openLink = async (text: string) => {
    setTypedError('')
    setView({ kind: 'link-looking' })
    const opened = await props.messenger.openInviteLink(text)
    if (view().kind !== 'link-looking') return
    if (opened.ok) {
      setView({ kind: 'link-offer', opened })
      return
    }
    switch (opened.error) {
      case 'own':
        setTab('enter')
        setView({ kind: 'share' })
        setTypedError("That's your own invite link. Send it to a friend instead.")
        return
      case 'friend':
        setTab('enter')
        setView({ kind: 'share' })
        setTypedError("You're already friends with whoever made that link.")
        return
      case 'malformed':
        setTab('enter')
        setView({ kind: 'share' })
        setTypedError("That link isn't whole. Paste all of it.")
        return
      case 'closed':
        setView({ kind: 'failed', failure: 'link-closed' })
        return
      case 'expired':
        setView({ kind: 'failed', failure: 'link-expired' })
        return
      case 'too-long':
        setView({ kind: 'failed', failure: 'link-too-long' })
        return
      default:
        setView({ kind: 'failed', failure: 'link-not-found' })
    }
  }

  const ask = async (opened: Extract<OpenedLink, { ok: true }>) => {
    const name = opened.card.name
    setView({ kind: 'link-asking', name })
    const sent = await props.messenger.askThroughLink(opened)
    if (view().kind !== 'link-asking') return
    if (sent === 'sent') setView({ kind: 'link-asked', name })
    else
      setView({
        kind: 'failed',
        failure:
          sent === 'no-lighthouse'
            ? 'link-no-lighthouse'
            : sent === 'expired'
              ? 'link-expired'
              : sent === 'too-long'
                ? 'link-too-long'
                : 'link-unsent',
      })
  }

  const openIncoming = (incoming: IncomingInvite) => {
    if ('link' in incoming) void openLink(incoming.link)
    else void open(incoming)
  }

  const add = async (offer: Offer) => {
    setView({ kind: 'adding', offer, startedAt: now() })
    const accepted = await offer.confirm(wait(CONFIRM_TIMEOUT_MS))
    if (view().kind !== 'adding') return
    if (accepted !== true) {
      setView({ kind: 'failed', failure: accepted === 'declined' ? 'declined' : 'no-confirm' })
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

  /** Which tab shows, kept while a link or code is looked up and you come back. */
  const [tab, setTab] = createSignal<AddFriendTab>(props.tab ?? 'links')

  onMount(() => {
    if (props.incoming !== undefined && hasName()) openIncoming(props.incoming)
  })

  const submit = () => {
    if (decodeInviteLink(typed()).ok || /#b\//.test(typed())) {
      void openLink(typed())
      return
    }
    const invite = decodeInvite(typed())
    if (!invite.ok) {
      setTypedError('Type the 10-character code, or paste the whole link.')
      return
    }
    void open(invite.value)
  }

  const copyCode = async () => {
    const text = props.messenger.inviteCode()
    if (text === undefined) return
    const done = await props.copyText(text)
    setCopied(done ? 'Code copied.' : 'Select it and copy it.')
  }

  const saveName = (handle: string, message: string) =>
    void props.messenger.setProfile({ ...props.messenger.profile(), handle, message }).then(() => {
      if (props.incoming !== undefined) openIncoming(props.incoming)
    })

  const current = <K extends View['kind']>(kind: K) => {
    const shown = view()
    return shown.kind === kind ? (shown as Extract<View, { kind: K }>) : undefined
  }

  const links = () => (
    <InviteLinks messenger={props.messenger} copyText={props.copyText} phone={phone} now={now} />
  )

  const codeBox = () => (
    <QuickCode
      messenger={props.messenger}
      phone={phone}
      now={now}
      copied={copied()}
      onCopy={() => void copyCode()}
      onNew={() => {
        setCopied('')
        void props.messenger.newInvite()
      }}
    />
  )

  const enter = () => (
    <div class={styles.column}>
      <p class={styles.text}>
        A friend sent you an invite link, or is reading you a code: paste or type it here.
      </p>
      <form
        class={styles.column}
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <TextField
          label="&Code or link:"
          stacked={phone}
          value={typed()}
          onInput={(text) => {
            setTyped(text)
            setTypedError('')
          }}
        />
        <div class={styles.actions}>
          <Button label="&Open" type="submit" isDefault disabled={typed().trim() === ''} />
          <span class={styles.error} role="alert">
            {typedError()}
          </span>
        </div>
      </form>
      <SentAsks messenger={props.messenger} now={now} />
    </div>
  )

  const waiting = () => waitingCount(props.messenger)

  return (
    <div class={classes(styles.addFriend, phone && styles.phone)}>
      <Switch>
        <Match when={!hasName()}>
          <ProfileForm handle="" message="" first onSave={saveName} />
        </Match>
        <Match when={view().kind === 'share'}>
          <Tabs
            label="Add a Friend"
            fill={phone}
            initial={tab()}
            onSelect={(id) => setTab(id as AddFriendTab)}
            tabs={[
              {
                id: 'links',
                label: waiting() > 0 ? `Invite links (${waiting()})` : 'Invite links',
                content: links,
              },
              {
                id: 'code',
                label:
                  props.messenger.codeAsks().length > 0
                    ? `Quick code (${props.messenger.codeAsks().length})`
                    : 'Quick code',
                content: codeBox,
              },
              { id: 'enter', label: phone ? 'Have one?' : 'Have an invite?', content: enter },
            ]}
          />
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
                      <Show when={shown().code} fallback="Looking for whoever made the link">
                        {(code) => (
                          <>
                            Looking for whoever made <code>{code()}</code>
                          </>
                        )}
                      </Show>
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
                    label: '&Ask to be friends',
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
                <p>
                  They see your name and your fingerprint,{' '}
                  <code data-selectable>{formatFingerprint(props.messenger.selfFingerprint)}</code>,
                  and add you on their side.
                </p>
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
                  { label: `You asked ${name}`, state: 'done' },
                  { label: `Waiting for ${name} to add you`, state: 'current' },
                ]}
              />
            )
          }}
        </Match>
        <Match when={current('link-looking')}>
          <MessageBox kind="information" buttons={[{ label: 'Cancel', onClick: back }]}>
            <p>Looking for the invite at the Lighthouses...</p>
          </MessageBox>
        </Match>
        <Match when={current('link-offer')}>
          {(shown) => {
            const { card, fingerprint } = shown().opened
            return (
              <MessageBox
                kind="information"
                picture={
                  <FriendAvatar
                    messenger={props.messenger}
                    id={card.identity}
                    name={card.name}
                    size={64}
                  />
                }
                buttons={[
                  {
                    label: '&Ask to be friends',
                    isDefault: true,
                    onClick: () => void ask(shown().opened),
                  },
                  { label: 'Cancel', onClick: back },
                ]}
              >
                <p>
                  This link is from <strong>{card.name}</strong>. Their fingerprint is{' '}
                  <code data-selectable>{fingerprint}</code>, and it matches the link.
                </p>
                <p>
                  They'll see your request the next time they open Pigeon, and you'll be friends
                  once they add you. Neither of you has to be online at the same time.
                </p>
              </MessageBox>
            )
          }}
        </Match>
        <Match when={current('link-asking')}>
          {(shown) => (
            <MessageBox kind="information" buttons={[{ label: 'Cancel', onClick: back }]}>
              <p>Leaving your request for {shown().name}...</p>
            </MessageBox>
          )}
        </Match>
        <Match when={current('link-asked')}>
          {(shown) => (
            <MessageBox
              kind="information"
              buttons={[{ label: 'OK', isDefault: true, onClick: props.onClose }]}
            >
              <p>
                Your request is waiting for <strong>{shown().name}</strong>. Pigeon tells you when
                they add you, even if you've closed it in the meantime and opened it again.
              </p>
            </MessageBox>
          )}
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

const ASK_STATES: Record<SentAsk['state'], string> = {
  waiting: 'waiting for them',
  declined: 'they said no',
  closed: 'the link had closed',
  busy: 'too many were waiting on the link; ask again later',
  // Never shown: an added request leaves the list.
  added: 'they added you',
}

/** Requests you sent through friends' links, until each is answered and forgotten. */
function SentAsks(props: { messenger: Messenger; now: () => number }) {
  const asks = () => props.messenger.sentAsks()
  return (
    <Show when={asks().length > 0}>
      <ul class={styles.asks} aria-label="Requests you sent">
        <For each={asks()}>
          {(sent) => (
            <li class={styles.ask}>
              <span>
                <strong>{sent.name}</strong>: {ASK_STATES[sent.state]}
                {sent.state === 'waiting' && sent.expires > props.now()
                  ? ` (link ends in ${timeLeft(sent.expires - props.now())})`
                  : ''}
              </span>
              <Button
                label={sent.state === 'waiting' ? 'Stop waiting' : 'OK'}
                onClick={() => void props.messenger.forgetAsk(sent.reply)}
              />
            </li>
          )}
        </For>
      </ul>
    </Show>
  )
}

/**
 * A live code for a friend who's with you, or on the phone: read out, or scanned. It changes
 * after each use and every 30 minutes, made afresh whenever this tab shows none.
 */
function QuickCode(props: {
  messenger: Messenger
  phone: boolean
  now: () => number
  copied: string
  onCopy: () => void
  onNew: () => void
}) {
  const [tick, setTick] = createSignal(0)
  const timer = setInterval(() => setTick((n) => n + 1), 15_000)
  onCleanup(() => clearInterval(timer))
  createEffect(() => {
    if (
      props.messenger.profile().handle !== '' &&
      props.messenger.invite() === undefined &&
      !props.messenger.inviteStopped()
    )
      void props.messenger.newInvite()
  })
  const changesIn = () => {
    tick()
    const current = props.messenger.invite()
    return current === undefined ? '' : timeLeft(current.expiresAt - props.now())
  }
  return (
    <div class={styles.quick}>
      <p class={styles.text}>
        For someone with you or on the phone: read out the code, or let them scan it. It changes
        after each use and every 30 minutes. To send an invite, make a link instead.
      </p>
      <CodeAsks messenger={props.messenger} />
      <Show when={props.messenger.wrongTries() > 0}>
        <p class={styles.warning} role="alert">
          Someone typed a wrong code{' '}
          {props.messenger.wrongTries() === 1 ? 'once' : `${props.messenger.wrongTries()} times`}.
          If that wasn't your friend, someone may be guessing: after {MAX_WRONG_TRIES} Pigeon stops
          the code.
        </p>
      </Show>
      <Show
        when={props.messenger.inviteCode()}
        fallback={
          <Show
            when={props.messenger.inviteStopped()}
            fallback={<p class={styles.muted}>Making a code...</p>}
          >
            <p class={styles.warning} role="alert">
              Someone typed a wrong code too many times, so Pigeon stopped it.
            </p>
            <div class={styles.actions}>
              <Button label="&New code" isDefault onClick={props.onNew} />
            </div>
          </Show>
        }
      >
        {(code) => (
          <div class={styles.share} data-invite-link={props.messenger.inviteLink()}>
            <QrCode
              text={props.messenger.inviteLink() ?? ''}
              label="Invite code as a QR code"
              scale={props.phone ? 5 : 4}
            />
            <div class={styles.column}>
              <p class={styles.code} data-selectable data-invite-code>
                {code()}
              </p>
              <p class={styles.muted}>Changes in {changesIn()}</p>
              <div class={styles.actions}>
                <Button label="Copy &code" isDefault onClick={props.onCopy} />
                <Button label="&New code" onClick={props.onNew} />
              </div>
              <span class={styles.note} aria-live="polite">
                {props.copied}
              </span>
            </div>
          </div>
        )}
      </Show>
      <p class={styles.fingerprint}>
        Your fingerprint:{' '}
        <code data-selectable>{formatFingerprint(props.messenger.selfFingerprint)}</code>
      </p>
    </div>
  )
}

/** Who proved they hold your code, each waiting for you to add or decline them. */
function CodeAsks(props: { messenger: Messenger }) {
  return (
    <Show when={props.messenger.codeAsks().length > 0}>
      <section class={styles.requests} aria-label="Asking to be friends">
        <For each={props.messenger.codeAsks()}>
          {(ask) => <CodeAskRow ask={ask} messenger={props.messenger} />}
        </For>
      </section>
    </Show>
  )
}

function CodeAskRow(props: { ask: CodeAsk; messenger: Messenger }) {
  const [busy, setBusy] = createSignal(false)
  const sameName = () =>
    props.messenger
      .friends()
      .some(
        (friend) =>
          (friend.name === props.ask.handle || friend.handle === props.ask.handle) &&
          friend.id !== props.ask.id,
      ) ||
    props.messenger
      .codeAsks()
      .some((other) => other.handle === props.ask.handle && other.key !== props.ask.key)
  return (
    <div class={styles.request} data-code-ask>
      <FriendAvatar
        messenger={props.messenger}
        id={props.ask.id}
        name={props.ask.handle}
        size={32}
        decorative
      />
      <div class={styles.requestText}>
        <span>
          <strong>{props.ask.handle}</strong> asks to be friends
        </span>
        <span class={styles.muted}>
          Fingerprint <code data-selectable>{formatFingerprint(props.ask.fingerprint)}</code>
        </span>
        <span class={styles.muted}>
          Check it's the one on their screen: anyone who saw the code can ask, with any name.
        </span>
        <Show when={sameName()}>
          <span class={styles.warning}>Someone else here has the same name.</span>
        </Show>
      </div>
      <div class={styles.requestActions}>
        <Button
          label="&Add"
          isDefault
          disabled={busy()}
          onClick={() => {
            setBusy(true)
            void props.messenger.approveAsk(props.ask.key).finally(() => setBusy(false))
          }}
        />
        <Button
          label="&Decline"
          disabled={busy()}
          onClick={() => {
            setBusy(true)
            void props.messenger.declineAsk(props.ask.key).finally(() => setBusy(false))
          }}
        />
      </div>
    </div>
  )
}
