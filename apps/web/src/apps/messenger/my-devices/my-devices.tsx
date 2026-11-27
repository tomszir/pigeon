// My Devices: which device is this one, and, on the first device, removing a lost one or making
// a copied profile a new device.
import { createSignal, For, Show } from 'solid-js'
import { Button } from '../../../ui/button/button.tsx'
import { classes } from '../../../ui/classes/classes.ts'
import { GroupBox } from '../../../ui/group-box/group-box.tsx'
import { useLayout } from '../../../ui/layout/layout.ts'
import type { Messenger } from '../service/messenger.ts'
import styles from './my-devices.module.css'

export interface MyDevicesProps {
  messenger: Messenger
  onLinkDevice: () => void
  /** Forget everything here and link this browser again as a new device. */
  onStartOver: () => void
  onClose: () => void
}

/** Your devices: which is this one, and, on the first device, removing a lost one. */
export function MyDevices(props: MyDevicesProps) {
  const phone = useLayout() === 'phone'
  const [confirming, setConfirming] = createSignal<string | undefined>()
  const [startingOver, setStartingOver] = createSignal(false)
  // Only the first device changes the list.
  const first = () => props.messenger.isFirstDevice()
  return (
    <div class={classes(styles.devices, phone && styles.phone)}>
      <Show when={props.messenger.deviceStatus() === 'removed'}>
        <p class={styles.warning} role="alert">
          This device was removed from your Pigeon by your first device. It keeps the chats it had,
          but talks to nobody now.
        </p>
      </Show>
      <Show when={props.messenger.checkDevices() && props.messenger.deviceStatus() === 'active'}>
        <GroupBox legend="Check your devices">
          <div class={styles.column}>
            <p class={styles.warning} role="alert">
              Your devices have a new secret to meet with. Pigeon used to link devices in a way
              someone watching closely could get between, so check that every device below is yours.
              Remove any you don't know, from the device that manages your list.
            </p>
            <div class={styles.buttons}>
              <Button
                label="&They're All Mine"
                onClick={() => void props.messenger.devicesChecked()}
              />
            </div>
          </div>
        </GroupBox>
      </Show>
      <Show when={props.messenger.elsewhere().length > 0}>
        <GroupBox legend="On your other devices only">
          <div class={styles.column}>
            <p>
              These friends were on another of your devices before your devices kept your friends in
              step, and never on this one. They may have been added there, or removed here: keep
              them there, or remove them from all your devices.
            </p>
            <For each={props.messenger.elsewhere()}>
              {(friend) => (
                <div class={styles.buttons}>
                  <span>{friend.name || 'A friend'}</span>
                  <Button
                    label="Keep"
                    onClick={() => void props.messenger.settleElsewhere(friend.inc, true)}
                  />
                  <Button
                    label="Remove Everywhere"
                    onClick={() => void props.messenger.settleElsewhere(friend.inc, false)}
                  />
                </div>
              )}
            </For>
          </div>
        </GroupBox>
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
