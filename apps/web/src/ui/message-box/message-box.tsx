import { children, For, type JSX, Show } from 'solid-js'
import { Button } from '../button/button.tsx'
import { classes } from '../classes/classes.ts'
import { type TangoIcon, tango } from '../icons/icons.ts'
import { useLayout } from '../layout/layout.ts'
import styles from './message-box.module.css'

export type MessageKind = 'information' | 'warning' | 'error'

const icons: Record<MessageKind, TangoIcon> = {
  information: 'dialog-information',
  warning: 'dialog-warning',
  error: 'dialog-error',
}

export interface MessageBoxButton {
  readonly label: string
  readonly onClick: () => void
  readonly isDefault?: boolean
}

/**
 * The inside of a message box: a 32px icon, the text, and a centred row of buttons. On a phone
 * the page fills the screen: icon and text centred, the buttons full width along the bottom. A
 * `picture` (someone's pixel pigeon) sits centred above it all, never beside the icon, and the
 * icon and text centre under it; on a phone the picture is at the top of the page.
 */
export function MessageBox(props: {
  kind: MessageKind
  children: JSX.Element
  buttons: readonly MessageBoxButton[]
  picture?: JSX.Element
}) {
  const phone = useLayout() === 'phone'
  // Resolved once: reading a JSX prop twice (to test it and to show it) would build it twice.
  const picture = children(() => props.picture)
  return (
    <div
      class={classes(
        styles.messageBox,
        phone && styles.phone,
        picture() !== undefined && styles.withPicture,
      )}
    >
      <div class={styles.body}>
        <Show when={picture()}>
          <div class={styles.picture}>{picture()}</div>
        </Show>
        <div class={styles.content}>
          <img src={tango(icons[props.kind], 32)} alt="" width="32" height="32" />
          <div class={styles.text}>{props.children}</div>
        </div>
      </div>
      <div class={styles.buttons}>
        <For each={props.buttons}>
          {(button) => (
            <Button
              label={button.label}
              onClick={button.onClick}
              isDefault={button.isDefault}
              class={phone ? styles.wide : undefined}
            />
          )}
        </For>
      </div>
    </div>
  )
}
