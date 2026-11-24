// A window frame: title bar with controls, a body, and the keyboard rules every window shares.
// It holds no position of its own; it reports drags and clicks and draws the bounds it is given.
import { createEffect, createSignal, createUniqueId, type JSX, on, Show } from 'solid-js'
import { classes } from '../classes/classes.ts'
import type { Icon } from '../icons/icons.ts'
import styles from './window.module.css'

export interface WindowBounds {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** A buzz: shake the window, or flash its title bar when motion is reduced. */
export interface WindowAlert {
  readonly kind: 'shake' | 'flash'
  /** Changing the key plays the alert again. */
  readonly key: number
}

export interface WindowProps {
  title: string
  icon?: Icon | undefined
  active: boolean
  bounds: WindowBounds
  maximized?: boolean | undefined
  /** Which buttons besides Close the title bar has. */
  controls?:
    | { readonly minimize?: boolean; readonly maximize?: boolean; readonly help?: boolean }
    | undefined
  resizable?: boolean | undefined
  zIndex?: number | undefined
  alert?: WindowAlert | undefined
  onFocus?: (() => void) | undefined
  onClose?: (() => void) | undefined
  onMinimize?: (() => void) | undefined
  onToggleMaximize?: (() => void) | undefined
  onHelp?: (() => void) | undefined
  onMove?: ((x: number, y: number) => void) | undefined
  onResize?: ((width: number, height: number) => void) | undefined
  children: JSX.Element
  class?: string | undefined
}

/** How many screen pixels one stage pixel covers, so drags work at any whole scale. */
function stageScale(element: HTMLElement): number {
  const width = element.offsetWidth
  return width === 0 ? 1 : element.getBoundingClientRect().width / width || 1
}

const isEditable = (target: EventTarget | null) =>
  target instanceof HTMLTextAreaElement ||
  (target instanceof HTMLInputElement && target.type === 'text') ||
  target instanceof HTMLButtonElement ||
  target instanceof HTMLSelectElement ||
  target instanceof HTMLAnchorElement

export function Window(props: WindowProps) {
  const titleId = createUniqueId()
  const [alertClass, setAlertClass] = createSignal('')
  let root: HTMLElement | undefined
  let altAlone = false

  createEffect(
    on(
      () => props.alert?.key,
      () => {
        const alert = props.alert
        if (alert === undefined) return
        // Restart the animation even when the same alert plays twice in a row.
        setAlertClass('')
        requestAnimationFrame(() => setAlertClass(styles[alert.kind]))
      },
      { defer: true },
    ),
  )

  // The active window owns the keyboard: focus moves into it when it becomes active, and clicks
  // on its plain text land on the window itself (tabIndex -1) rather than the page body.
  createEffect(() => {
    if (props.active && root !== undefined && !root.contains(document.activeElement)) {
      root.focus({ preventScroll: true })
    }
  })

  /** Drags with the pointer, reporting stage pixels to `report`. */
  const drag = (event: PointerEvent, report: (dx: number, dy: number) => void) => {
    if (event.button !== 0 || root === undefined) return
    const handle = event.currentTarget as HTMLElement
    const scale = stageScale(root)
    const startX = event.clientX
    const startY = event.clientY
    handle.setPointerCapture?.(event.pointerId)
    const move = (moveEvent: PointerEvent) =>
      report((moveEvent.clientX - startX) / scale, (moveEvent.clientY - startY) / scale)
    const stop = () => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', stop)
      handle.removeEventListener('pointercancel', stop)
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', stop)
    handle.addEventListener('pointercancel', stop)
  }

  const onTitlePointerDown = (event: PointerEvent) => {
    if ((event.target as HTMLElement).closest('button') !== null || props.maximized === true) return
    const { x, y } = props.bounds
    drag(event, (dx, dy) => props.onMove?.(Math.round(x + dx), Math.round(y + dy)))
  }

  const onGripPointerDown = (event: PointerEvent) => {
    const { width, height } = props.bounds
    drag(event, (dx, dy) => props.onResize?.(Math.round(width + dx), Math.round(height + dy)))
  }

  const onKeyDown = (event: KeyboardEvent) => {
    altAlone = event.key === 'Alt'
    if (event.altKey && !event.ctrlKey && !event.metaKey && event.key.length === 1) {
      const key = event.key.toLowerCase()
      const target = root?.querySelector<HTMLElement>(
        `[data-access-key="${CSS.escape(key)}"]:not(:disabled):not([aria-disabled="true"])`,
      )
      if (target !== null && target !== undefined) {
        event.preventDefault()
        target.click()
      }
      return
    }
    if (event.key === 'Enter' && !isEditable(event.target)) {
      const fallback = root?.querySelector<HTMLButtonElement>('[data-default]:not(:disabled)')
      if (fallback !== null && fallback !== undefined) {
        event.preventDefault()
        fallback.click()
      }
    }
  }

  /** Alt pressed and released on its own moves focus to the menu bar. */
  const onKeyUp = (event: KeyboardEvent) => {
    if (event.key !== 'Alt' || !altAlone) return
    altAlone = false
    const first = root?.querySelector<HTMLElement>('[role="menubar"] [role="menuitem"]')
    if (first !== null && first !== undefined) {
      event.preventDefault()
      first.focus()
    }
  }

  const style = (): JSX.CSSProperties => ({
    left: `${props.bounds.x}px`,
    top: `${props.bounds.y}px`,
    width: `${props.bounds.width}px`,
    height: `${props.bounds.height}px`,
    'z-index': props.zIndex,
  })

  return (
    <section
      ref={root}
      role="dialog"
      aria-labelledby={titleId}
      tabIndex={-1}
      class={classes(
        styles.window,
        props.active && styles.active,
        props.maximized === true && styles.maximized,
        alertClass(),
        props.class,
      )}
      style={style()}
      onPointerDown={() => props.onFocus?.()}
      onFocusIn={() => {
        if (!props.active) props.onFocus?.()
      }}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      onAnimationEnd={() => setAlertClass('')}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: dragging is a pointer convenience; the title-bar buttons are the keyboard path. */}
      <div
        class={styles.titleBar}
        onPointerDown={onTitlePointerDown}
        onDblClick={(event) => {
          if ((event.target as HTMLElement).closest('button') !== null) return
          if (props.controls?.maximize === true) props.onToggleMaximize?.()
        }}
      >
        <Show when={props.icon}>
          {(icon) => (
            <img
              class={styles.icon}
              src={icon().src}
              alt=""
              width={icon().size}
              height={icon().size}
            />
          )}
        </Show>
        <span id={titleId} class={styles.title}>
          {props.title}
        </span>
        <div class={styles.controls}>
          <Show when={props.controls?.help}>
            <button
              type="button"
              class={classes(styles.control, styles.help)}
              aria-label="Help"
              onClick={() => props.onHelp?.()}
            />
          </Show>
          <Show when={props.controls?.minimize}>
            <button
              type="button"
              class={classes(styles.control, styles.minimize)}
              aria-label="Minimize"
              onClick={() => props.onMinimize?.()}
            />
          </Show>
          <Show when={props.controls?.maximize}>
            <button
              type="button"
              class={classes(
                styles.control,
                props.maximized === true ? styles.restore : styles.maximize,
              )}
              aria-label={props.maximized === true ? 'Restore' : 'Maximize'}
              onClick={() => props.onToggleMaximize?.()}
            />
          </Show>
          <button
            type="button"
            class={classes(styles.control, styles.close)}
            aria-label="Close"
            onClick={() => props.onClose?.()}
          />
        </div>
      </div>
      <div class={styles.body}>{props.children}</div>
      <Show when={props.resizable === true && props.maximized !== true}>
        <span class={styles.grip} aria-hidden="true" onPointerDown={onGripPointerDown} />
      </Show>
    </section>
  )
}
