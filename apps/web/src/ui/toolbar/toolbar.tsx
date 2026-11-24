import type { JSX } from 'solid-js'
import { AccessLabel, accessKeyOf, plainText } from '../access-key/access-key.tsx'
import { classes } from '../classes/classes.ts'
import type { Icon } from '../icons/icons.ts'
import styles from './toolbar.module.css'

export function Toolbar(props: { label: string; children: JSX.Element; class?: string }) {
  return (
    <div role="toolbar" aria-label={props.label} class={classes(styles.toolbar, props.class)}>
      {props.children}
    </div>
  )
}

export interface ToolbarButtonProps {
  icon: Icon
  label: string
  onClick?: (() => void) | undefined
  disabled?: boolean | undefined
  /** Held down, as a toggle that is on. */
  pressed?: boolean | undefined
  /** Icon beside the label instead of above it. */
  inline?: boolean | undefined
}

/** A flat 22px-icon button that gets an orange ring on hover and sinks when pressed. */
export function ToolbarButton(props: ToolbarButtonProps) {
  return (
    <button
      type="button"
      class={classes(styles.toolbarButton, props.inline === true && styles.inline)}
      aria-label={plainText(props.label)}
      aria-pressed={props.pressed}
      disabled={props.disabled}
      data-access-key={accessKeyOf(props.label)}
      onClick={() => props.onClick?.()}
    >
      <img src={props.icon.src} alt="" width={props.icon.size} height={props.icon.size} />
      <span>
        <AccessLabel text={props.label} />
      </span>
    </button>
  )
}

export function ToolbarSeparator() {
  return <span class={styles.toolbarSeparator} aria-hidden="true" />
}
