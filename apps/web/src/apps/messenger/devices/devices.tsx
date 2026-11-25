// Your devices (decision 0024): Link a Device on the one you have, Link to My Other Device on the
// new one, and My Devices to see and remove them, or to make a copied profile a new device (0028). Only the first device links and removes. Linking is in person: the new
// device scans or types the code, both show the same 6-digit check, and you confirm on the old one.
import { decodeDeviceLink, formatInviteCode, type Invite } from '@pigeon/core'
import { createSignal, For, Match, onCleanup, Show, Switch } from 'solid-js'
import { Button } from '../../../ui/button/button.tsx'
import { classes } from '../../../ui/classes/classes.ts'
import { GroupBox } from '../../../ui/group-box/group-box.tsx'
import { useLayout } from '../../../ui/layout/layout.ts'
import { TextField } from '../../../ui/text-field/text-field.tsx'
import { Connecting, type StepState } from '../connecting/connecting.tsx'
import { FriendAvatar } from '../friend-avatar/friend-avatar.tsx'
import { QrCode } from '../qr-code/qr-code.tsx'
import type { DeviceOffer, LeaveProgress, Messenger } from '../service/service.ts'
import styles from './devices.module.css'

/** How long the new device waits for you to confirm on the other one. */
export const CONFIRM_LINK_TIMEOUT_MS = 3 * 60 * 1000

export interface LinkDeviceProps {
  messenger: Messenger
  onClose: () => void
}

/** On the device you have: the code to scan or type, then the check and the confirmation. */
export function LinkDevice(props: LinkDeviceProps) {
  const phone = useLayout() === 'phone'
  const [name, setName] = createSignal('')
  const [result, setResult] = createSignal<'linked' | 'failed' | 'too-big' | undefined>()
  if (props.messenger.linking() === undefined) void props.messenger.startLink()
  onCleanup(() => {
    if (result() === undefined) void props.messenger.cancelLink()
  })

  const confirm = async () => {
    const request = props.messenger.linking()?.request
    if (request === undefined) return
    setResult(await props.messenger.confirmLink(name().trim() || request.name))
  }

  return (
    <div class={classes(styles.devices, phone && styles.phone)}>
      <Switch>
        <Match when={result() === 'linked'}>
          <p class={styles.text}>Linked. The new device is yours now, with your friends on it.</p>
          <div class={styles.buttons}>
            <Button label="OK" isDefault onClick={props.onClose} />
          </div>
        </Match>
        <Match when={result() === 'too-big'}>
          <p class={styles.text}>
            You have too many friends to hand over in one go, so nothing was linked. Linking more
            friends than this comes later.
          </p>
          <div class={styles.buttons}>
            <Button label="Close" isDefault onClick={props.onClose} />
          </div>
        </Match>
        <Match when={result() === 'failed'}>
          <p class={styles.text}>That device couldn't be linked. Try again with a new code.</p>
          <div class={styles.buttons}>
            <Button
              label="&New code"
              onClick={() => void props.messenger.startLink().then(() => setResult(undefined))}
            />
            <Button label="Close" isDefault onClick={props.onClose} />
          </div>
        </Match>
        <Match when={props.messenger.linking()?.request}>
          {(request) => (
            <GroupBox legend="Is this your device?">
              <div class={styles.column}>
                <p class={styles.text}>
                  A device asked to be linked. Check that it shows the same number as this one:
                </p>
                <p class={styles.check} data-link-check>
                  {request().check}
                </p>
                <TextField
                  label="&Name it:"
                  stacked={phone}
                  value={name() || request().name}
                  onInput={setName}
                />
                <p class={styles.muted}>
                  It gets your name, your friends and your settings, and catches your chats up from
                  them.
                </p>
                <div class={styles.buttons}>
                  <Button label="&Link" isDefault onClick={() => void confirm()} />
                  <Button label="Cancel" onClick={props.onClose} />
                </div>
              </div>
            </GroupBox>
          )}
        </Match>
        <Match when={props.messenger.linking()}>
          {(linking) => (
            <GroupBox legend="Link a device">
              <div class={styles.share}>
                <QrCode text={linking().link} label="Link as a QR code" scale={4} />
                <div class={styles.column}>
                  <p class={styles.text}>
                    On the new device, scan this with the camera, or open Pigeon and choose File,
                    Link to My Other Device, and type the code. Keep this window open.
                  </p>
                  <p class={styles.code} data-selectable data-link-code>
                    {formatInviteCode(linking().code)}
                  </p>
                  <p class={styles.muted}>
                    Works once, for 10 minutes. Only link devices you hold.
                  </p>
                </div>
              </div>
            </GroupBox>
          )}
        </Match>
      </Switch>
    </div>
  )
}

export interface JoinDeviceProps {
  messenger: Messenger
  /** A link from the address bar, if that's how it came. */
  incoming?: Invite | undefined
  sleep: (ms: number) => Promise<void>
  /** Linked: Pigeon starts again as the identity it joined. */
  onLinked: () => void
  /**
   * Left this Pigeon: forget everything here, then link to `target` (decision 0035), as long as
   * `left` is still the Messenger running in this tab.
   */
  onLeave: (left: Messenger, target: Invite) => void
  onClose: () => void
}

type Join =
  | { readonly kind: 'enter'; readonly error?: string }
  | { readonly kind: 'looking' }
  | { readonly kind: 'offer'; readonly offer: DeviceOffer }
  | { readonly kind: 'done' }
  | { readonly kind: 'failed'; readonly text: string }
  | { readonly kind: 'taken'; readonly target: Invite; readonly text: string }
  | { readonly kind: 'leave'; readonly target: Invite }
  | {
      readonly kind: 'leaving'
      readonly startedAt: number
      readonly progress: LeaveProgress | undefined
      /** Forgetting has begun: nothing to wait for any more. */
      readonly forgetting: boolean
    }

/** How long leaving waits for friends who are online to hear goodbye. */
export const LEAVE_TIMEOUT_MS = 10_000

const FAILURES: Readonly<Record<string, string>> = {
  stopped:
    'Nobody answered. Pigeon has to be open on your other device, with Link a Device showing.',
  impostor: "Whoever answered isn't the Pigeon in the link. Nothing was linked.",
  'has-friends':
    "This Pigeon already has friends of its own. Only a Pigeon with none can be linked, since it takes on the other one's.",
  'has-devices':
    'This Pigeon is already someone’s. Only a new Pigeon can be linked, since it becomes the other one.',
  waiting:
    'This Pigeon was recovered and is waiting for a friend to hand back its list. Linking it now would lose the recovery.',
  own: "That's this device's own code.",
}

/** On the new device: the code, then the check to compare while you confirm on the other one. */
export function JoinDevice(props: JoinDeviceProps) {
  const phone = useLayout() === 'phone'
  const [typed, setTyped] = createSignal('')
  const [view, setView] = createSignal<Join>({ kind: 'enter' })
  let giveUp: () => void = () => undefined

  const join = async (target: Invite) => {
    setView({ kind: 'looking' })
    const stopped = new Promise<void>((resolve) => {
      giveUp = resolve
      void props.sleep(45_000).then(resolve)
    })
    const joined = await props.messenger.joinIdentity(target, stopped)
    if (!joined.ok && (joined.error === 'has-friends' || joined.error === 'has-devices')) {
      setView({ kind: 'taken', target, text: FAILURES[joined.error] ?? '' })
      return
    }
    if (!joined.ok) {
      setView({ kind: 'failed', text: FAILURES[joined.error] ?? 'Nothing was linked.' })
      return
    }
    setView({ kind: 'offer', offer: joined.offer })
    const confirmed = await joined.offer.confirmed(
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
  onCleanup(() => giveUp())
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
  if (props.incoming !== undefined) void join(props.incoming)

  const submit = () => {
    const target = decodeDeviceLink(typed())
    if (!target.ok) {
      setView({ kind: 'enter', error: 'That isn’t a code or a link from Link a Device.' })
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
                {(view() as { error?: string }).error ?? ''}
              </span>
            </form>
          </GroupBox>
        </Match>
        <Match when={view().kind === 'looking'}>
          <p class={styles.text}>Looking for your other device...</p>
          <div class={styles.buttons}>
            <Button label="Cancel" onClick={() => giveUp()} />
          </div>
        </Match>
        <Match when={view().kind === 'offer' && (view() as { offer: DeviceOffer }).offer}>
          {(offer) => (
            <GroupBox legend={`Linking to ${offer().handle}`}>
              <div class={styles.column}>
                <p class={styles.text}>Check that your other device shows this number too:</p>
                <p class={styles.check} data-link-check>
                  {offer().check}
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
        <Match when={view().kind === 'taken' && (view() as Join & { kind: 'taken' })}>
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
        <Match when={view().kind === 'leave' && (view() as Join & { kind: 'leave' })}>
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
        <Match when={view().kind === 'leaving' && (view() as Join & { kind: 'leaving' })}>
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
        <Match when={view().kind === 'failed' && (view() as { text: string }).text}>
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

export interface MyDevicesProps {
  messenger: Messenger
  onLinkDevice: () => void
  /** Forget everything here and link this browser again as a new device (decision 0028). */
  onStartOver: () => void
  onClose: () => void
}

/** Your devices: which is this one, and, on the first device, removing a lost one. */
export function MyDevices(props: MyDevicesProps) {
  const phone = useLayout() === 'phone'
  const [confirming, setConfirming] = createSignal<string | undefined>()
  const [startingOver, setStartingOver] = createSignal(false)
  // Only the first device changes the list (decision 0024).
  const first = () => props.messenger.isFirstDevice()
  return (
    <div class={classes(styles.devices, phone && styles.phone)}>
      <Show when={props.messenger.deviceStatus() === 'removed'}>
        <p class={styles.warning} role="alert">
          This device was removed from your Pigeon by your first device. It keeps the chats it had,
          but talks to nobody now.
        </p>
      </Show>
      <Show when={props.messenger.twin()}>
        <GroupBox legend="Also open somewhere else">
          <div class={styles.column}>
            <p class={styles.warning} role="alert">
              This Pigeon is also open somewhere else: another browser has this device's key, as a
              copied browser profile would. Each copy should be a device of its own.
            </p>
            <Show
              when={startingOver()}
              fallback={
                <p class={styles.muted}>
                  On the copy you want to keep as it is, do nothing. On the other, make it a new
                  device, then link it from your Pigeon.
                </p>
              }
            >
              <p class={styles.warning}>
                This forgets everything in this browser, its chats too, and opens Link to My Other
                Device. Your other copy keeps them. Sure?
              </p>
            </Show>
            <div class={styles.buttons}>
              <Show
                when={startingOver()}
                fallback={
                  <Button
                    label="&Make This a New Device..."
                    onClick={() => setStartingOver(true)}
                  />
                }
              >
                <Button label="Forget and Link Again" onClick={props.onStartOver} />
                <Button label="Cancel" onClick={() => setStartingOver(false)} />
              </Show>
            </div>
          </div>
        </GroupBox>
      </Show>
      <Show when={props.messenger.waitingForList()}>
        <p class={styles.muted}>
          Recovered. Pair with a friend who knew you before, and their Pigeon hands back your whole
          list; until then, no device can be linked here.
        </p>
      </Show>
      <Show when={!first() && props.messenger.deviceStatus() === 'active'}>
        <p class={styles.muted}>
          Devices are linked and removed on the device that manages your list: your first device,
          unless your recovery key moved that to another. Keep it safe: whoever has it manages your
          devices.
        </p>
      </Show>
      <GroupBox legend="My devices">
        <ul class={styles.list} aria-label="My devices">
          <For each={props.messenger.devices()}>
            {(device) => (
              <li class={styles.device}>
                <div class={styles.column}>
                  <strong>
                    {device.name}
                    <Show when={device.fingerprint}>
                      {' · '}
                      <span class={styles.print} data-device-fingerprint>
                        {device.fingerprint}
                      </span>
                    </Show>
                    {device.here ? ' (this device)' : ''}
                  </strong>
                  <span class={styles.muted}>
                    {device.writer
                      ? device.first
                        ? 'Your first device, which manages your list'
                        : 'Manages your list'
                      : device.first
                        ? 'Your first device, where this Pigeon began'
                        : `Linked ${new Date(device.addedAt ?? 0).toLocaleDateString()}`}
                  </span>
                </div>
                <Show when={first() && !device.writer}>
                  <Show
                    when={confirming() === device.id}
                    fallback={
                      <Button label="&Remove..." onClick={() => setConfirming(device.id)} />
                    }
                  >
                    <Button
                      label="Remove"
                      onClick={() => {
                        setConfirming(undefined)
                        void props.messenger.removeDevice(device.id)
                      }}
                    />
                  </Show>
                </Show>
              </li>
            )}
          </For>
        </ul>
        <Show when={confirming()}>
          <p class={styles.warning} role="alert">
            A removed device keeps the chats it already has, but nobody takes anything new from it,
            and it can't come back: link it again and it's a new device.
          </p>
        </Show>
      </GroupBox>
      <div class={styles.buttons}>
        <Button label="&Link a Device..." disabled={!first()} onClick={props.onLinkDevice} />
        <Button label="Close" isDefault onClick={props.onClose} />
      </div>
    </div>
  )
}
