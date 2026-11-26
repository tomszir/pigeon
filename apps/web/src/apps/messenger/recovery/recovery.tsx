// The recovery key. Make a Recovery Key shows a new key's code once, to print or
// copy, with a file sealed by a passphrase besides; only once you say it's kept does the list
// commit to it. Recover My Pigeon, on an empty Pigeon, and Use My Recovery Key, on a device that
// is already you, take the code or the file, show the next key first, then sign the recover.
import {
  MAX_KEPT_DEVICES,
  type PeerId,
  type RecoveryCode,
  type Result,
  type Signer,
} from '@pigeon/core'
import { createSignal, Match, Show, Switch } from 'solid-js'
import type { Files } from '../../../platform/files/files.ts'
import { Button } from '../../../ui/button/button.tsx'
import { classes } from '../../../ui/classes/classes.ts'
import { GroupBox } from '../../../ui/group-box/group-box.tsx'
import { useLayout } from '../../../ui/layout/layout.ts'
import { TextField } from '../../../ui/text-field/text-field.tsx'
import type { Messenger, RecoverResult } from '../service/messenger.ts'
import {
  MIN_PASSPHRASE_LENGTH,
  type PassphraseSeal,
  STRETCH_FAILED,
} from '../your-data/your-data.tsx'
import styles from './recovery.module.css'

/** What the windows need from the platform: making, reading and using recovery keys. */
export interface RecoveryKit {
  /** A new key's public half and seed, or undefined where the browser can't make one. */
  generate(): Promise<{ readonly id: PeerId; readonly seed: Uint8Array } | undefined>
  signer(seed: Uint8Array): Promise<Signer>
  encode(code: RecoveryCode): Promise<string>
  decode(text: string): Promise<Result<RecoveryCode, 'malformed' | 'mistyped'>>
  files: Files
  seal: PassphraseSeal
}

export const RECOVERY_FILE_NAME = 'Pigeon recovery key.txt'

/** The file's words around the sealed code, for whoever opens it in a text editor. */
export const recoveryFileText = (handle: string, sealed: string): string =>
  [
    `Pigeon recovery key for ${handle}`,
    '',
    'Whoever has this file and its passphrase can take over your Pigeon, so keep both safe and',
    'apart. With every device lost, open Pigeon, choose File, Recover My Pigeon, and open this.',
    '',
    sealed,
    '',
  ].join('\n')

const RECOVER_FAILURES: Readonly<Record<Exclude<RecoverResult, 'recovered'>, string>> = {
  own: 'This is already that Pigeon. Use File, Use My Recovery Key, here instead.',
  linked: 'This Pigeon already belongs to someone. Recover onto a Pigeon with nobody on it yet.',
  'has-friends': 'This Pigeon has friends of its own, so it can’t be recovered onto.',
  waiting:
    'This Pigeon is already a recovery waiting for an old friend. Only the code you used here can be typed again: pair with a friend who knew you first.',
  refused: 'That key couldn’t sign a recovery.',
}

interface NewKey {
  readonly id: PeerId
  readonly code: string
}

/** A key's code to copy, and a file to save it in: the part every window shares. */
function KeepKey(props: {
  kit: RecoveryKit
  handle: string
  newKey: NewKey
  onKept: () => void
  onBack?: () => void
  keptLabel: string
}) {
  const phone = useLayout() === 'phone'
  const [passphrase, setPassphrase] = createSignal('')
  const [saved, setSaved] = createSignal(false)
  const [failed, setFailed] = createSignal('')
  const saveFile = async () => {
    if (passphrase().length < MIN_PASSPHRASE_LENGTH) return
    setFailed('')
    let sealed: string
    try {
      sealed = await props.kit.seal.seal(passphrase(), new TextEncoder().encode(props.newKey.code))
    } catch {
      setFailed(STRETCH_FAILED)
      return
    }
    props.kit.files.saveText(RECOVERY_FILE_NAME, recoveryFileText(props.handle, sealed))
    setSaved(true)
  }
  return (
    <div class={styles.column}>
      <p class={styles.text}>
        Print this or copy it down, and keep it somewhere safe. Pigeon shows it once and never keeps
        it.
      </p>
      <p class={styles.code} data-selectable data-recovery-code>
        {props.newKey.code}
      </p>
      <p class={styles.muted}>Or save it in a file sealed with a passphrase, too:</p>
      <TextField
        label="&Passphrase:"
        password
        stacked={phone}
        value={passphrase()}
        onInput={setPassphrase}
      />
      <div class={styles.buttons}>
        <span class={styles.muted}>{saved() ? 'Saved.' : failed()}</span>
        <Button
          label="&Save as File..."
          disabled={passphrase().length < MIN_PASSPHRASE_LENGTH}
          onClick={() => void saveFile()}
        />
      </div>
      <p class={styles.warning}>
        Whoever has this code can take over your Pigeon. Lose it, and you can never make another.
      </p>
      <div class={styles.buttons}>
        <Button label={props.keptLabel} isDefault onClick={props.onKept} />
        <Show when={props.onBack}>{(back) => <Button label="Cancel" onClick={back()} />}</Show>
      </div>
    </div>
  )
}

export interface MakeRecoveryKeyProps {
  messenger: Messenger
  kit: RecoveryKit
  onClose: () => void
}

/** On the first device with no key yet: make one, show it, and commit once it's kept. */
export function MakeRecoveryKey(props: MakeRecoveryKeyProps) {
  const phone = useLayout() === 'phone'
  const [state, setState] = createSignal<'intro' | 'unsupported' | 'shown' | 'done' | 'failed'>(
    'intro',
  )
  const [newKey, setNewKey] = createSignal<NewKey | undefined>()

  const make = async () => {
    const made = await props.kit.generate()
    if (made === undefined) {
      setState('unsupported')
      return
    }
    const code = await props.kit.encode({
      identity: props.messenger.self,
      epoch: props.messenger.nextEpoch(),
      seed: made.seed,
    })
    made.seed.fill(0)
    setNewKey({ id: made.id, code })
    setState('shown')
  }
  const commit = async () => {
    const key = newKey()
    if (key === undefined) return
    setState((await props.messenger.commitRecoveryKey(key.id)) ? 'done' : 'failed')
  }

  return (
    <div class={classes(styles.data, phone && styles.phone)}>
      <Switch>
        <Match when={state() === 'intro'}>
          <GroupBox legend="A recovery key">
            <div class={styles.column}>
              <p class={styles.text}>
                If every device with your Pigeon is lost, a recovery key brings you back as you, so
                your friends still know you. It also takes your Pigeon back from a stolen device.
              </p>
              <p class={styles.muted}>
                You make it once. Pigeon shows it, and you keep it: on paper, or in a file.
              </p>
              <div class={styles.buttons}>
                <Button label="&Make the Key" isDefault onClick={() => void make()} />
                <Button label="&Later" onClick={props.onClose} />
              </div>
            </div>
          </GroupBox>
        </Match>
        <Match when={state() === 'shown' && newKey()}>
          {(key) => (
            <GroupBox legend="Your recovery key">
              <KeepKey
                kit={props.kit}
                handle={props.messenger.profile().handle}
                newKey={key()}
                keptLabel="I've &Kept It"
                onKept={() => void commit()}
                onBack={props.onClose}
              />
            </GroupBox>
          )}
        </Match>
        <Match when={state() === 'done'}>
          <p class={styles.text}>
            Done. Your Pigeon now answers to this key. File, Use My Recovery Key, is where it works
            on a device you still have.
          </p>
          <div class={styles.buttons}>
            <Button label="OK" isDefault onClick={props.onClose} />
          </div>
        </Match>
        <Match when={state() === 'unsupported'}>
          <p class={styles.text}>
            This browser can't make a recovery key. Try again in a newer one.
          </p>
          <div class={styles.buttons}>
            <Button label="Close" isDefault onClick={props.onClose} />
          </div>
        </Match>
        <Match when={state() === 'failed'}>
          <p class={styles.text}>
            Your Pigeon already has a recovery key, or this isn't the device that manages your list.
          </p>
          <div class={styles.buttons}>
            <Button label="Close" isDefault onClick={props.onClose} />
          </div>
        </Match>
      </Switch>
    </div>
  )
}

export interface UseRecoveryKeyProps {
  messenger: Messenger
  kit: RecoveryKit
  /** Recover My Pigeon onto an empty one, or Use My Recovery Key on one that's already you. */
  mode: 'recover' | 'use'
  /** Recovered onto an empty Pigeon: it starts again as you. */
  onRecovered: () => void
  onClose: () => void
}

type Use =
  | { readonly kind: 'enter'; readonly error?: string }
  | {
      readonly kind: 'next'
      readonly code: RecoveryCode
      readonly next: NewKey
      readonly seed: Uint8Array
    }
  | { readonly kind: 'done'; readonly restart: boolean }

/**
 * Recover My Pigeon on an empty Pigeon, or Use My Recovery Key on one that's already you: the
 * code or its file, then the next key to keep, then the recover is signed.
 */
export function UseRecoveryKey(props: UseRecoveryKeyProps) {
  const phone = useLayout() === 'phone'
  const fresh = () => props.mode === 'recover'
  const [typed, setTyped] = createSignal('')
  const [file, setFile] = createSignal<string | undefined>()
  const [passphrase, setPassphrase] = createSignal('')
  const [keepOthers, setKeepOthers] = createSignal(true)
  const [view, setView] = createSignal<Use>({ kind: 'enter' })

  const read = async (): Promise<string | undefined> => {
    const sealed = file()
    if (sealed === undefined) return typed()
    const opened = await props.kit.seal.open(passphrase(), sealed)
    return opened === undefined ? undefined : new TextDecoder().decode(opened)
  }

  const check = async () => {
    let text: string | undefined
    try {
      text = await read()
    } catch {
      setView({ kind: 'enter', error: STRETCH_FAILED })
      return
    }
    if (text === undefined) {
      setView({ kind: 'enter', error: 'The passphrase doesn’t open that file.' })
      return
    }
    const decoded = await props.kit.decode(text)
    if (!decoded.ok) {
      setView({
        kind: 'enter',
        error:
          decoded.error === 'mistyped'
            ? 'A letter in that code is wrong. Check it against your copy.'
            : 'That isn’t a recovery key from Pigeon.',
      })
      return
    }
    const code = decoded.value
    if (!fresh() && code.identity !== props.messenger.self) {
      setView({ kind: 'enter', error: 'That key is another Pigeon’s, not this one’s.' })
      return
    }
    if (!fresh() && code.epoch !== props.messenger.nextEpoch()) {
      setView({ kind: 'enter', error: 'That key was replaced since. Use the newest one you kept.' })
      return
    }
    const made = await props.kit.generate()
    if (made === undefined) {
      setView({ kind: 'enter', error: 'This browser can’t make the next recovery key.' })
      return
    }
    const next = await props.kit.encode({
      identity: code.identity,
      epoch: code.epoch + 1,
      seed: made.seed,
    })
    made.seed.fill(0)
    setView({ kind: 'next', code, next: { id: made.id, code: next }, seed: code.seed })
  }

  const sign = async (step: Extract<Use, { kind: 'next' }>) => {
    const key = await props.kit.signer(step.seed)
    if (fresh()) {
      const result = await props.messenger.recoverIdentity(
        step.code.identity,
        step.code.epoch,
        key,
        step.next.id,
      )
      if (result !== 'recovered') {
        setView({ kind: 'enter', error: RECOVER_FAILURES[result] })
        return
      }
      setView({ kind: 'done', restart: true })
      setTimeout(props.onRecovered, 1500)
      return
    }
    if (keepOthers() && props.messenger.devices().length > MAX_KEPT_DEVICES) {
      setView({
        kind: 'enter',
        error: `A recovery keeps at most ${MAX_KEPT_DEVICES} devices. Remove some first, or untick keeping them.`,
      })
      return
    }
    if (!(await props.messenger.recoverHere(key, keepOthers(), step.next.id))) {
      setView({ kind: 'enter', error: 'That isn’t this Pigeon’s current recovery key.' })
      return
    }
    setView({ kind: 'done', restart: false })
  }

  return (
    <div class={classes(styles.data, phone && styles.phone)}>
      <Switch>
        <Match when={view().kind === 'enter'}>
          <GroupBox legend={fresh() ? 'Recover my Pigeon' : 'Use my recovery key'}>
            <form
              class={styles.column}
              onSubmit={(event) => {
                event.preventDefault()
                void check()
              }}
            >
              <p class={styles.text}>
                {fresh()
                  ? 'With every device lost, your recovery key brings your Pigeon back here. Your other devices stop being yours, and friends come back as you pair with them again.'
                  : 'Makes this device the one that manages your list, as after a theft. It also replaces your recovery key with a new one.'}
              </p>
              <TextField
                label="&Code:"
                stacked
                rows={3}
                value={typed()}
                onInput={setTyped}
                disabled={file() !== undefined}
              />
              <div class={styles.buttons}>
                <span class={styles.muted}>{file() === undefined ? '' : 'File chosen'}</span>
                <Button
                  label="&Open File..."
                  onClick={() =>
                    void props.kit.files.openText('.txt,text/plain').then((text) => {
                      if (text !== undefined) setFile(text)
                    })
                  }
                />
              </div>
              <Show when={file() !== undefined}>
                <TextField
                  label="&Passphrase:"
                  password
                  stacked={phone}
                  value={passphrase()}
                  onInput={setPassphrase}
                />
              </Show>
              <Show when={!fresh()}>
                <label class={styles.muted}>
                  <input
                    type="checkbox"
                    checked={keepOthers()}
                    onChange={(event) => setKeepOthers(event.currentTarget.checked)}
                  />{' '}
                  Keep my other devices (untick if one was stolen)
                </label>
              </Show>
              <span class={styles.error} role="alert">
                {(view() as { error?: string }).error ?? ''}
              </span>
              <div class={styles.buttons}>
                <Button
                  label="&Next"
                  type="submit"
                  isDefault
                  disabled={file() === undefined ? typed().trim() === '' : passphrase() === ''}
                />
                <Button label="Cancel" onClick={props.onClose} />
              </div>
            </form>
          </GroupBox>
        </Match>
        <Match when={view().kind === 'next' && (view() as Extract<Use, { kind: 'next' }>)}>
          {(step) => (
            <GroupBox legend="Your new recovery key">
              <div class={styles.column}>
                <p class={styles.text}>
                  {fresh()
                    ? 'Using your key replaces it once a friend who knew you has seen it. Keep this new one, and keep the old one too until you have paired with that friend again.'
                    : 'Using your key replaces it. Keep this new one before going on: the old one stops working.'}
                </p>
                <KeepKey
                  kit={props.kit}
                  handle={props.messenger.profile().handle || 'you'}
                  newKey={step().next}
                  keptLabel={fresh() ? "I've Kept It, &Recover" : "I've Kept It, &Go On"}
                  onKept={() => void sign(step())}
                  onBack={props.onClose}
                />
              </div>
            </GroupBox>
          )}
        </Match>
        <Match when={view().kind === 'done' && (view() as Extract<Use, { kind: 'done' }>)}>
          {(done) => (
            <>
              <p class={styles.text}>
                {done().restart
                  ? 'Recovered. Pigeon is starting again as you. Choose your name, then pair with a friend who knew you: until one has, keep your old code as well as the new one.'
                  : 'Done. This device manages your list now, and your new recovery key is the one that counts.'}
              </p>
              <Show when={!done().restart}>
                <div class={styles.buttons}>
                  <Button label="OK" isDefault onClick={props.onClose} />
                </div>
              </Show>
            </>
          )}
        </Match>
      </Switch>
    </div>
  )
}
