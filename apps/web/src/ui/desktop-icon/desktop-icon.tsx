import { classes } from '../classes/classes.ts'
import type { Icon } from '../icons/icons.ts'
import styles from './desktop-icon.module.css'

export interface DesktopIconProps {
  icon: Icon
  label: string
  selected: boolean
  onSelect: () => void
  onOpen: () => void
}

/** A 76px desktop cell: one click selects, a double click or Enter opens. */
export function DesktopIcon(props: DesktopIconProps) {
  return (
    <button
      type="button"
      class={classes(styles.desktopIcon, props.selected && styles.selected)}
      aria-pressed={props.selected}
      onClick={() => props.onSelect()}
      onDblClick={() => props.onOpen()}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          props.onOpen()
        }
      }}
      onFocus={() => props.onSelect()}
    >
      <img src={props.icon.src} alt="" width={props.icon.size} height={props.icon.size} />
      <span class={styles.label}>{props.label}</span>
    </button>
  )
}
