import { createSignal, createUniqueId, For, type JSX } from 'solid-js'
import styles from './tabs.module.css'

export interface Tab {
  readonly id: string
  readonly label: string
  readonly content: () => JSX.Element
}

export interface TabsProps {
  label: string
  tabs: readonly Tab[]
  /** The tab shown first; the first tab unless set. */
  initial?: string | undefined
  onSelect?: ((id: string) => void) | undefined
}

/** Property-sheet tabs: the selected one has an orange top line and joins its panel. */
export function Tabs(props: TabsProps) {
  const base = createUniqueId()
  const [selected, setSelected] = createSignal(props.initial ?? props.tabs[0]?.id ?? '')
  const buttons: HTMLButtonElement[] = []

  const select = (index: number) => {
    const tab = props.tabs[(index + props.tabs.length) % props.tabs.length]
    if (tab === undefined) return
    setSelected(tab.id)
    props.onSelect?.(tab.id)
    buttons[props.tabs.indexOf(tab)]?.focus()
  }

  const onKeyDown = (event: KeyboardEvent, index: number) => {
    const moves: Record<string, number> = {
      ArrowRight: index + 1,
      ArrowLeft: index - 1,
      Home: 0,
      End: props.tabs.length - 1,
    }
    const to = moves[event.key]
    if (to === undefined) return
    event.preventDefault()
    select(to)
  }

  const current = () => props.tabs.find((tab) => tab.id === selected()) ?? props.tabs[0]

  return (
    <div class={styles.tabs}>
      <div role="tablist" aria-label={props.label} class={styles.list}>
        <For each={props.tabs}>
          {(tab, index) => (
            <button
              ref={(element) => {
                buttons[index()] = element
              }}
              type="button"
              role="tab"
              id={`${base}-${tab.id}`}
              class={styles.tab}
              aria-selected={tab.id === selected()}
              aria-controls={`${base}-panel`}
              tabIndex={tab.id === selected() ? 0 : -1}
              onClick={() => select(index())}
              onKeyDown={(event) => onKeyDown(event, index())}
            >
              {tab.label}
            </button>
          )}
        </For>
      </div>
      <div
        role="tabpanel"
        id={`${base}-panel`}
        aria-labelledby={`${base}-${current()?.id ?? ''}`}
        class={styles.panel}
      >
        {current()?.content()}
      </div>
    </div>
  )
}
