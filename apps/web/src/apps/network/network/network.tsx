// Network: how this Pigeon connects. Lighthouses lists where friends leave mail for you, whether
// each answers now and what it says it runs, and lets you add one by its address or take one
// off; Connection holds the relay setting and what's connected right now. A Lighthouse is named
// by its key, which every reply it sends is checked against, so its name and what it runs are
// only its own word. On the Pocket it's one page, with the keys a finger can hit.
import {
  formatFingerprint,
  type LighthouseAddress,
  type LighthouseSoftware,
  parseLighthouseAddress,
} from '@pigeon/core'
import { createSignal, For, type JSX, onCleanup, onMount, Show } from 'solid-js'
import { Button } from '../../../ui/button/button.tsx'
import { Check } from '../../../ui/check/check.tsx'
import { classes } from '../../../ui/classes/classes.ts'
import { GroupBox } from '../../../ui/group-box/group-box.tsx'
import { tango } from '../../../ui/icons/icons.ts'
import { useLayout } from '../../../ui/layout/layout.ts'
import { Tabs } from '../../../ui/tabs/tabs.tsx'
import { TextField } from '../../../ui/text-field/text-field.tsx'
import styles from './network.module.css'

/** What Network needs from the Messenger. */
export interface NetworkMessenger {
  lighthouses(): readonly LighthouseAddress[]
  setLighthouses(next: readonly LighthouseAddress[]): Promise<void>
  checkLighthouse(
    address: LighthouseAddress,
  ): Promise<{ ok: true; value: LighthouseSoftware } | { ok: false; error: string }>
  fingerprintOf(id: string): Promise<string>
  /** Friends connected now, and how many there are. */
  onlineCount(): number
  friends(): readonly unknown[]
  /** Signaling relays reachable now, where the transport can tell. */
  relays(): { readonly reachable: number; readonly total: number } | undefined
}

export interface NetworkProps {
  /** Undefined while the Messenger starts, or when it can't. */
  messenger: NetworkMessenger | undefined
  /**
   * The official Lighthouses: labelled so, and only ever turned off and on again, never removed,
   * since finding their addresses again would be hard.
   */
  official: readonly LighthouseAddress[]
  relayOnly: boolean | undefined
  onRelayOnly: (on: boolean) => void
  /** Hear about mail at once; undefined until the Messenger has started. */
  hearAtOnce?: boolean | undefined
  onHearAtOnce?: (on: boolean) => void
  onClose: () => void
}

type Status =
  | { readonly kind: 'checking' }
  | { readonly kind: 'answering'; readonly software: LighthouseSoftware }
  | { readonly kind: 'failed'; readonly error: string }

const PROBLEMS: Readonly<Record<string, string>> = {
  protocol: 'Speaks another version: one of you needs an update.',
  pass: 'Needs a pass this address doesn’t have.',
  'bad-reply': 'Answered as some other Lighthouse.',
  busy: 'Busy.',
  'no-client': 'Not available in this browser.',
}

/** Rechecked this often while Network is open. */
const RECHECK_MS = 60_000

const host = (address: LighthouseAddress) => {
  try {
    return new URL(address.url).host
  } catch {
    return address.url
  }
}

/** Each Lighthouse's state, checked as Network opens and every minute while it's open. */
function createChecks(messenger: () => NetworkMessenger | undefined) {
  const [statuses, setStatuses] = createSignal<Readonly<Record<string, Status>>>({})
  const [prints, setPrints] = createSignal<Readonly<Record<string, string>>>({})
  const check = async (address: LighthouseAddress): Promise<boolean> => {
    const running = messenger()
    if (running === undefined) return false
    setStatuses((all) =>
      all[address.id] === undefined ? { ...all, [address.id]: { kind: 'checking' } } : all,
    )
    const [answer, print] = await Promise.all([
      running.checkLighthouse(address),
      running.fingerprintOf(address.id),
    ])
    setPrints((all) => ({ ...all, [address.id]: formatFingerprint(print) }))
    setStatuses((all) => ({
      ...all,
      [address.id]: answer.ok
        ? { kind: 'answering', software: answer.value }
        : { kind: 'failed', error: answer.error },
    }))
    return answer.ok
  }
  const checkAll = () => {
    for (const address of messenger()?.lighthouses() ?? []) void check(address)
  }
  onMount(() => {
    checkAll()
    const timer = setInterval(checkAll, RECHECK_MS)
    onCleanup(() => clearInterval(timer))
  })
  const answering = () =>
    (messenger()?.lighthouses() ?? []).filter(
      (address) => statuses()[address.id]?.kind === 'answering',
    ).length
  return { statuses, prints, check, answering }
}

type Checks = ReturnType<typeof createChecks>

function StatusLine(props: { status: Status | undefined; others: number; short: boolean }) {
  const text = (): string => {
    const status = props.status
    if (status === undefined || status.kind === 'checking') return 'Checking...'
    if (status.kind === 'answering')
      return props.short
        ? 'Answering'
        : `Answering. Says it runs ${status.software.name} ${status.software.version}.`
    const problem = PROBLEMS[status.error]
    if (props.short) return problem === undefined ? 'Not answering' : problem.replace(/\.$/, '')
    if (problem !== undefined) return problem
    return props.others > 0 ? 'Not answering. Mail is still left at the others.' : 'Not answering.'
  }
  const ok = () => props.status?.kind === 'answering'
  return (
    <span
      class={classes(
        styles.status,
        props.status?.kind === 'failed' && styles.bad,
        ok() && styles.ok,
      )}
      role="status"
    >
      {text()}
    </span>
  )
}

function RelaySetting(props: NetworkProps & { short?: boolean }) {
  return (
    <GroupBox legend="Connection">
      <Check
        label="Always go through the &relay"
        checked={props.relayOnly === true}
        disabled={props.relayOnly === undefined}
        onChange={props.onRelayOnly}
        description={
          props.relayOnly === undefined
            ? 'Available once Pigeon Messenger has started.'
            : props.short === true
              ? 'Friends never see your IP address, and mail goes only to Lighthouses you chose. Slower, and needs the relay.'
              : "Friends never see your IP address. Mail goes only to your own and the official Lighthouses, so a friend who uses only theirs gets your messages when you're both online. Connecting is slower, and needs the relay to be reachable."
        }
      />
      <Show when={props.onHearAtOnce}>
        {(onChange) => (
          <Check
            label="&Hear about mail at once"
            checked={props.hearAtOnce === true}
            disabled={props.hearAtOnce === undefined || props.relayOnly === true}
            onChange={onChange()}
            description={
              props.relayOnly === true
                ? 'Off while you go through the relay: your Lighthouses would learn when you’re here.'
                : 'While Pigeon is open, your Lighthouses tell it the moment mail comes, so it arrives in seconds. They learn you’re here, to the second.'
            }
          />
        )}
      </Show>
    </GroupBox>
  )
}

function RightNow(props: { messenger: NetworkMessenger; checks: Checks }) {
  const [tick, setTick] = createSignal(0)
  onMount(() => {
    const timer = setInterval(() => setTick((n) => n + 1), 5000)
    onCleanup(() => clearInterval(timer))
  })
  const relays = () => {
    tick()
    return props.messenger.relays()
  }
  return (
    <GroupBox legend="Right now">
      <ul class={styles.facts}>
        <Show when={(relays()?.total ?? 0) > 0 && relays()}>
          {(counts) => (
            <li>
              Relays: {counts().reachable} of {counts().total} reachable
            </li>
          )}
        </Show>
        <li>
          Friends connected: {props.messenger.onlineCount()} of {props.messenger.friends().length}
        </li>
        <li>
          Lighthouses answering: {props.checks.answering()} of{' '}
          {props.messenger.lighthouses().length}
        </li>
      </ul>
    </GroupBox>
  )
}

const ABOUT_LIGHTHOUSES =
  'It can’t open your mail, or tell whose it is from its tags. It does see your IP address, when you connect, and which tags you ask for. While it watches, it can tell which addresses exchange mail, though not who they are. For an invite link, it holds a sealed card until the link runs out, a week at most, and sees when that is and how many requests come, never the link itself, the device that made it, or who asked.'

function Lighthouses(props: {
  messenger: NetworkMessenger
  checks: Checks
  official: readonly LighthouseAddress[]
}) {
  const phone = useLayout() === 'phone'
  const [typed, setTyped] = createSignal('')
  const [problem, setProblem] = createSignal('')
  const [adding, setAdding] = createSignal(false)
  const list = () => props.messenger.lighthouses()
  const others = (id: string) =>
    list().filter(
      (address) => address.id !== id && props.checks.statuses()[address.id]?.kind === 'answering',
    ).length

  const add = async () => {
    const address = parseLighthouseAddress(typed())
    if (!address.ok) {
      setProblem('That isn’t a Lighthouse’s address. It starts pigeon://lighthouse/.')
      return
    }
    if (list().some((other) => other.id === address.value.id)) {
      setProblem('That Lighthouse is on your list already.')
      return
    }
    setAdding(true)
    setProblem('')
    // Only one that answers as the key in its address is added.
    if (!(await props.checks.check(address.value))) {
      setAdding(false)
      setProblem(`${address.value.name} didn’t answer, so it wasn’t added.`)
      return
    }
    await props.messenger.setLighthouses([...list(), address.value])
    setTyped('')
    setAdding(false)
  }
  const remove = (id: string) =>
    void props.messenger.setLighthouses(list().filter((address) => address.id !== id))
  const enable = (address: LighthouseAddress) => {
    void props.messenger.setLighthouses([...list(), address])
    void props.checks.check(address)
  }
  const last = () => list().length <= 1
  const isOfficial = (id: string) => props.official.some((address) => address.id === id)
  /** Your Lighthouses in order, then any official one you've turned off, there to turn on. */
  const rows = () => [
    ...list().map((address) => ({ address, on: true })),
    ...props.official
      .filter((address) => !list().some((other) => other.id === address.id))
      .map((address) => ({ address, on: false })),
  ]

  const rowList: () => JSX.Element = () => (
    <ul class={styles.list} aria-label="Your Lighthouses">
      <For each={rows()}>
        {(row) => {
          const address = row.address
          const status = () => props.checks.statuses()[address.id]
          return (
            <li class={styles.row} data-lighthouse={address.id}>
              <img
                src={tango('network-server', phone ? 32 : 22)}
                alt=""
                width={phone ? 32 : 22}
                height={phone ? 32 : 22}
                class={classes((!row.on || status()?.kind === 'failed') && styles.dim)}
              />
              <div class={styles.about}>
                <span class={styles.name}>
                  {address.name}
                  <Show when={isOfficial(address.id)}>
                    <span class={styles.badge}>Official</span>
                  </Show>
                </span>
                <span class={styles.muted}>
                  {phone || props.checks.prints()[address.id] === undefined
                    ? host(address)
                    : `${host(address)} · ${props.checks.prints()[address.id]}`}
                </span>
                <Show
                  when={row.on}
                  fallback={
                    <span class={styles.status}>
                      {phone ? 'Turned off' : 'Turned off: friends don’t leave your mail here.'}
                    </span>
                  }
                >
                  <StatusLine status={status()} others={others(address.id)} short={phone} />
                </Show>
              </div>
              <Show
                when={!isOfficial(address.id)}
                fallback={
                  <Button
                    label={row.on ? '&Disable' : '&Enable'}
                    disabled={row.on && last()}
                    onClick={() => (row.on ? remove(address.id) : enable(address))}
                    class={phone ? styles.toggleKey : undefined}
                  />
                }
              >
                <Show
                  when={phone}
                  fallback={
                    <Button label="Re&move" disabled={last()} onClick={() => remove(address.id)} />
                  }
                >
                  <button
                    type="button"
                    class={styles.removeKey}
                    aria-label={`Remove ${address.name}`}
                    disabled={last()}
                    onClick={() => remove(address.id)}
                  >
                    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
                      <path d="M4 4 L14 14 M14 4 L4 14" />
                    </svg>
                  </button>
                </Show>
              </Show>
            </li>
          )
        }}
      </For>
    </ul>
  )

  const addForm = (submitLabel: string) => (
    <form
      class={styles.stack}
      onSubmit={(event) => {
        event.preventDefault()
        void add()
      }}
    >
      <div class={classes(styles.addRow, phone && styles.addStacked)}>
        <TextField
          label={phone ? 'Add one by its &address:' : '&Address:'}
          stacked
          value={typed()}
          onInput={setTyped}
          placeholder="pigeon://lighthouse/..."
        />
        <Button
          label={submitLabel}
          type="submit"
          disabled={typed().trim() === '' || adding()}
          class={phone ? styles.wide : undefined}
        />
      </div>
      <span class={styles.error} role="alert">
        {problem()}
      </span>
    </form>
  )

  return (
    <Show
      when={!phone}
      fallback={
        <div class={styles.stack}>
          <GroupBox legend="Your Lighthouses">
            <div class={styles.stack}>
              <p class={styles.text}>
                Friends leave mail for you here while you’re offline. It’s left at all of them.
              </p>
              {rowList()}
              <Show when={last()}>
                <p class={styles.muted}>Keep at least one, so friends can leave your mail.</p>
              </Show>
              {addForm('&Add Lighthouse')}
            </div>
          </GroupBox>
        </div>
      }
    >
      <div class={styles.stack}>
        <GroupBox legend="Your Lighthouses">
          <div class={styles.stack}>
            <p class={styles.text}>
              Friends leave mail for you here while you’re offline, sealed so only your devices can
              open it. Mail is left at all of them, so one being down loses nothing.
            </p>
            {rowList()}
            <p class={styles.muted}>
              <Show when={last()} fallback="">
                Keep at least one on, so friends have somewhere to leave your mail.{' '}
              </Show>
              What each says it runs is its own word. Its key is what Pigeon checks, on every reply.
            </p>
          </div>
        </GroupBox>
        <GroupBox legend="Add a Lighthouse">
          <div class={styles.stack}>
            {addForm('&Add')}
            <p class={styles.muted}>
              A friend who runs one can send you its address. It’s added once it answers as the key
              in it.
            </p>
          </div>
        </GroupBox>
        <GroupBox legend="What a Lighthouse sees">
          <p class={styles.text}>{ABOUT_LIGHTHOUSES}</p>
        </GroupBox>
      </div>
    </Show>
  )
}

/** On the Pocket: what a Lighthouse sees, opened and closed in place under the rest. */
function AboutToggle() {
  const [open, setOpen] = createSignal(false)
  return (
    <div class={styles.stack}>
      <button
        type="button"
        class={styles.link}
        aria-expanded={open()}
        onClick={() => setOpen(!open())}
      >
        What a Lighthouse sees
      </button>
      <Show when={open()}>
        <p class={styles.text}>{ABOUT_LIGHTHOUSES}</p>
      </Show>
    </div>
  )
}

export function Network(props: NetworkProps) {
  const phone = useLayout() === 'phone'
  const checks = createChecks(() => props.messenger)
  const waiting = () => (
    <p class={styles.text}>Lighthouses are shown once Pigeon Messenger has started.</p>
  )
  return (
    <div class={classes(styles.network, phone && styles.phone)}>
      <Show
        when={!phone}
        fallback={
          <div class={styles.stack}>
            <Show when={props.messenger} fallback={waiting()} keyed>
              {(messenger) => (
                <Lighthouses messenger={messenger} checks={checks} official={props.official} />
              )}
            </Show>
            <RelaySetting {...props} short />
            <AboutToggle />
          </div>
        }
      >
        <Tabs
          label="Network"
          tabs={[
            {
              id: 'lighthouses',
              label: 'Lighthouses',
              content: () => (
                <Show when={props.messenger} fallback={waiting()} keyed>
                  {(messenger) => (
                    <Lighthouses messenger={messenger} checks={checks} official={props.official} />
                  )}
                </Show>
              ),
            },
            {
              id: 'connection',
              label: 'Connection',
              content: () => (
                <div class={styles.stack}>
                  <RelaySetting {...props} />
                  <Show when={props.messenger} keyed>
                    {(messenger) => <RightNow messenger={messenger} checks={checks} />}
                  </Show>
                </div>
              ),
            },
          ]}
        />
      </Show>
      <div class={classes(styles.buttons, phone && styles.wideButtons)}>
        <Button
          label="OK"
          isDefault
          onClick={props.onClose}
          class={phone ? styles.wide : undefined}
        />
      </div>
    </div>
  )
}
