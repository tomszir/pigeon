// The whole screen while Pigeon runs in another tab (decision 0028): nothing here works until you
// move Pigeon over, so the desktop or the Pocket is covered, in the blue of a locked computer,
// with the one thing this tab can do.
import { onMount } from 'solid-js'
import { Button } from '../../ui/button/button.tsx'
import { classes } from '../../ui/classes/classes.ts'
import { brand } from '../../ui/icons/icons.ts'
import styles from './elsewhere.module.css'

export function Elsewhere(props: {
  /** "Pigeon is open in another tab", or that it moved to one. */
  title: string
  onTakeOver: () => void
  phone?: boolean | undefined
}) {
  let root: HTMLElement | undefined
  // Whatever had focus behind it can't be used now.
  onMount(() => root?.querySelector('button')?.focus())
  return (
    <section
      ref={root}
      class={classes(styles.elsewhere, props.phone === true && styles.phone)}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="pigeon-elsewhere-title"
    >
      <div class={styles.band} />
      <div class={styles.middle}>
        <img src={brand('pigeon-48')} alt="" width="48" height="48" />
        <div class={styles.words}>
          <h1 id="pigeon-elsewhere-title" class={styles.title}>
            {props.title}
          </h1>
          <p class={styles.text}>
            Only one tab runs Pigeon at a time, so this one can’t be used. Go back to the other tab,
            or use Pigeon here instead.
          </p>
          <Button label="&Use Pigeon Here" isDefault onClick={() => props.onTakeOver()} />
        </div>
      </div>
      <div class={styles.band} />
    </section>
  )
}
