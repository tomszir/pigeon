// A drop-down list drawn inside the desktop. A native <select> opens its list outside the page,
// where the stage's scale and the CRT effect can't reach it, so this draws its own: the
// "select-only combobox" pattern, with the keys the era's list boxes had. Arrows change the
// choice even when closed, Alt+Down or Enter opens, letters jump, Escape closes.
import { createSignal, createUniqueId, For, onCleanup, Show } from 'solid-js'
import { AccessLabel, accessKeyOf, plainText } from '../access-key/access-key.tsx'
import { classes } from '../classes/classes.ts'
import field from '../field/field.module.css'
import styles from './select.module.css'

export interface SelectOption {
  readonly value: string
  readonly label: string
}

export interface SelectProps {
  label: string
  options: readonly SelectOption[]
  value: string
  onChange?: ((value: string) => void) | undefined
  labelHidden?: boolean | undefined
  /** The label above the list instead of beside it, as on the phone. */
  stacked?: boolean | undefined
  disabled?: boolean | undefined
  class?: string | undefined
}

export function Select(props: SelectProps) {
  const id = createUniqueId()
  const [open, setOpen] = createSignal(false)
  // The highlighted option while the list is open.
  const [active, setActive] = createSignal(0)
  let root: HTMLDivElement | undefined
  let button: HTMLButtonElement | undefined

  const selectedIndex = () =>
    Math.max(
      0,
      props.options.findIndex((option) => option.value === props.value),
    )
  const selected = () => props.options[selectedIndex()]

  const choose = (index: number) => {
    const option = props.options[index]
    if (option !== undefined && option.value !== props.value) props.onChange?.(option.value)
  }

  const outside = (event: PointerEvent) => {
    if (root !== undefined && !root.contains(event.target as Node)) setOpen(false)
  }
  const show = () => {
    if (props.disabled === true) return
    setActive(selectedIndex())
    setOpen(true)
    document.addEventListener('pointerdown', outside, true)
  }
  const hide = (refocus = true) => {
    setOpen(false)
    document.removeEventListener('pointerdown', outside, true)
    if (refocus) button?.focus()
  }
  onCleanup(() => document.removeEventListener('pointerdown', outside, true))

  const pick = (index: number) => {
    choose(index)
    hide()
  }

  /** The next option whose label starts with the typed letter, after the current one. */
  const jump = (letter: string, from: number) => {
    const count = props.options.length
    for (let step = 1; step <= count; step++) {
      const index = (from + step) % count
      if (props.options[index]?.label.toLowerCase().startsWith(letter)) return index
    }
    return undefined
  }

  const onKeyDown = (event: KeyboardEvent) => {
    const last = props.options.length - 1
    const current = open() ? active() : selectedIndex()
    const move = (to: number) => {
      const index = Math.min(last, Math.max(0, to))
      if (open()) setActive(index)
      else choose(index)
    }
    const keys: Record<string, () => void> = {
      ArrowDown: () => (event.altKey && !open() ? show() : move(current + 1)),
      ArrowUp: () => (event.altKey && open() ? pick(active()) : move(current - 1)),
      Home: () => move(0),
      End: () => move(last),
      Enter: () => (open() ? pick(active()) : show()),
      ' ': () => (open() ? pick(active()) : show()),
      Escape: () => open() && hide(),
      Tab: () => open() && hide(false),
    }
    const action = keys[event.key]
    if (action !== undefined) {
      // Tab moves on as usual; Escape only stops here when there was a list to close.
      if (event.key !== 'Tab' && (event.key !== 'Escape' || open())) {
        event.preventDefault()
        event.stopPropagation()
      }
      action()
      return
    }
    if (event.key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey) {
      const index = jump(event.key.toLowerCase(), current)
      if (index !== undefined) {
        event.preventDefault()
        move(index)
      }
    }
  }

  return (
    <div
      ref={root}
      class={classes(
        field.field,
        props.stacked === true && field.stacked,
        styles.wrap,
        props.class,
      )}
    >
      <label
        for={id}
        class={props.labelHidden === true ? field.visuallyHidden : undefined}
        data-access-key={accessKeyOf(props.label)}
      >
        <AccessLabel text={props.label} />
      </label>
      <div class={styles.anchor}>
        <button
          ref={button}
          id={id}
          type="button"
          role="combobox"
          aria-label={plainText(props.label)}
          aria-haspopup="listbox"
          aria-expanded={open()}
          aria-controls={`${id}-list`}
          aria-activedescendant={open() ? `${id}-option-${active()}` : undefined}
          disabled={props.disabled}
          class={classes(field.input, styles.select, open() && styles.open)}
          onClick={() => (open() ? hide() : show())}
          onKeyDown={onKeyDown}
        >
          <span class={styles.value}>{selected()?.label}</span>
          <span class={styles.arrow} aria-hidden="true" />
        </button>
        <Show when={open()}>
          <div
            id={`${id}-list`}
            role="listbox"
            aria-label={plainText(props.label)}
            class={styles.list}
          >
            <For each={props.options}>
              {(option, index) => (
                <div
                  id={`${id}-option-${index()}`}
                  role="option"
                  tabIndex={-1}
                  aria-selected={option.value === props.value}
                  class={classes(styles.option, index() === active() && styles.active)}
                  onPointerEnter={() => setActive(index())}
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() => pick(index())}
                  onKeyDown={onKeyDown}
                >
                  {option.label}
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>
    </div>
  )
}
