// The menu that opens from the pigeon button, laid out like the era's: a blue header, pinned
// programs on the white side with All Programs at the bottom, places and tools on the blue side,
// and Go Offline and Turn Off Pigeon in the footer. Highlight follows the pointer and clears when it
// leaves; the keyboard moves through every item.
import { createSignal, For, type JSX, onCleanup, onMount, Show } from 'solid-js'
import { classes } from '../../ui/classes/classes.ts'
import { brand, tango } from '../../ui/icons/icons.ts'
import type { Launcher, PigeonMenuSpec } from '../shell/types.ts'
import styles from './pigeon-menu.module.css'

/** Where an item sits, which sets its icon size and weight. */
type Kind = 'program' | 'recent' | 'place' | 'tool' | 'all'

export interface PigeonMenuProps {
  spec: PigeonMenuSpec
  /** Opened from the keyboard: highlight the first item. */
  focusFirst: boolean
  onClose: (refocus: boolean) => void
  onShutDown: () => void
}

export function PigeonMenu(props: PigeonMenuProps) {
  let root: HTMLDivElement | undefined
  const [allOpen, setAllOpen] = createSignal(false)

  const items = () =>
    root === undefined
      ? []
      : [...root.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')]

  const pick = (launcher: Launcher) => {
    if (launcher.disabled === true) return
    props.onClose(false)
    launcher.onOpen()
  }

  /** Hovering an item highlights it alone; any item but All Programs closes the flyout. */
  const hover = (event: PointerEvent, keepFlyout = false) => {
    if (!keepFlyout) setAllOpen(false)
    ;(event.currentTarget as HTMLElement).focus()
  }
  const unhover = () => root?.focus()

  const outside = (event: PointerEvent) => {
    const target = event.target as HTMLElement
    if (root?.contains(target) === true || target.closest('[data-pigeon-menu-button]') !== null) {
      return
    }
    props.onClose(false)
  }
  onMount(() => {
    if (props.focusFirst) items()[0]?.focus()
    else root?.focus()
    document.addEventListener('pointerdown', outside, true)
  })
  onCleanup(() => document.removeEventListener('pointerdown', outside, true))

  const onKeyDown = (event: KeyboardEvent) => {
    const list = items()
    const at = list.indexOf(document.activeElement as HTMLElement)
    const moves: Record<string, () => void> = {
      ArrowDown: () => list[(at + 1) % list.length]?.focus(),
      ArrowUp: () => list[at <= 0 ? list.length - 1 : at - 1]?.focus(),
      Home: () => list[0]?.focus(),
      End: () => list[list.length - 1]?.focus(),
      Escape: () => (allOpen() ? setAllOpen(false) : props.onClose(true)),
    }
    const move = moves[event.key]
    if (move === undefined) return
    event.preventDefault()
    move()
  }

  const item = (launcher: Launcher, kind: Kind): JSX.Element => (
    <MenuItem
      launcher={launcher}
      kind={kind}
      onPick={pick}
      onPointerEnter={(event) => hover(event, kind === 'all')}
      onPointerLeave={unhover}
    />
  )

  return (
    <div
      ref={root}
      role="menu"
      aria-label="Pigeon menu"
      tabIndex={-1}
      class={styles.pigeonMenu}
      onKeyDown={onKeyDown}
    >
      <div class={styles.header}>
        <img src={brand('pigeon-48')} alt="" width="42" height="42" class={styles.picture} />
        <span class={styles.name}>Pigeon</span>
      </div>
      <div class={styles.columns}>
        <div class={styles.rule} aria-hidden="true" />
        <div class={styles.left}>
          {/* Pinned programs (the ones with a description) come first, in bold, then the rest. */}
          <For each={props.spec.programs.filter((launcher) => launcher.description !== undefined)}>
            {(launcher) => item(launcher, 'program')}
          </For>
          <div class={styles.separator} aria-hidden="true" />
          <For each={props.spec.programs.filter((launcher) => launcher.description === undefined)}>
            {(launcher) => item(launcher, 'recent')}
          </For>
          <div class={styles.spacer} />
          <div class={styles.separator} aria-hidden="true" />
          <div class={styles.all}>
            <button
              type="button"
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={allOpen()}
              class={classes(styles.allButton, allOpen() && styles.allOpen)}
              onClick={() => setAllOpen(!allOpen())}
              onPointerEnter={(event) => {
                setAllOpen(true)
                hover(event, true)
              }}
              onKeyDown={(event) => {
                if (event.key === 'ArrowRight' || event.key === 'Enter') {
                  event.preventDefault()
                  event.stopPropagation()
                  setAllOpen(true)
                  root?.querySelector<HTMLElement>(`.${styles.flyout} [role="menuitem"]`)?.focus()
                }
              }}
            >
              All Programs
              <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
                <rect
                  x="0.5"
                  y="0.5"
                  width="17"
                  height="17"
                  rx="3"
                  fill="#3cb043"
                  stroke="#1d5a14"
                />
                <path d="M7 4.5 L11.5 9 L7 13.5" stroke="#ffffff" stroke-width="2.2" fill="none" />
              </svg>
            </button>
            <Show when={allOpen()}>
              <div
                role="menu"
                aria-label="All Programs"
                class={styles.flyout}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowLeft' || event.key === 'Escape') {
                    event.preventDefault()
                    event.stopPropagation()
                    setAllOpen(false)
                    root?.querySelector<HTMLElement>(`.${styles.allButton}`)?.focus()
                  }
                }}
              >
                <For each={props.spec.all}>{(launcher) => item(launcher, 'all')}</For>
              </div>
            </Show>
          </div>
        </div>
        <div class={styles.right}>
          <For each={props.spec.places}>{(launcher) => item(launcher, 'place')}</For>
          <div class={classes(styles.separator, styles.separatorBlue)} aria-hidden="true" />
          <For each={props.spec.tools}>{(launcher) => item(launcher, 'tool')}</For>
        </div>
      </div>
      <div class={styles.footer}>
        <button
          type="button"
          role="menuitem"
          class={styles.footerItem}
          aria-disabled="true"
          title="Pigeon has no connections to drop yet."
          onPointerEnter={(event) => hover(event)}
          onPointerLeave={unhover}
        >
          <img src={tango('system-log-out', 22)} alt="" width="22" height="22" />
          Go Offline
        </button>
        <button
          type="button"
          role="menuitem"
          class={styles.footerItem}
          onPointerEnter={(event) => hover(event)}
          onPointerLeave={unhover}
          onClick={() => {
            props.onClose(false)
            props.onShutDown()
          }}
        >
          <img src={tango('system-shutdown', 22)} alt="" width="22" height="22" />
          Turn Off Pigeon
        </button>
      </div>
    </div>
  )
}

function MenuItem(props: {
  launcher: Launcher
  kind: Kind
  onPick: (launcher: Launcher) => void
  onPointerEnter: (event: PointerEvent) => void
  onPointerLeave: () => void
}) {
  const size = () =>
    props.kind === 'program' || props.kind === 'recent' ? 32 : props.kind === 'all' ? 16 : 22
  const icon = () =>
    size() === 32
      ? props.launcher.icon32
      : size() === 22
        ? (props.launcher.icon22 ?? props.launcher.icon16)
        : props.launcher.icon16
  return (
    <button
      type="button"
      role="menuitem"
      class={classes(styles.item, styles[props.kind])}
      aria-disabled={props.launcher.disabled === true ? 'true' : undefined}
      onClick={() => props.onPick(props.launcher)}
      onPointerEnter={(event) => props.onPointerEnter(event)}
      onPointerLeave={() => props.onPointerLeave()}
    >
      <img src={icon().src} alt="" width={size()} height={size()} />
      <span class={styles.texts}>
        <span class={styles.text}>{props.launcher.label}</span>
        <Show when={props.kind === 'program' && props.launcher.description}>
          {(description) => <span class={styles.description}>{description()}</span>}
        </Show>
      </span>
    </button>
  )
}
