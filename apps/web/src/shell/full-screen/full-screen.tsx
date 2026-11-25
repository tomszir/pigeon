// The whole screen, for a state where nothing behind it works: Pigeon open in
// another tab, or Pigeon unable to start. The desktop or the Pocket is covered in the blue of a
// locked computer, with what happened and the few things this tab can do about it.
import { For, onMount, Show } from 'solid-js'
import { Button } from '../../ui/button/button.tsx'
import { classes } from '../../ui/classes/classes.ts'
import { brand, tango } from '../../ui/icons/icons.ts'
import type { ScreenSpec } from '../shell/types.ts'
import styles from './full-screen.module.css'

export function FullScreen(props: { spec: ScreenSpec; phone?: boolean | undefined }) {
  let root: HTMLElement | undefined
  // Whatever had focus behind it can't be used now.
  onMount(() => root?.querySelector('button')?.focus())
  return (
    <section
      ref={root}
      class={classes(styles.screen, props.phone === true && styles.phone)}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="pigeon-screen-title"
      aria-describedby="pigeon-screen-text"
    >
      <div class={styles.band} />
      <div class={styles.middle}>
        <img
          src={props.spec.kind === 'error' ? tango('dialog-error', 32) : brand('pigeon-48')}
          alt=""
          width={props.spec.kind === 'error' ? 32 : 48}
          height={props.spec.kind === 'error' ? 32 : 48}
        />
        <div class={styles.words}>
          <h1 id="pigeon-screen-title" class={styles.title}>
            {props.spec.title}
          </h1>
          <p id="pigeon-screen-text" class={styles.text}>
            {props.spec.text}
          </p>
          <Show when={props.spec.details}>
            {(details) => (
              <p class={styles.details} data-selectable>
                {details()}
              </p>
            )}
          </Show>
          <div class={styles.buttons}>
            <For each={props.spec.buttons}>
              {(button) => (
                <Button
                  label={button.label}
                  isDefault={button.isDefault}
                  onClick={button.onClick}
                />
              )}
            </For>
          </div>
        </div>
      </div>
      <div class={styles.band} />
    </section>
  )
}
