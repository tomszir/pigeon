import { For, type JSX } from 'solid-js'
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
 * the page fills the screen: icon and text centred, the buttons full width along the bottom.
 */
export function MessageBox(props: {
  kind: MessageKind
  children: JSX.Element
  buttons: readonly MessageBoxButton[]
}) {
  const phone = useLayout() === 'phone'
  return (
    <div class={classes(styles.messageBox, phone && styles.phone)}>
      <div class={styles.content}>
        <img src={tango(icons[props.kind], 32)} alt="" width="32" height="32" />
        <div class={styles.text}>{props.children}</div>
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
