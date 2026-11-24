import type { Desktop, WindowId } from '@pigeon/core'
import { For, Show } from 'solid-js'
import { brand } from '../../ui/icons/icons.ts'
import type { Launcher, WindowHandle, WindowSpec } from '../shell/types.ts'
import styles from './phone-shell.module.css'

/**
 * Below 1024×640 there's no desktop: the frontmost window fills the screen under its title, and
 * a bar along the bottom switches between programs, with 44px targets.
 */
export function PhoneShell(props: {
  specs: ReadonlyMap<WindowId, WindowSpec>
  desktop: Desktop
  launchers: readonly Launcher[]
  onSwitch: (id: WindowId) => void
  handle: (id: WindowId) => WindowHandle
}) {
  const current = () => {
    const windows = props.desktop.windows
    for (let i = windows.length - 1; i >= 0; i--) {
      const window = windows[i]
      if (window !== undefined && props.specs.has(window.id)) return window.id
    }
    return undefined
  }
  return (
    <div class={styles.phone}>
      <Show
        when={current()}
        fallback={
          <div class={styles.home}>
            <img src={brand('pigeon-128')} alt="" width="128" height="128" />
            <p>Pick a program below.</p>
          </div>
        }
      >
        {(id) => (
          <Show when={props.specs.get(id())}>
            {(spec) => (
              <section class={styles.app} aria-label={spec().title}>
                <header class={styles.title}>
                  <img src={spec().icon.src} alt="" width="16" height="16" />
                  {spec().title}
                </header>
                <div class={styles.body}>{spec().content(props.handle(id()))}</div>
              </section>
            )}
          </Show>
        )}
      </Show>
      <nav class={styles.switcher} aria-label="Programs">
        <For each={props.launchers.filter((launcher) => launcher.disabled !== true)}>
          {(launcher) => (
            <button type="button" class={styles.switch} onClick={() => launcher.onOpen()}>
              <img src={launcher.icon32.src} alt="" width="32" height="32" />
              <span>{launcher.label}</span>
            </button>
          )}
        </For>
      </nav>
    </div>
  )
}
