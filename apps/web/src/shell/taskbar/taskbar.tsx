import type { WindowId } from '@pigeon/core'
import { createSignal, For, onCleanup, Show } from 'solid-js'
import { classes } from '../../ui/classes/classes.ts'
import { brand, type Icon, tango } from '../../ui/icons/icons.ts'
import type { Launcher } from '../shell/types.ts'
import { taskButtonLayout } from './task-buttons.ts'
import styles from './taskbar.module.css'

export interface TaskbarTask {
  readonly id: WindowId
  readonly title: string
  readonly icon: Icon
  readonly active: boolean
}

/** What the menu button, quick launch and tray take from the taskbar's width. */
const FIXED_PARTS_WIDTH = 110 + 60 + 120

export interface TaskbarProps {
  menuOpen: boolean
  /** `keyboard` when the button was pressed from the keyboard rather than clicked. */
  onToggleMenu: (keyboard: boolean) => void
  quickLaunch: readonly Launcher[]
  tasks: readonly TaskbarTask[]
  onTask: (id: WindowId) => void
  now: () => Date
  peers: number
  /** The screen's width, which the task buttons share. */
  screenWidth: number
}

export function Taskbar(props: TaskbarProps) {
  const layout = () => taskButtonLayout(props.tasks.length, props.screenWidth - FIXED_PARTS_WIDTH)
  return (
    <footer class={styles.taskbar}>
      <button
        type="button"
        class={styles.menuButton}
        data-pigeon-menu-button
        aria-haspopup="menu"
        aria-expanded={props.menuOpen}
        aria-label="Pigeon menu"
        onClick={(event) => props.onToggleMenu(event.detail === 0)}
      >
        <img src={brand('pigeon-24')} alt="" width="24" height="24" />
        pigeon
      </button>
      <div class={styles.quickLaunch} role="toolbar" aria-label="Quick launch">
        <For each={props.quickLaunch}>
          {(launcher) => (
            <button
              type="button"
              class={styles.button}
              aria-label={`Open ${launcher.label}`}
              title={launcher.label}
              onClick={() => launcher.onOpen()}
            >
              <img src={launcher.icon16.src} alt="" width="16" height="16" />
            </button>
          )}
        </For>
      </div>
      <div class={styles.tasks} role="toolbar" aria-label="Open windows">
        <For each={props.tasks}>
          {(task) => (
            <button
              type="button"
              class={classes(styles.task, task.active && styles.active)}
              aria-pressed={task.active}
              aria-label={task.title}
              title={task.title}
              style={{ width: `${layout().width}px` }}
              onClick={() => props.onTask(task.id)}
            >
              <img src={task.icon.src} alt="" width="16" height="16" />
              <Show when={layout().showLabel}>
                <span class={styles.title}>{task.title}</span>
              </Show>
            </button>
          )}
        </For>
      </div>
      <Tray now={props.now} peers={props.peers} />
    </footer>
  )
}

/** The notification area: Pigeon's own status, the peer count, and the clock. */
function Tray(props: { now: () => Date; peers: number }) {
  const [time, setTime] = createSignal(props.now())
  const timer = setInterval(() => setTime(props.now()), 15_000)
  onCleanup(() => clearInterval(timer))
  const clock = () => time().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  const status = () => (props.peers === 0 ? 'Pigeon: offline' : 'Pigeon: online')

  return (
    <div class={styles.tray} role="status">
      <img
        src={brand(props.peers === 0 ? 'presence-16-offline' : 'presence-16-online')}
        alt={status()}
        title={status()}
        width="16"
        height="16"
      />
      <img
        src={tango('network-transmit-receive', 16)}
        alt={`${props.peers} peers connected`}
        title={`${props.peers} peers connected`}
        width="16"
        height="16"
      />
      <time class={styles.clock}>{clock()}</time>
    </div>
  )
}
