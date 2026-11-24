// Drop-down menus. A menu is data (a list of entries), so menu bars and context menus share one
// keyboard model: arrows move, Home and End jump, Enter picks, Escape closes, a letter picks the
// item with that access key.
import { For, type JSX, onCleanup, onMount, Show } from 'solid-js'
import { AccessLabel, accessKeyOf, plainText } from '../access-key/access-key.tsx'
import { classes } from '../classes/classes.ts'
import type { Icon } from '../icons/icons.ts'
import styles from './menu.module.css'

export type MenuEntry =
  | {
      readonly kind?: 'item'
      /** "&New conversation": the access key is underlined. */
      readonly label: string
      readonly shortcut?: string
      readonly onSelect?: () => void
      readonly disabled?: boolean
      /** A check mark in the gutter; makes the item a menuitemcheckbox. */
      readonly checked?: boolean
      readonly icon?: Icon
    }
  | { readonly kind: 'separator' }

type MenuItem = Exclude<MenuEntry, { kind: 'separator' }>

const isItem = (entry: MenuEntry): entry is MenuItem => entry.kind !== 'separator'

export interface MenuProps {
  label: string
  entries: readonly MenuEntry[]
  /** Escape, a pick, or a click elsewhere. `refocus` is false when the click went elsewhere. */
  onClose: (refocus: boolean) => void
  /** Left or Right, to the neighbouring menu on a menu bar. */
  onNavigate?: ((step: -1 | 1) => void) | undefined
  /** The button that opened the menu; pressing it toggles rather than counting as elsewhere. */
  anchor?: HTMLElement | undefined
  /** Highlight the first item on opening, as when opened from the keyboard. A menu opened with
   *  the mouse starts with nothing highlighted. */
  focusFirst?: boolean | undefined
  style?: JSX.CSSProperties | undefined
  class?: string | undefined
}

export function Menu(props: MenuProps) {
  const items: (HTMLElement | undefined)[] = []
  let root: HTMLDivElement | undefined

  const enabled = () =>
    props.entries
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => isItem(entry) && entry.disabled !== true)
      .map(({ index }) => index)

  const focusAt = (index: number | undefined) => {
    if (index !== undefined) items[index]?.focus()
  }

  const currentIndex = () => items.indexOf(document.activeElement as HTMLElement)

  const pick = (entry: MenuItem) => {
    if (entry.disabled === true) return
    props.onClose(true)
    entry.onSelect?.()
  }

  const outside = (event: PointerEvent) => {
    const target = event.target as Node
    if (root?.contains(target) === true || props.anchor?.contains(target) === true) return
    props.onClose(false)
  }
  onMount(() => {
    if (props.focusFirst === false) root?.focus()
    else focusAt(enabled()[0])
    document.addEventListener('pointerdown', outside, true)
  })
  onCleanup(() => document.removeEventListener('pointerdown', outside, true))

  const onKeyDown = (event: KeyboardEvent) => {
    const open = enabled()
    const at = open.indexOf(currentIndex())
    const moves: Record<string, () => void> = {
      ArrowDown: () => focusAt(open[(at + 1) % open.length]),
      ArrowUp: () =>
        focusAt(open[at === -1 ? open.length - 1 : (at - 1 + open.length) % open.length]),
      Home: () => focusAt(open[0]),
      End: () => focusAt(open[open.length - 1]),
      Escape: () => props.onClose(true),
      Tab: () => props.onClose(true),
      ArrowLeft: () => props.onNavigate?.(-1),
      ArrowRight: () => props.onNavigate?.(1),
    }
    const move = moves[event.key]
    if (move !== undefined) {
      event.preventDefault()
      event.stopPropagation()
      move()
      return
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
      const key = event.key.toLowerCase()
      const match = props.entries.find(
        (entry): entry is MenuItem =>
          isItem(entry) && entry.disabled !== true && accessKeyOf(entry.label) === key,
      )
      if (match !== undefined) {
        event.preventDefault()
        event.stopPropagation()
        pick(match)
      }
    }
  }

  return (
    <div
      ref={root}
      role="menu"
      aria-label={props.label}
      class={classes(styles.menu, props.class)}
      tabIndex={-1}
      style={props.style}
      onKeyDown={onKeyDown}
    >
      <For each={props.entries}>
        {(entry, index) => (
          <Show when={isItem(entry) ? entry : undefined} fallback={<hr class={styles.separator} />}>
            {(item) => (
              <button
                ref={(element) => {
                  items[index()] = element
                }}
                type="button"
                {...(item().checked === undefined
                  ? { role: 'menuitem' }
                  : { role: 'menuitemcheckbox', 'aria-checked': item().checked })}
                aria-disabled={item().disabled === true ? 'true' : undefined}
                aria-label={plainText(item().label)}
                tabIndex={-1}
                class={classes(styles.item, item().disabled === true && styles.disabled)}
                onClick={() => pick(item())}
                onPointerEnter={(event) => event.currentTarget.focus()}
                onPointerLeave={() => root?.focus()}
              >
                <span class={styles.gutter} aria-hidden="true">
                  <Show when={item().icon} fallback={item().checked === true ? '✓' : ''}>
                    {(icon) => <img src={icon().src} alt="" width={16} height={16} />}
                  </Show>
                </span>
                <span class={styles.label}>
                  <AccessLabel text={item().label} />
                </span>
                <Show when={item().shortcut}>
                  <span class={styles.shortcut}>{item().shortcut}</span>
                </Show>
              </button>
            )}
          </Show>
        )}
      </For>
    </div>
  )
}
