import { createSignal, createUniqueId, For, type JSX, Show } from 'solid-js'
import styles from './task-pane.module.css'

export interface TaskPaneGroup {
  readonly title: string
  readonly content: () => JSX.Element
  readonly collapsible?: boolean
}

/** The blue sidebar of collapsible groups, used in Explorer and Shared Files. */
export function TaskPane(props: { label: string; groups: readonly TaskPaneGroup[] }) {
  return (
    <aside class={styles.taskPane} aria-label={props.label}>
      <For each={props.groups}>{(group) => <TaskPaneSection group={group} />}</For>
    </aside>
  )
}

function TaskPaneSection(props: { group: TaskPaneGroup }) {
  const id = createUniqueId()
  const [open, setOpen] = createSignal(true)
  return (
    <section class={styles.group}>
      <h2 class={styles.header}>
        <Show when={props.group.collapsible === true} fallback={props.group.title}>
          <button
            type="button"
            class={styles.toggle}
            aria-expanded={open()}
            aria-controls={id}
            onClick={() => setOpen(!open())}
          >
            {props.group.title}
            <span class={styles.chevron} aria-hidden="true">
              {open() ? '⌃' : '⌄'}
            </span>
          </button>
        </Show>
      </h2>
      <Show when={open()}>
        <div id={id} class={styles.body}>
          {props.group.content()}
        </div>
      </Show>
    </section>
  )
}
