// Link to My Other Device, on the new device: the code, then the check to compare while you
// confirm on the other one. A Pigeon that already has friends or devices can leave and link.
import { decodeDeviceLink, formatFingerprint, type Invite } from '@pigeon/core'
import { createSignal, Match, onCleanup, Show, Switch } from 'solid-js'
import { Button } from '../../../ui/button/button.tsx'
import { classes } from '../../../ui/classes/classes.ts'
import { GroupBox } from '../../../ui/group-box/group-box.tsx'
import { useLayout } from '../../../ui/layout/layout.ts'
import { TextField } from '../../../ui/text-field/text-field.tsx'
import { Connecting, type StepState } from '../connecting/connecting.tsx'
import { FriendAvatar } from '../friend-avatar/friend-avatar.tsx'
import type { DeviceOffer, Messenger } from '../service/messenger.ts'
import styles from './join-device.module.css'
import { FAILURES, isKind, type Join } from './join-flow.ts'

/** How long the new device waits for you to confirm on the other one. */
export const CONFIRM_LINK_TIMEOUT_MS = 3 * 60 * 1000

export interface JoinDeviceProps {
  messenger: Messenger
  /** A link from the address bar, if that's how it came. */
  incoming?: Invite | { readonly old: true } | undefined
  /** You already chose to link to `incoming` (before leaving the old Pigeon): don't ask again. */
  confirmed?: boolean
  sleep: (ms: number) => Promise<void>
  /** Linked: Pigeon starts again as the identity it joined. */
  onLinked: () => void
  /**
   * Left this Pigeon: forget everything here, then link to `target`, as long as
   * `left` is still the Messenger running in this tab.
   */
  onLeave: (left: Messenger, target: Invite) => void
  onClose: () => void
}

/** A link from an older Pigeon, which can't link to this one. */
const OLD_LINK =
  'That link was made by an older Pigeon, which can’t link to this one. Reload Pigeon on your other device, choose Link a Device again, and use the new code or link.'

/** How long leaving waits for friends who are online to hear goodbye. */
export const LEAVE_TIMEOUT_MS = 10_000

/** On the new device: the code, then the check to compare while you confirm on the other one. */
export function JoinDevice(props: JoinDeviceProps) {
  const phone = useLayout() === 'phone'
  const [typed, setTyped] = createSignal('')
  const [view, setView] = createSignal<Join>(
    props.incoming !== undefined && 'old' in props.incoming
      ? { kind: 'failed', text: OLD_LINK }
      : props.incoming === undefined || props.confirmed === true
        ? { kind: 'enter' }
        : { kind: 'arrived', target: props.incoming },
  )
  // `view()` when it is the step `kind`, so a branch reads its own fields without a cast.
  const inKind = <K extends Join['kind']>(kind: K) => {
    const current = view()
    return isKind(current, kind) ? current : undefined
  }
  // The offer on show before this device has asked to be linked.
  const unaskedOffer = () => {
    const offered = inKind('offer')
    return offered !== undefined && !offered.asked ? offered.offer : undefined
  }
  let giveUp: () => void = () => undefined

  const join = async (target: Invite) => {
    setView({ kind: 'looking' })
    const stopped = new Promise<void>((resolve) => {
      giveUp = resolve
      void props.sleep(45_000).then(resolve)
    })
    const joined = await props.messenger
      .joinIdentity(target, stopped)
      .catch(() => ({ ok: false, error: 'stopped' }) as const)
    if (!joined.ok && (joined.error === 'has-friends' || joined.error === 'has-devices')) {
      setView({ kind: 'taken', target, text: FAILURES[joined.error] ?? '' })
      return
    }
    if (!joined.ok) {
      setView({ kind: 'failed', text: FAILURES[joined.error] ?? 'Nothing was linked.' })
      return
    }
    // From a link the fingerprint was checked; from a typed code you compare it first.
    setView({ kind: 'offer', offer: joined.offer, asked: false })
    if (joined.offer.checked) await ask(joined.offer)
  }

  const ask = async (offer: DeviceOffer) => {
    setView({ kind: 'offer', offer, asked: true })
    const confirmed = await offer.confirmed(
      new Promise<void>((resolve) => {
        giveUp = resolve
        void props.sleep(CONFIRM_LINK_TIMEOUT_MS).then(resolve)
      }),
    )
    if (!confirmed) {
      setView({
        kind: 'failed',
        text: 'It wasn’t confirmed on the other device. Nothing was linked.',
      })
      return
    }
    setView({ kind: 'done' })
    void props.sleep(1500).then(props.onLinked)
  }
  onCleanup(() => {
    giveUp()
    // Closed while it showed whose Pigeon answered: nothing was asked, so leave its room.
    const shown = view()
    if (shown.kind === 'offer' && !shown.asked) void shown.offer.cancel()
  })
  // Don't Wait ends the wait for friends who haven't heard yet.
  let stopWaiting: () => void = () => undefined
  const leave = async (target: Invite) => {
    const startedAt = Date.now()
    setView({ kind: 'leaving', startedAt, progress: undefined, forgetting: false })
    const waited = new Promise<void>((resolve) => {
      stopWaiting = resolve
      void props.sleep(LEAVE_TIMEOUT_MS).then(resolve)
    })
    try {
      await props.messenger.leave(waited, (progress) =>
        setView({ kind: 'leaving', startedAt, progress, forgetting: false }),
      )
      setView((current) =>
        current.kind === 'leaving' ? { ...current, forgetting: true } : current,
      )
    } catch (error) {
      console.error(error)
      setView({
        kind: 'failed',
        text: 'Something went wrong while leaving. Some friends may have been told; nothing here was forgotten.',
      })
      return
    }
    props.onLeave(props.messenger, target)
  }
  if (props.incoming !== undefined && !('old' in props.incoming) && props.confirmed === true)
    void join(props.incoming)

  const submit = () => {
    const target = decodeDeviceLink(typed())
    if (!target.ok) {
      setView({
        kind: 'enter',
        error:
          target.error === 'old'
            ? 'That looks like an 8-character code from an older Pigeon. Reload Pigeon on your other device and type the new 10-character code.'
            : 'That isn’t a code or a link from Link a Device.',
      })
      return
    }
    void join(target.value)
  }

  return (
    <div class={classes(styles.devices, phone && styles.phone)}>
      <Switch>
        <Match when={view().kind === 'enter'}>
          <GroupBox legend="Link to my other device">
            <form
              class={styles.column}
              onSubmit={(event) => {
                event.preventDefault()
                submit()
              }}
            >
              <p class={styles.text}>
                On the device that has your Pigeon, choose File, Link a Device, and type the code it
                shows here. This Pigeon becomes that one, with its name and friends.
              </p>
              <TextField
                label="&Code or link:"
                stacked={phone}
                value={typed()}
                onInput={setTyped}
              />
              <div class={styles.buttons}>
                <Button label="&Link" type="submit" isDefault disabled={typed().trim() === ''} />
                <Button label="Cancel" onClick={props.onClose} />
              </div>
              <span class={styles.error} role="alert">
                {inKind('enter')?.error ?? ''}
              </span>
            </form>
          </GroupBox>
        </Match>
        <Match when={inKind('arrived')}>
          {(arrived) => (
            <GroupBox legend="Link to my other device">
              <div class={styles.column}>
                <p class={styles.text}>
                  This link makes this browser one of another Pigeon's devices, with its name and
                  friends. Whoever has that Pigeon sees everything you do here.
                </p>
                <p class={styles.text}>
                  Link only if it came from your own other device, showing Link a Device now.
                </p>
                <div class={styles.buttons}>
                  <Button label="&Link" isDefault onClick={() => void join(arrived().target)} />
                  <Button label="Cancel" onClick={props.onClose} />
                </div>
              </div>
            </GroupBox>
          )}
        </Match>
        <Match when={view().kind === 'looking'}>
          <p class={styles.text}>Looking for your other device...</p>
          <div class={styles.buttons}>
            <Button label="Cancel" onClick={() => giveUp()} />
          </div>
        </Match>
        <Match when={unaskedOffer()}>
          {(offer) => (
            <GroupBox legend={`Linking to ${offer().handle}`}>
              <div class={styles.column}>
                <p class={styles.text}>
                  Check that this is your own Pigeon: Link a Device on your other device shows its
                  fingerprint, and it should be this one.
                </p>
                <p class={styles.check} data-identity-check>
                  {formatFingerprint(offer().identityFingerprint)}
                </p>
                <p class={styles.warning}>
                  Anyone who saw the code could have answered. If it's different, cancel.
                </p>
                <div class={styles.buttons}>
                  <Button label="&Continue" isDefault onClick={() => void ask(offer())} />
                  <Button
                    label="Cancel"
                    onClick={() => {
                      const current = offer()
                      void current.cancel()
                      setView({ kind: 'enter' })
                    }}
                  />
                </div>
              </div>
            </GroupBox>
          )}
        </Match>
        <Match when={inKind('offer')?.offer}>
          {(offer) => (
            <GroupBox legend={`Linking to ${offer().handle}`}>
              <div class={styles.column}>
                <p class={styles.text}>
                  Check that your other device shows this fingerprint too: it's this device's.
                </p>
                <p class={styles.check} data-link-check>
                  {formatFingerprint(offer().fingerprint)}
                </p>
                <p class={styles.text}>Then choose Link over there. This one waits.</p>
                <div class={styles.buttons}>
                  <Button label="Cancel" onClick={() => giveUp()} />
                </div>
              </div>
            </GroupBox>
          )}
        </Match>
        <Match when={view().kind === 'done'}>
          <p class={styles.text}>Linked. Pigeon is starting again as you.</p>
        </Match>
        <Match when={inKind('taken')}>
          {(taken) => (
            <div class={styles.column}>
              <p class={styles.text}>{taken().text}</p>
              <p class={styles.muted}>
                To use the other one here instead, leave this Pigeon: it's forgotten in this
                browser, and this browser links to the other one.
              </p>
              <div class={styles.buttons}>
                <Button
                  label="&Leave This Pigeon and Link..."
                  onClick={() => setView({ kind: 'leave', target: taken().target })}
                />
                <Button label="Close" isDefault onClick={props.onClose} />
              </div>
            </div>
          )}
        </Match>
        <Match when={inKind('leave')}>
          {(leaving) => (
            <GroupBox legend="Leave this Pigeon">
              <div class={styles.column}>
                <Show
                  when={!props.messenger.leavingTells()}
                  fallback={
                    <p class={styles.warning}>
                      This forgets everything in this browser: its name, friends and chats. Its
                      friends who are online now are told you left, the rest see it go quiet. Add
                      them again from the Pigeon you keep. Sure?
                    </p>
                  }
                >
                  <p class={styles.warning}>
                    This forgets everything in this browser: its name, friends and chats. This
                    Pigeon is on other devices or in another browser too, which keep it, so its
                    friends aren't told. Sure?
                  </p>
                </Show>
                <p class={styles.muted}>
                  The code is tried once this Pigeon is gone, so check it came from your other
                  device.
                </p>
                <div class={styles.buttons}>
                  <Button label="Leave and Link" onClick={() => void leave(leaving().target)} />
                  <Button label="Cancel" isDefault onClick={props.onClose} />
                </div>
              </div>
            </GroupBox>
          )}
        </Match>
        <Match when={inKind('leaving')}>
          {(leaving) => {
            const progress = () => leaving().progress
            const total = () => progress()?.total ?? 0
            const telling = () => progress()?.step === 'telling'
            const state = (step: 0 | 1 | 2): StepState => {
              const at = leaving().forgetting ? 2 : telling() ? 1 : 0
              return step < at ? 'done' : step === at ? 'current' : 'pending'
            }
            const friends = (count: number) => `${count} ${count === 1 ? 'friend' : 'friends'}`
            return (
              <Connecting
                friend="Your friends"
                you={
                  <FriendAvatar
                    messenger={props.messenger}
                    id={props.messenger.self}
                    name="You"
                    size={32}
                    decorative
                  />
                }
                startedAt={leaving().startedAt}
                timeoutMs={LEAVE_TIMEOUT_MS}
                now={Date.now}
                countdown={(seconds) =>
                  `Pigeon goes on without the rest in ${seconds} ${seconds === 1 ? 'second' : 'seconds'}.`
                }
                cancelLabel="&Don't Wait"
                onCancel={() => stopWaiting()}
                steps={[
                  {
                    label:
                      progress() === undefined
                        ? 'Removing your friends here'
                        : `Removing ${friends(total())} here`,
                    state: state(0),
                  },
                  {
                    label: telling()
                      ? `Telling them you left: ${progress()?.done ?? 0} of ${total()} heard`
                      : 'Telling them you left',
                    state: state(1),
                  },
                  { label: 'Forgetting this Pigeon and linking', state: state(2) },
                ]}
                hint={{
                  afterMs: 4000,
                  text: 'Only friends who are online now can hear it. The rest see this Pigeon go quiet.',
                }}
              />
            )
          }}
        </Match>
        <Match when={inKind('failed')?.text}>
          {(text) => (
            <>
              <p class={styles.text}>{text()}</p>
              <div class={styles.buttons}>
                <Button label="&Try again" onClick={() => setView({ kind: 'enter' })} />
                <Button label="Close" isDefault onClick={props.onClose} />
              </div>
            </>
          )}
        </Match>
      </Switch>
    </div>
  )
}
