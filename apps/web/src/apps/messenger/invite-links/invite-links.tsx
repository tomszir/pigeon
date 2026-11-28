// Invite links: make one that lasts a while and lets in a few people, and see who asked through
// each. Links wait at your Lighthouses, so friends can use them while you're offline; nobody is
// added until you say Add. Requests waiting for you come first, then a new link, then your links.
import { DEFAULT_INVITE_LINK_LIFETIME, DEFAULT_INVITE_LINK_USES, type PeerId } from '@pigeon/core'
import { createSignal, For, Show } from 'solid-js'
import { Button } from '../../../ui/button/button.tsx'
import { classes } from '../../../ui/classes/classes.ts'
import { GroupBox } from '../../../ui/group-box/group-box.tsx'
import { Select } from '../../../ui/select/select.tsx'
import { FriendAvatar } from '../friend-avatar/friend-avatar.tsx'
import type { LinkRequest, OwnLink } from '../service/invite-links.ts'
import type { Messenger } from '../service/messenger.ts'
import styles from './invite-links.module.css'

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

export const LIFETIMES = [
  { value: String(HOUR), label: '1 hour' },
  { value: String(DAY), label: '1 day' },
  { value: String(7 * DAY), label: '7 days' },
] as const

export const USES = [
  { value: '1', label: '1 person' },
  { value: '5', label: '5 people' },
  { value: '10', label: '10 people' },
  { value: '25', label: '25 people' },
] as const

/** "6 days", "5 hours", "40 minutes": how long is left, rounded down, never "0". */
export function timeLeft(ms: number): string {
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
  if (ms >= 2 * DAY) return plural(Math.floor(ms / DAY), 'day')
  if (ms >= 2 * HOUR) return plural(Math.floor(ms / HOUR), 'hour')
  return plural(Math.max(1, Math.floor(ms / MINUTE)), 'minute')
}

/** "pigeon.tomszir.com/#b/zbyd…5v4vju": enough to tell links apart, short enough for one line. */
export function shortLink(url: string): string {
  const bare = url.replace(/^https?:\/\//, '')
  const hash = bare.search(/#b\//)
  if (hash < 0) return bare
  const body = bare.slice(hash + 3).split('?')[0] ?? ''
  return `${bare.slice(0, hash + 3)}${body.slice(0, 4)}…${body.slice(-6)}`
}

/**
 * What Copy Link puts on the clipboard: a line saying who it's from, then the link, ready to paste
 * into a chat. The name stays in the message itself; a link preview only ever shows the site's own
 * card, since nothing after the `#` reaches a server. Pasted back into Have an Invite?, the whole
 * message still opens, as the link is read from its `#`.
 */
export function inviteMessage(name: string, url: string): string {
  const from = name.trim()
  return `${from === '' ? "You're invited to Pigeon!" : `${from} invites you to Pigeon!`}\n${url}`
}

/** What Add a Friend says when a link couldn't be made. */
export const MAKE_ERRORS = {
  'no-lighthouse':
    "Links wait at your Lighthouses, and yours all need a pass. Add one that doesn't in Network.",
  'not-stored':
    "An official Lighthouse can't be reached right now, and it's where people opening the link look for it. Try again in a moment.",
  'named-not-stored':
    "The first Lighthouse on your list in Network can't be reached right now, and it's where people opening the link look for it. Try again in a moment, or put one that's up first.",
  'no-name': 'Choose a name first.',
  removed: 'This device was taken off your list.',
} as const

export interface InviteLinksProps {
  messenger: Messenger
  copyText: (text: string) => Promise<boolean>
  phone: boolean
  now: () => number
}

/** How many people are waiting for you, on every link: for the tab's label. */
export const waitingCount = (messenger: Messenger): number =>
  messenger
    .inviteLinks()
    .reduce(
      (n, link) => n + link.requests.filter((request) => request.state === 'waiting').length,
      0,
    )

export function InviteLinks(props: InviteLinksProps) {
  const [lifetime, setLifetime] = createSignal(String(DEFAULT_INVITE_LINK_LIFETIME))
  const [uses, setUses] = createSignal(String(DEFAULT_INVITE_LINK_USES))
  const [making, setMaking] = createSignal(false)
  const [error, setError] = createSignal('')
  const [copied, setCopied] = createSignal<string | undefined>(undefined)

  const copy = async (link: OwnLink) => {
    const done = await props.copyText(inviteMessage(props.messenger.profile().handle, link.url))
    setCopied(done ? link.secret : undefined)
    if (!done) setError('Pigeon couldn’t copy the link here. Try again.')
  }

  const make = async () => {
    setMaking(true)
    setError('')
    const made = await props.messenger.makeInviteLink({
      lifetime: Number(lifetime()),
      uses: Number(uses()),
    })
    setMaking(false)
    if (!made.ok) {
      setError(MAKE_ERRORS[made.error])
      return
    }
    await copy(made.link)
  }

  /** Links still worth showing: open ones, newest first. */
  const open = () =>
    [...props.messenger.inviteLinks()]
      .filter((link) => link.open && link.expires > props.now())
      .sort((a, b) => b.madeAt - a.madeAt)

  /** Everyone waiting for you, on any link, open or not, oldest first. */
  const waiting = () =>
    props.messenger
      .inviteLinks()
      .flatMap((link) =>
        link.requests
          .filter((request) => request.state === 'waiting')
          .map((request) => ({ link, request })),
      )
      .sort((a, b) => a.request.at - b.request.at)

  const elsewhere = () =>
    props.messenger.inviteLinksElsewhere().filter((link) => link.open && link.expires > props.now())
      .length

  return (
    <div class={classes(styles.links, props.phone && styles.phone)}>
      <Show when={waiting().length > 0}>
        <GroupBox legend={`Waiting for you (${waiting().length})`}>
          <div class={styles.requests}>
            <For each={waiting()}>
              {({ link, request }) => (
                <RequestRow
                  request={request}
                  link={link}
                  messenger={props.messenger}
                  now={props.now}
                />
              )}
            </For>
          </div>
        </GroupBox>
      </Show>

      <GroupBox legend="New link">
        <div class={styles.column}>
          <p class={styles.text}>
            Send one link to as many friends as you choose. It waits at your Lighthouses, so it
            works while you're offline, and nobody is added until you say so.
          </p>
          <div class={styles.make}>
            <Select
              label={props.phone ? '&Lasts' : '&Lasts:'}
              stacked={props.phone}
              options={LIFETIMES}
              value={lifetime()}
              onChange={setLifetime}
              class={styles.choice}
            />
            <Select
              label={props.phone ? '&For' : '&For:'}
              stacked={props.phone}
              options={USES}
              value={uses()}
              onChange={setUses}
              class={styles.choice}
            />
            <Button
              label={making() ? 'Making...' : '&Make link'}
              isDefault
              disabled={making()}
              onClick={() => void make()}
              class={styles.makeButton}
            />
          </div>
          <span class={styles.error} role="alert">
            {error()}
          </span>
        </div>
      </GroupBox>

      <GroupBox legend="Your links">
        <Show
          when={open().length > 0}
          fallback={<p class={styles.muted}>No open links. Make one above.</p>}
        >
          <ul class={styles.list} aria-label="Your invite links">
            <For each={open()}>
              {(link) => (
                <LinkRow
                  link={link}
                  messenger={props.messenger}
                  now={props.now}
                  copied={copied() === link.secret}
                  onCopy={() => void copy(link)}
                />
              )}
            </For>
          </ul>
        </Show>
        <Show when={elsewhere() > 0}>
          <p class={styles.muted}>
            {elsewhere() === 1
              ? 'One more is open on another of your devices; requests through it go there.'
              : `${elsewhere()} more are open on your other devices; requests through them go there.`}
          </p>
        </Show>
      </GroupBox>
    </div>
  )
}

function status(link: OwnLink, now: number): string {
  const people =
    link.uses === 1 ? 'For 1 person' : `${link.uses - link.used} of ${link.uses} places left`
  return `${people} · ends in ${timeLeft(link.expires - now)}`
}

function LinkRow(props: {
  link: OwnLink
  messenger: Messenger
  now: () => number
  copied: boolean
  onCopy: () => void
}) {
  return (
    <li class={styles.link}>
      <div class={styles.linkText}>
        <span class={styles.linkLine}>
          <button
            type="button"
            class={styles.url}
            title={`${props.link.url} (click to copy)`}
            aria-label={`Copy ${props.link.url}`}
            onClick={props.onCopy}
          >
            {shortLink(props.link.url)}
          </button>
          <Show when={props.copied}>
            <span class={styles.note} aria-live="polite">
              Copied
            </span>
          </Show>
        </span>
        <span class={styles.muted}>{status(props.link, props.now())}</span>
      </div>
      <div class={styles.actions}>
        <Button label="&Copy link" onClick={props.onCopy} />
        <Button
          label="&Delete"
          onClick={() => void props.messenger.cancelInviteLink(props.link.secret)}
        />
      </div>
    </li>
  )
}

function RequestRow(props: {
  request: LinkRequest
  link: OwnLink
  messenger: Messenger
  now: () => number
}) {
  const [busy, setBusy] = createSignal(false)
  const sameName = () =>
    props.messenger
      .friends()
      .some(
        (friend) =>
          (friend.name === props.request.name || friend.handle === props.request.name) &&
          friend.id !== props.request.identity,
      ) ||
    props.link.requests.some(
      (other) => other.name === props.request.name && other.identity !== props.request.identity,
    )
  const already = () => props.messenger.friend(props.request.identity as PeerId) !== undefined
  const full = () =>
    !props.link.open || props.link.used >= props.link.uses || props.link.expires <= props.now()
  return (
    <div class={styles.request}>
      <FriendAvatar
        messenger={props.messenger}
        id={props.request.identity}
        name={props.request.name}
        size={32}
        decorative
      />
      <div class={styles.requestText}>
        <span>
          <strong>{props.request.name}</strong> asks to be friends
        </span>
        <span class={styles.muted}>
          Fingerprint <code data-selectable>{props.request.fingerprint}</code>
        </span>
        <span class={styles.muted}>
          Check it with them some other way: anyone with the link can use any name.
        </span>
        <Show when={already()}>
          <span class={styles.muted}>Already your friend: adding them pairs you again.</span>
        </Show>
        <Show when={sameName()}>
          <span class={styles.warning}>Someone else here has the same name.</span>
        </Show>
        <Show when={full()}>
          <span class={styles.warning}>Its link is closed, so they can't be added through it.</span>
        </Show>
      </div>
      <div class={styles.requestActions}>
        <Button
          label="&Add"
          isDefault
          disabled={busy() || full()}
          onClick={() => {
            setBusy(true)
            void props.messenger
              .approveRequest(props.link.secret, props.request.identity)
              .finally(() => setBusy(false))
          }}
        />
        <Button
          label="&Decline"
          disabled={busy()}
          onClick={() => {
            setBusy(true)
            void props.messenger
              .declineRequest(props.link.secret, props.request.identity)
              .finally(() => setBusy(false))
          }}
        />
      </div>
    </div>
  )
}
