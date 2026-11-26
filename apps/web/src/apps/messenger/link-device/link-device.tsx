// Link a Device, on the device you have: the code to scan or type, then the check and the
// confirmation. Only the first device links. Linking is in person: the new device scans or types
// the code, both show the new device's fingerprint, and you confirm here.
import { formatCode, formatFingerprint, MAX_WRONG_TRIES } from '@pigeon/core'
import { createSignal, Match, onCleanup, Show, Switch } from 'solid-js'
import { Button } from '../../../ui/button/button.tsx'
import { classes } from '../../../ui/classes/classes.ts'
import { GroupBox } from '../../../ui/group-box/group-box.tsx'
import { useLayout } from '../../../ui/layout/layout.ts'
import { TextField } from '../../../ui/text-field/text-field.tsx'
import { QrCode } from '../qr-code/qr-code.tsx'
import type { Messenger } from '../service/messenger.ts'
import styles from './link-device.module.css'

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
                  A device asked to be linked. Check that the device in your hand shows the same
                  fingerprint:
                </p>
                <p class={styles.check} data-link-check>
                  {formatFingerprint(request().fingerprint)}
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
                  <Button
                    label="&Not This Device"
                    onClick={() => void props.messenger.refuseLink()}
                  />
                  <Button label="Cancel" onClick={props.onClose} />
                </div>
              </div>
            </GroupBox>
          )}
        </Match>
        <Match when={props.messenger.linking()?.stopped}>
          <p class={styles.text}>
            Someone typed a wrong code too many times, so Pigeon stopped it. If that wasn't you,
            someone may be trying to guess it. Make a new code to link your device.
          </p>
          <div class={styles.buttons}>
            <Button label="&New code" onClick={() => void props.messenger.startLink()} />
            <Button label="Close" isDefault onClick={props.onClose} />
          </div>
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
                    {formatCode(linking().code)}
                  </p>
                  <p class={styles.muted}>
                    Works once, for 10 minutes. Only link devices you hold.
                  </p>
                  <p class={styles.muted}>
                    This Pigeon's fingerprint:{' '}
                    <code data-selectable data-self-fingerprint>
                      {formatFingerprint(props.messenger.selfFingerprint)}
                    </code>
                  </p>
                  <Show when={linking().wrongTries > 0}>
                    <p class={styles.warning} role="alert">
                      {wrongTriesText(linking().wrongTries)}
                    </p>
                  </Show>
                </div>
              </div>
            </GroupBox>
          )}
        </Match>
      </Switch>
    </div>
  )
}

/** What the device showing a code says about confirmations that didn't hold. */
export const wrongTriesText = (count: number): string =>
  `Someone typed a wrong code ${count === 1 ? 'once' : `${count} times`}. If that wasn't you, someone may be trying to guess it: after ${MAX_WRONG_TRIES} Pigeon stops it.`
