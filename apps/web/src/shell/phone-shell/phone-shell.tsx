import type { Desktop, WindowId } from '@pigeon/core'
import {
  createEffect,
  createSignal,
  createUniqueId,
  For,
  type JSX,
  on,
  onCleanup,
  onMount,
  Show,
} from 'solid-js'
import { Balloon } from '../../ui/balloon/balloon.tsx'
import { brand, tangoIcon } from '../../ui/icons/icons.ts'
import { LayoutContext } from '../../ui/layout/layout.ts'
import { Marquee } from '../../ui/marquee/marquee.tsx'
import type { WindowAlert } from '../../ui/window/window.tsx'
import type {
  Launcher,
  Notice,
  PhoneSpec,
  PigeonMenuSpec,
  WindowHandle,
  WindowSpec,
} from '../shell/types.ts'
import styles from './phone-shell.module.css'

/** The screen's buzz when vibration isn't there: a shake, or a flash of the title bar. */
const ALERTS: Record<WindowAlert['kind'], Keyframe[]> = {
  shake: [
    { transform: 'translateX(0)' },
    { transform: 'translateX(-8px)' },
    { transform: 'translateX(7px)' },
    { transform: 'translateX(-5px)' },
    { transform: 'translateX(3px)' },
    { transform: 'translateX(0)' },
  ],
  flash: [
    { filter: 'none' },
    { filter: 'saturate(0.3) brightness(1.3)', offset: 0.25 },
    { filter: 'none', offset: 0.5 },
    { filter: 'saturate(0.3) brightness(1.3)', offset: 0.75 },
    { filter: 'none' },
  ],
}

/** The house moulded into the home key, as a stroke path on a 20×20 grid. */
const HOME_SYMBOL = 'M3 10 L10 4 L17 10 M5 9 V16 H15 V9'

export interface PhoneShellProps {
  specs: ReadonlyMap<WindowId, WindowSpec>
  desktop: Desktop
  menu: PigeonMenuSpec
  phone: PhoneSpec
  notice: Notice | null
  onCloseNotice: () => void
  now: () => Date
  /** A touch screen, where a focused text field means the on-screen keyboard is up. */
  touch: boolean
  /** Draw the LCD's pixel grid and backlight over the screen. */
  lcd: boolean
  /** Buzzes to show, for phones that couldn't vibrate. */
  alerts: ReadonlyMap<WindowId, WindowAlert>
  /** The part of the page on screen; the keyboard takes the rest. */
  visible: { readonly height: number; readonly top: number }
  onShutDown: () => void
  handle: (id: WindowId) => WindowHandle
}

/**
 * Below 1024×640 Pigeon runs on a Kestrel Pocket (decision 0019): a black handheld whose screen
 * fills the phone. One program at a time fills the screen under a title bar. Like a 2003
 * smartphone it has soft keys: the bottom of the screen names what the two oblong keys under it
 * do, the left one changing with the screen and the right one opening the Pigeon menu, and a
 * round key between them goes home to Today. While the on-screen keyboard is up the keys step
 * aside and the screen shrinks to what's visible, so the field being typed in and its buttons
 * stay above the keyboard.
 */
export function PhoneShell(props: PhoneShellProps) {
  const [home, setHome] = createSignal(true)
  const [menuOpen, setMenuOpen] = createSignal(false)
  const [time, setTime] = createSignal(props.now())
  const timer = setInterval(() => setTime(props.now()), 15_000)
  onCleanup(() => clearInterval(timer))
  const clock = () => time().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })

  let screen: HTMLDivElement | undefined
  let menuKey: HTMLButtonElement | undefined
  let menuList: HTMLDivElement | undefined

  // On a touch screen a focused text field brings up the keyboard. Watching focus works the same
  // whether the browser resizes the page for the keyboard (Android) or overlays it (iOS).
  const [typing, setTyping] = createSignal(false)
  const editable = (target: EventTarget | null) =>
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target instanceof HTMLTextAreaElement ||
      (target instanceof HTMLInputElement &&
        !['button', 'checkbox', 'radio', 'submit', 'range', 'color', 'file'].includes(target.type)))
  const onFocusIn = (event: FocusEvent) => setTyping(editable(event.target))
  const onFocusOut = (event: FocusEvent) => setTyping(editable(event.relatedTarget))
  document.addEventListener('focusin', onFocusIn)
  document.addEventListener('focusout', onFocusOut)
  onCleanup(() => {
    document.removeEventListener('focusin', onFocusIn)
    document.removeEventListener('focusout', onFocusOut)
  })
  const keyboardOpen = () => props.touch && typing()

  /** The window in front, or none. */
  const current = () => {
    const windows = props.desktop.windows
    for (let i = windows.length - 1; i >= 0; i--) {
      const window = windows[i]
      if (window !== undefined && !window.minimized && props.specs.has(window.id)) return window.id
    }
    return undefined
  }
  const showingHome = () => home() || current() === undefined

  // A window coming to the front (opened, or raised by a buzz) takes the screen from Today.
  createEffect(
    on(
      () => props.desktop.active,
      (active, previous) => {
        if (active !== null && active !== previous) {
          setHome(false)
          setMenuOpen(false)
        }
      },
      { defer: true },
    ),
  )

  // One window at a time on a phone, so the ones behind would only pile up: whatever comes to
  // the front closes the rest, and Today closes them all. Chats and friends live in the
  // Messenger, not its windows, so only drafts and open dialogs go.
  const closeAllBut = (keep: WindowId | undefined) => {
    for (const id of [...props.specs.keys()]) if (id !== keep) props.handle(id).close()
  }
  createEffect(
    on(
      () => (showingHome() ? undefined : current()),
      (front) => {
        if (front !== undefined) closeAllBut(front)
      },
      { defer: true },
    ),
  )

  // A buzz that couldn't vibrate shakes the screen, or flashes its title bar when motion is down.
  createEffect(
    on(
      () => {
        const id = current()
        return id === undefined ? undefined : props.alerts.get(id)
      },
      (alert) => {
        if (alert === undefined || screen === undefined) return
        const target =
          alert.kind === 'shake'
            ? screen.querySelector<HTMLElement>('[data-phone-screen]')
            : screen.querySelector<HTMLElement>('[data-phone-screen] header')
        target?.animate?.(ALERTS[alert.kind], { duration: 600, easing: 'ease-out' })
      },
      { defer: true },
    ),
  )

  // Focus follows the screen, so keyboard and screen-reader users start where the eyes do.
  createEffect(
    on(
      () => [showingHome(), current()] as const,
      () =>
        queueMicrotask(() => screen?.querySelector<HTMLElement>('[data-phone-screen]')?.focus()),
      { defer: true },
    ),
  )

  const closeMenu = (refocus: boolean) => {
    setMenuOpen(false)
    if (refocus) menuKey?.focus()
  }
  const openMenu = () => {
    setMenuOpen(true)
    queueMicrotask(() => menuList?.querySelector<HTMLElement>('button:not(:disabled)')?.focus())
  }

  const goHome = () => {
    setMenuOpen(false)
    setHome(true)
    closeAllBut(undefined)
  }
  const toggleMenu = () => (menuOpen() ? closeMenu(true) : openMenu())
  const left = () => props.phone.leftSoftKey(showingHome() ? undefined : current())
  const pressLeft = () => {
    setMenuOpen(false)
    setHome(false)
    left().onPress()
  }
  const rightLabel = () => (menuOpen() ? 'Close' : 'Menu')

  const launch = (launcher: Launcher) => {
    closeMenu(false)
    setHome(false)
    launcher.onOpen()
  }

  const menuKeys = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      closeMenu(true)
      return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const items = [...(menuList?.querySelectorAll<HTMLElement>('button:not(:disabled)') ?? [])]
    const at = items.indexOf(document.activeElement as HTMLElement)
    const step = event.key === 'ArrowDown' ? 1 : -1
    items[(at + step + items.length) % items.length]?.focus()
  }

  const menuSections = () => [props.menu.programs, props.menu.places, props.menu.tools]

  return (
    <LayoutContext.Provider value="phone">
      <div
        class={styles.phone}
        style={{ height: `${props.visible.height}px`, top: `${props.visible.top}px` }}
        data-keyboard={keyboardOpen() ? '' : undefined}
      >
        <div class={styles.bezel}>
          <div
            class={styles.screen}
            ref={screen}
            onPointerDown={(event) => {
              // While typing on a touch screen, tapping Send (or any button) keeps the field
              // focused: the keyboard stays up and the layout doesn't jump under the finger.
              if (
                props.touch &&
                editable(document.activeElement) &&
                event.target instanceof Element &&
                event.target.closest('button') !== null
              )
                event.preventDefault()
            }}
          >
            <Show
              when={!showingHome() && current()}
              fallback={
                <section class={styles.app} aria-label="Today" tabindex="-1" data-phone-screen>
                  <header class={styles.titleBar}>
                    <img src={brand('pigeon-16')} alt="" width="16" height="16" />
                    <h1 class={styles.barTitle}>Today</h1>
                    <time class={styles.clock}>{clock()}</time>
                  </header>
                  <div class={styles.body}>{props.phone.home()}</div>
                </section>
              }
            >
              {(id) => (
                <Show when={props.specs.get(id())}>
                  {(spec) => (
                    <section
                      class={styles.app}
                      aria-label={spec().title}
                      tabindex="-1"
                      data-phone-screen
                    >
                      <header class={styles.titleBar}>
                        <img src={spec().icon.src} alt="" width="16" height="16" />
                        <h1 class={styles.barTitle}>
                          <Marquee>{spec().taskTitle ?? spec().title}</Marquee>
                        </h1>
                        <time class={styles.clock}>{clock()}</time>
                        <button
                          type="button"
                          class={styles.close}
                          aria-label={`Close ${spec().taskTitle ?? spec().title}`}
                          onClick={() => props.handle(id()).close()}
                        >
                          <span aria-hidden="true">×</span>
                        </button>
                      </header>
                      <div class={styles.body}>{spec().content(props.handle(id()))}</div>
                    </section>
                  )}
                </Show>
              )}
            </Show>

            <Show when={!keyboardOpen()}>
              {/* What the keys under the screen do. A finger can press the words as well. */}
              <div class={styles.softKeys} aria-hidden="true">
                <button type="button" tabindex="-1" class={styles.softLabel} onClick={pressLeft}>
                  {left().label}
                </button>
                <button type="button" tabindex="-1" class={styles.softLabel} onClick={toggleMenu}>
                  {rightLabel()}
                </button>
              </div>
            </Show>

            <Show when={!keyboardOpen() && props.notice}>
              {(notice) => (
                <div class={styles.notice}>
                  <Balloon
                    title={notice().title}
                    icon={notice().icon ?? tangoIcon('dialog-information', 16)}
                    onClose={() => props.onCloseNotice()}
                  >
                    {notice().body}
                  </Balloon>
                </div>
              )}
            </Show>

            <Show when={menuOpen()}>
              <div class={styles.scrim} aria-hidden="true" onClick={() => closeMenu(true)} />
              <div
                class={styles.menu}
                role="menu"
                aria-label="Pigeon menu"
                ref={menuList}
                onKeyDown={menuKeys}
              >
                <div class={styles.menuHeader}>
                  <img src={brand('pigeon-32')} alt="" width="32" height="32" />
                  <strong>Pigeon</strong>
                </div>
                <For each={menuSections()}>
                  {(section, index) => (
                    <>
                      <Show when={index() > 0}>
                        <hr class={styles.menuRule} />
                      </Show>
                      <For each={section}>
                        {(launcher) => (
                          <button
                            type="button"
                            role="menuitem"
                            class={styles.menuItem}
                            disabled={launcher.disabled}
                            onClick={() => launch(launcher)}
                          >
                            <img
                              src={(launcher.icon22 ?? launcher.icon16).src}
                              alt=""
                              width="22"
                              height="22"
                            />
                            <span>{launcher.label}</span>
                          </button>
                        )}
                      </For>
                    </>
                  )}
                </For>
                <div class={styles.menuFooter}>
                  <button
                    type="button"
                    role="menuitem"
                    class={styles.turnOff}
                    onClick={() => props.onShutDown()}
                  >
                    Turn off the Pocket
                  </button>
                </div>
              </div>
            </Show>

            <Show when={props.lcd}>
              <div class={styles.lcd} aria-hidden="true" />
            </Show>
          </div>
        </div>

        <Show when={!keyboardOpen()}>
          <nav class={styles.keys} aria-label="Pocket keys">
            <button
              type="button"
              class={styles.softKey}
              aria-label={`Left soft key: ${left().label}`}
              onClick={pressLeft}
            >
              <SoftKeyShape />
            </button>
            <button
              type="button"
              class={styles.homeKey}
              aria-label="Home: Today"
              aria-current={showingHome() && !menuOpen() ? 'page' : undefined}
              onClick={goHome}
            >
              <KeySymbol path={HOME_SYMBOL} />
            </button>
            <button
              type="button"
              class={styles.softKey}
              aria-label={`Right soft key: ${rightLabel()}`}
              aria-expanded={menuOpen()}
              ref={menuKey}
              onClick={toggleMenu}
            >
              <SoftKeyShape />
            </button>
          </nav>
        </Show>
      </div>
    </LayoutContext.Provider>
  )
}

function KeySymbol(props: { path: string }): JSX.Element {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d={props.path} />
    </svg>
  )
}

/**
 * A soft key's outline `width` px wide, drawn for the right-hand key with the home key's centre at
 * (0, 0); the left key is the same shape mirrored. It is a rounded square whose inner end follows
 * a circle of radius 32 around the 25px home key, its corners there rounded too. It's drawn to the
 * key's real width rather than stretched, so the hollow and corners keep their shape.
 */
export function softKeyPath(width: number): string {
  const outer = 22 + width
  return [
    'M 34 -23',
    `L ${outer - 12} -23`,
    `Q ${outer} -23 ${outer} -11`,
    `L ${outer} 11`,
    `Q ${outer} 23 ${outer - 12} 23`,
    'L 34 23',
    'Q 24 23 28.3 15',
    'A 32 32 0 0 0 28.3 -15',
    'Q 24 -23 34 -23',
    'Z',
  ].join(' ')
}

function SoftKeyShape(): JSX.Element {
  const id = createUniqueId()
  const [width, setWidth] = createSignal(128)
  let svg: SVGSVGElement | undefined
  onMount(() => {
    const measure = () => {
      const measured = svg?.getBoundingClientRect().width ?? 0
      if (measured > 40) setWidth(Math.round(measured))
    }
    measure()
    if (typeof ResizeObserver === 'undefined' || svg === undefined) return
    const observer = new ResizeObserver(measure)
    observer.observe(svg)
    onCleanup(() => observer.disconnect())
  })
  return (
    <svg class={styles.cap} ref={svg} viewBox={`22 -23 ${width()} 46`} aria-hidden="true">
      <defs>
        <linearGradient id={`${id}-face`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#3a3a3e" />
          <stop offset="0.45" stop-color="#2a2a2d" />
          <stop offset="1" stop-color="#1f1f22" />
        </linearGradient>
      </defs>
      <path
        d={softKeyPath(width())}
        fill={`url(#${id}-face)`}
        stroke="rgb(255 255 255 / 12%)"
        stroke-width="1"
      />
    </svg>
  )
}
