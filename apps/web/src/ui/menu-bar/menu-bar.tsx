import { createEffect, createSignal, For, Show } from 'solid-js'
import { AccessLabel, accessKeyOf, plainText } from '../access-key/access-key.tsx'
import { backStep, useBack } from '../back/back.ts'
import { classes } from '../classes/classes.ts'
import { Menu, type MenuEntry } from '../menu/menu.tsx'
import styles from './menu-bar.module.css'

export interface MenuBarMenu {
  /** "&File" */
  readonly label: string
  readonly entries: readonly MenuEntry[]
}

/**
 * A window's menu bar. Alt alone focuses it (see window.tsx), Alt and a letter opens a menu,
 * Left and Right walk the bar, and while one menu is open, hovering another opens that one.
 */
export function MenuBar(props: { label: string; menus: readonly MenuBarMenu[] }) {
  const [open, setOpen] = createSignal<number | null>(null)
  // Menus opened from the keyboard highlight their first item; mouse-opened ones don't.
  const [byKeyboard, setByKeyboard] = createSignal(false)
  const openFrom = (index: number, keyboard: boolean) => {
    setByKeyboard(keyboard)
    setOpen(index)
  }
  const buttons: HTMLButtonElement[] = []

  const at = (index: number) => (index + props.menus.length) % props.menus.length

  const close = (refocus: boolean) => {
    const was = open()
    setOpen(null)
    if (refocus && was !== null) buttons[was]?.focus()
  }

  // Back closes an open menu (decision 0034); moving between menus is still one step.
  const back = backStep(useBack(), () => close(true))
  createEffect(() => (open() === null ? back.close() : back.open()))

  const onBarKeyDown = (event: KeyboardEvent, index: number) => {
    const actions: Record<string, () => void> = {
      ArrowRight: () => buttons[at(index + 1)]?.focus(),
      ArrowLeft: () => buttons[at(index - 1)]?.focus(),
      ArrowDown: () => openFrom(index, true),
      Enter: () => openFrom(index, true),
      ' ': () => openFrom(index, true),
      Escape: () => buttons[index]?.blur(),
    }
    const action = actions[event.key]
    if (action === undefined) return
    event.preventDefault()
    event.stopPropagation()
    action()
  }

  return (
    <div role="menubar" aria-label={props.label} class={styles.menuBar}>
      <For each={props.menus}>
        {(menu, index) => (
          <div class={styles.slot}>
            <button
              ref={(element) => {
                buttons[index()] = element
              }}
              type="button"
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={open() === index()}
              aria-label={plainText(menu.label)}
              tabIndex={-1}
              class={classes(styles.item, open() === index() && styles.open)}
              data-access-key={accessKeyOf(menu.label)}
              onClick={(event) => {
                // A click from Alt+letter has no pointer behind it (detail 0).
                if (open() === index()) setOpen(null)
                else openFrom(index(), event.detail === 0)
              }}
              onPointerEnter={() => {
                if (open() !== null) openFrom(index(), false)
              }}
              onKeyDown={(event) => onBarKeyDown(event, index())}
            >
              <AccessLabel text={menu.label} />
            </button>
            <Show when={open() === index()}>
              <Menu
                label={plainText(menu.label)}
                entries={menu.entries}
                class={styles.dropDown}
                onClose={close}
                onNavigate={(step) => openFrom(at(index() + step), true)}
                focusFirst={byKeyboard()}
                anchor={buttons[index()]}
              />
            </Show>
          </div>
        )}
      </For>
    </div>
  )
}
