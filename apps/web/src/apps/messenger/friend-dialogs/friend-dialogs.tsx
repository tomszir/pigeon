// The small windows a friend's menu opens: their profile, a name of your own for them, muting,
// removing (and blocking), and the people you've blocked.
import { formatFingerprint, type PeerId } from '@pigeon/core'
import { createSignal, For, type JSX, Show } from 'solid-js'
import { Button } from '../../../ui/button/button.tsx'
import { Check } from '../../../ui/check/check.tsx'
import { classes } from '../../../ui/classes/classes.ts'
import { useLayout } from '../../../ui/layout/layout.ts'
import { MessageBox } from '../../../ui/message-box/message-box.tsx'
import { TextField } from '../../../ui/text-field/text-field.tsx'
import { FriendAvatar } from '../friend-avatar/friend-avatar.tsx'
import { clockTime } from '../live-conversation/clock-text.ts'
import { MUTED_FOREVER } from '../service/friends.ts'
import type { FriendView, Messenger } from '../service/messenger.ts'
import styles from './friend-dialogs.module.css'

const STATUS: Record<FriendView['presence']['status'], string> = {
  online: 'Online',
  away: 'Away',
  busy: 'Busy',
}

/** "November 24, 2026". */
const longDate = (at: number) =>
  new Date(at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

/** "until 6:38 PM", "until November 25 at 6:38 PM", "until you unmute them". */
export function mutedUntilText(until: number, now: number): string {
  if (until === MUTED_FOREVER) return 'until you unmute them'
  const sameDay = new Date(until).toDateString() === new Date(now).toDateString()
  return sameDay
    ? `until ${clockTime(until)}`
    : `until ${new Date(until).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })} at ${clockTime(until)}`
}

function Dialog(props: { children: JSX.Element; buttons: JSX.Element }) {
  return (
    <div class={classes(styles.dialog, useLayout() === 'phone' && styles.phone)}>
      <div class={styles.body}>{props.children}</div>
      <div class={styles.buttons}>{props.buttons}</div>
    </div>
  )
}

const Gone = (props: { onClose: () => void }) => (
  <MessageBox
    kind="information"
    buttons={[{ label: 'OK', isDefault: true, onClick: props.onClose }]}
  >
    <p>This friend is no longer on your list.</p>
  </MessageBox>
)

interface FriendDialogProps {
  messenger: Messenger
  friend: PeerId
  onClose: () => void
  now: () => number
}

export function FriendProfile(props: FriendDialogProps & { onRename: () => void }) {
  const wide = () => (useLayout() === 'phone' ? styles.wide : undefined)
  return (
    <Show when={props.messenger.friend(props.friend)} fallback={<Gone onClose={props.onClose} />}>
      {(view) => (
        <Dialog
          buttons={
            <>
              <Button label="&Rename..." onClick={props.onRename} class={wide()} />
              <Button label="Close" isDefault onClick={props.onClose} class={wide()} />
            </>
          }
        >
          <div class={styles.profile}>
            <FriendAvatar
              messenger={props.messenger}
              id={props.friend}
              name={view().name}
              size={64}
            />
            <dl class={styles.facts}>
              <dt>Name</dt>
              <dd>
                <strong>{view().name}</strong>
                <Show when={view().petname !== undefined}>
                  <span class={styles.muted}> (calls themselves {view().handle})</span>
                </Show>
              </dd>
              <dt>Status</dt>
              <dd>
                {view().removedYouAt !== undefined
                  ? 'Removed you as a friend'
                  : view().online
                    ? STATUS[view().presence.status]
                    : 'Offline'}
              </dd>
              <Show when={view().presence.message !== ''}>
                <dt>Message</dt>
                <dd>{view().presence.message}</dd>
              </Show>
              <dt>Fingerprint</dt>
              <dd>
                <code data-selectable>{formatFingerprint(view().fingerprint)}</code>
              </dd>
              <dt>Friends since</dt>
              <dd>{view().addedAt > 0 ? longDate(view().addedAt) : 'Unknown'}</dd>
              <Show when={props.messenger.muted(props.friend)}>
                <dt>Muted</dt>
                <dd>{mutedUntilText(view().mutedUntil ?? MUTED_FOREVER, props.now())}</dd>
              </Show>
            </dl>
          </div>
          <p class={styles.note}>
            Compare the fingerprint with the one in {view().name}'s Add a Friend window to be sure
            it's really them.
          </p>
        </Dialog>
      )}
    </Show>
  )
}

export function RenameFriend(props: FriendDialogProps) {
  const view = () => props.messenger.friend(props.friend)
  const [name, setName] = createSignal(view()?.name ?? '')
  const phone = useLayout() === 'phone'
  const save = () => void props.messenger.rename(props.friend, name()).then(props.onClose)
  return (
    <Show when={view()} fallback={<Gone onClose={props.onClose} />}>
      {(current) => (
        <Dialog
          buttons={
            <>
              <Button label="OK" isDefault onClick={save} class={phone ? styles.wide : undefined} />
              <Button
                label="Cancel"
                onClick={props.onClose}
                class={phone ? styles.wide : undefined}
              />
            </>
          }
        >
          <TextField label="&Call them:" value={name()} stacked onInput={setName} onSubmit={save} />
          <p class={styles.note}>
            Only you see this name. Leave it empty to go back to the one they chose,{' '}
            <strong>{current().handle}</strong>.
          </p>
        </Dialog>
      )}
    </Show>
  )
}

const MUTE_CHOICES = [
  { id: 'hour', label: 'For &1 hour', ms: 60 * 60 * 1000 },
  { id: 'eight', label: 'For &8 hours', ms: 8 * 60 * 60 * 1000 },
  { id: 'day', label: 'For a &day', ms: 24 * 60 * 60 * 1000 },
  { id: 'forever', label: '&Until I unmute them', ms: undefined },
] as const

export function MuteFriend(props: FriendDialogProps) {
  const [choice, setChoice] = createSignal<(typeof MUTE_CHOICES)[number]['id']>('hour')
  const phone = useLayout() === 'phone'
  const save = () => {
    const picked = MUTE_CHOICES.find((option) => option.id === choice())
    const until = picked?.ms === undefined ? MUTED_FOREVER : props.now() + picked.ms
    void props.messenger.mute(props.friend, until).then(props.onClose)
  }
  return (
    <Show when={props.messenger.friend(props.friend)} fallback={<Gone onClose={props.onClose} />}>
      {(view) => (
        <Dialog
          buttons={
            <>
              <Button
                label="&Mute"
                isDefault
                onClick={save}
                class={phone ? styles.wide : undefined}
              />
              <Button
                label="Cancel"
                onClick={props.onClose}
                class={phone ? styles.wide : undefined}
              />
            </>
          }
        >
          <p class={styles.lead}>
            Messages from {view().name} still arrive, but no balloons pop up, and their buzzes don't
            shake or vibrate.
          </p>
          <div class={styles.choices} role="radiogroup" aria-label="Mute for">
            <For each={MUTE_CHOICES}>
              {(option) => (
                <Check
                  kind="radio"
                  name="mute-for"
                  label={option.label}
                  checked={choice() === option.id}
                  onChange={(on) => {
                    if (on) setChoice(option.id)
                  }}
                />
              )}
            </For>
          </div>
        </Dialog>
      )}
    </Show>
  )
}

/**
 * Where removing someone reaches: every device of yours, but one on a Pigeon from before your
 * devices kept your data in step, which hears it once it updates.
 */
export function everywhere(older: readonly string[]): string {
  if (older.length === 0) return 'on all your devices'
  const names =
    older.length === 1 ? older[0] : `${older.slice(0, -1).join(', ')} and ${older.at(-1)}`
  return `on all your devices except ${names}, which ${older.length === 1 ? 'needs' : 'need'} updating`
}

export function RemoveFriend(props: FriendDialogProps) {
  const [block, setBlock] = createSignal(false)
  const where = () => everywhere(props.messenger.notInStep())
  const remove = () =>
    void props.messenger.remove(props.friend, { block: block() }).then(props.onClose)
  return (
    <Show when={props.messenger.friend(props.friend)} fallback={<Gone onClose={props.onClose} />}>
      {(view) => (
        <MessageBox
          kind="warning"
          buttons={[
            { label: '&Remove', onClick: remove },
            { label: 'Cancel', isDefault: true, onClick: props.onClose },
          ]}
        >
          <Show
            when={view().removedYouAt === undefined}
            fallback={
              <p>
                {view().name} has already removed you. Remove them too, and delete your chat{' '}
                {where()}?
              </p>
            }
          >
            <p>
              Remove <strong>{view().name}</strong> from your friends {where()}? Your chat with them
              is deleted on each, and their Pigeon is told, now or the next time you're both online.
            </p>
          </Show>
          <div class={styles.choice}>
            <Check
              label={`Also &block ${view().name}`}
              checked={block()}
              onChange={setBlock}
              description="They can't add you again until you unblock them in Contacts, Blocked People."
            />
          </div>
        </MessageBox>
      )}
    </Show>
  )
}

export function BlockedPeople(props: { messenger: Messenger; onClose: () => void }) {
  const phone = useLayout() === 'phone'
  return (
    <Dialog
      buttons={
        <Button
          label="Close"
          isDefault
          onClick={props.onClose}
          class={phone ? styles.wide : undefined}
        />
      }
    >
      <Show
        when={props.messenger.blocked().length > 0}
        fallback={<p class={styles.lead}>You haven't blocked anyone.</p>}
      >
        <p class={styles.lead}>These people can't add you as a friend.</p>
        <ul class={styles.blocked}>
          <For each={props.messenger.blocked()}>
            {(person) => (
              <li class={styles.person}>
                <span class={styles.someone}>
                  <FriendAvatar
                    messenger={props.messenger}
                    id={person.id}
                    name={person.handle}
                    size={24}
                    decorative
                  />
                  <span class={styles.who}>
                    <strong>{person.handle}</strong>
                    <span class={styles.muted}>blocked {longDate(person.at)}</span>
                  </span>
                </span>
                <Button label={`Unblock`} onClick={() => void props.messenger.unblock(person.id)} />
              </li>
            )}
          </For>
        </ul>
      </Show>
    </Dialog>
  )
}
