// The desktop shell: holds the window-manager state from @pigeon/core and draws the stage, the
// desktop, the windows, the taskbar, the menu and the tray. app/ creates it, fills the desktop and
// menu, and hands programs the ShellApi.

import {
  blurAll,
  closeWindow,
  type Desktop,
  emptyDesktop,
  findWindow,
  focusWindow,
  isMaximized,
  minimizeWindow,
  moveWindow,
  openWindow,
  refitWindows,
  resizeWindow,
  toggleFromTaskbar,
  toggleMaximize,
  type WindowId,
  type Workspace,
} from '@pigeon/core'
import {
  batch,
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  Match,
  on,
  onCleanup,
  onMount,
  Show,
  Switch,
} from 'solid-js'
import { backStep, useBack } from '../../ui/back/back.ts'
import { Balloon } from '../../ui/balloon/balloon.tsx'
import { DesktopIcon } from '../../ui/desktop-icon/desktop-icon.tsx'
import { brandIcon, tangoIcon } from '../../ui/icons/icons.ts'
import { MessageBox } from '../../ui/message-box/message-box.tsx'
import { Window, type WindowAlert } from '../../ui/window/window.tsx'
import { Backdrop } from '../backdrop/backdrop.tsx'
import { DisplayProperties } from '../display-properties/display-properties.tsx'
import { FullScreen } from '../full-screen/full-screen.tsx'
import { MazeSaver } from '../maze-saver/maze-saver.tsx'
import { Monitor } from '../monitor/monitor.tsx'
import { PhoneShell } from '../phone-shell/phone-shell.tsx'
import { PigeonMenu } from '../pigeon-menu/pigeon-menu.tsx'
import { Screensaver } from '../screensaver/screensaver.tsx'
import { Stage } from '../stage/stage.tsx'
import {
  DEFAULT_RESOLUTION,
  layoutFor,
  monitorSize,
  type Resolution,
  resolution,
  TASKBAR_HEIGHT,
} from '../stage/stage-scale.ts'
import { Taskbar } from '../taskbar/taskbar.tsx'
import { Wallpaper } from '../wallpaper/wallpaper.tsx'
import { BUZZ_VIBRATION, buzzAlert } from './buzz.ts'
import styles from './shell.module.css'
import type {
  Launcher,
  MessageSpec,
  Notice,
  PhoneSpec,
  PigeonMenuSpec,
  ScreenSpec,
  Settings,
  ShellApi,
  ShellEnv,
  TraySpec,
  WindowHandle,
  WindowSpec,
} from './types.ts'

/** Where windows may go on a screen: everything above the taskbar. */
export function workspaceFor(screen: Resolution): Workspace {
  return {
    width: screen.width,
    height: screen.height - TASKBAR_HEIGHT,
    minWidth: 160,
    minHeight: 100,
    grip: 40,
    titleBarHeight: 28,
  }
}

const DISPLAY_PROPERTIES = 'display-properties'

export interface ShellProps {
  desktopIcons: readonly Launcher[]
  quickLaunch: readonly Launcher[]
  menu: PigeonMenuSpec
  phone: PhoneSpec
  tray?: TraySpec | undefined
}

export interface CreatedShell {
  readonly api: ShellApi
  readonly Shell: (props: ShellProps) => JSX.Element
}

export function createShell(env: ShellEnv): CreatedShell {
  const [desktop, setDesktop] = createSignal<Desktop>(emptyDesktop)
  // Open windows' contents, in the order they opened: the taskbar's order.
  const [specs, setSpecs] = createSignal<ReadonlyMap<WindowId, WindowSpec>>(new Map())
  const [alerts, setAlerts] = createSignal<ReadonlyMap<WindowId, WindowAlert>>(new Map())
  const [notice, setNotice] = createSignal<Notice | null>(null)
  const [settings, storeSettings] = createSignal<Settings>({
    resolution: DEFAULT_RESOLUTION,
    crtEffect: true,
    pixelMode: false,
    shakeOnBuzz: true,
    lcdEffect: true,
    screensaver: 'pigeons',
    screensaverWait: 5,
  })
  const [running, setRunning] = createSignal(true)
  const [fullScreen, setFullScreen] = createSignal<ScreenSpec | undefined>()
  let messages = 0

  const screen = createMemo(() => resolution(settings().resolution))
  const workspace = createMemo(() => workspaceFor(screen()))
  const layout = createMemo(() => layoutFor(env.viewport().width, env.viewport().height, screen()))
  const scale = () => {
    const current = layout()
    return current.kind === 'phone' ? 1 : current.scale
  }

  const update = (change: (desktop: Desktop) => Desktop) => setDesktop(change(desktop()))

  /** A new resolution brings every window back inside the new screen. */
  const setSettings = (next: Settings) =>
    batch(() => {
      const resized = next.resolution !== settings().resolution
      storeSettings(next)
      if (resized) update((d) => refitWindows(d, workspace()))
    })

  const open = (id: WindowId, spec: WindowSpec) =>
    batch(() => {
      if (!specs().has(id)) setSpecs(new Map(specs()).set(id, spec))
      update((d) => openWindow(d, id, spec.bounds, workspace()))
    })

  const close = (id: WindowId) =>
    batch(() => {
      const next = new Map(specs())
      next.delete(id)
      setSpecs(next)
      update((d) => closeWindow(d, id))
    })

  const buzz = (id: WindowId) => {
    // A buzz is worth waking up for.
    if (!running()) wake()
    // A phone buzzes in the hand when it can; otherwise its screen shakes or flashes.
    if (layout().kind === 'phone' && settings().shakeOnBuzz && env.vibrate(BUZZ_VIBRATION)) return
    const kind = buzzAlert(env.prefersReducedMotion(), settings().shakeOnBuzz)
    const key = (alerts().get(id)?.key ?? 0) + 1
    setAlerts(new Map(alerts()).set(id, { kind, key }))
  }

  const message = (spec: MessageSpec) => {
    messages += 1
    const width = 340
    const height = 150
    open(`message-${messages}`, {
      title: spec.title,
      icon: brandIcon('pigeon-16'),
      bounds: {
        x: Math.round((workspace().width - width) / 2),
        y: Math.round((workspace().height - height) / 2),
        width,
        height,
      },
      content: (window) => (
        <MessageBox
          kind={spec.kind}
          buttons={[{ label: 'OK', isDefault: true, onClick: window.close }]}
        >
          <For each={spec.text}>{(line) => <p>{line}</p>}</For>
        </MessageBox>
      ),
    })
  }

  const openDisplayProperties = () =>
    open(DISPLAY_PROPERTIES, {
      // A phone has no monitor or resolution to set, only the Pocket's own screen.
      title: layout().kind === 'phone' ? 'Settings' : 'Display Properties',
      icon: tangoIcon('preferences-system', 16),
      bounds: { x: 322, y: 110, width: 380, height: 460 },
      content: (window) => (
        <DisplayProperties
          settings={settings()}
          scale={scale()}
          layout={layout().kind}
          prefersReducedMotion={env.prefersReducedMotion()}
          onChange={setSettings}
          onClose={window.close}
        />
      ),
    })

  // Turning Pigeon off puts it to sleep behind a screen saver; waking finds everything as it was.
  const shutDown = () =>
    batch(() => {
      setNotice(null)
      setRunning(false)
    })
  const wake = () => setRunning(true)

  const api: ShellApi = {
    open,
    close,
    isOpen: (id) => specs().has(id),
    isActive: (id) => desktop().active === id,
    buzz,
    notify: setNotice,
    onPhone: () => layout().kind === 'phone',
    message,
    openDisplayProperties,
    settings,
    setSettings,
    shutDown,
    setScreen: (spec) => setFullScreen(spec),
  }

  const handle = (id: WindowId): WindowHandle => ({
    id,
    close: () => close(id),
    minimize: () => update((d) => minimizeWindow(d, id)),
    buzz: () => buzz(id),
    isActive: () => desktop().active === id,
  })

  function Shell(props: ShellProps) {
    const [menuOpen, setMenuOpen] = createSignal(false)
    const [trayOpen, setTrayOpen] = createSignal(false)
    const [menuByKeyboard, setMenuByKeyboard] = createSignal(false)
    const [selectedIcon, setSelectedIcon] = createSignal<string | null>(null)
    let menuButton: HTMLElement | undefined

    const closeMenu = (refocus: boolean) => {
      setMenuOpen(false)
      if (refocus) menuButton?.focus()
    }

    // Back closes the Pigeon menu while it's open.
    const back = useBack()
    const menuBack = backStep(back, () => closeMenu(true))
    createEffect(() => (menuOpen() ? menuBack.open() : menuBack.close()))
    // The desktop's menu isn't drawn on the Pocket, so it closes when the layout turns into one.
    createEffect(
      on(
        () => layout().kind === 'phone',
        (phone) => phone && setMenuOpen(false),
      ),
    )
    // Asleep, Back wakes Pigeon, rather than stepping back behind the screen saver.
    const sleepBack = backStep(back, wake)
    createEffect(() => (running() ? sleepBack.close() : sleepBack.open()))

    // Ctrl+` steps through the open windows, back to front.
    const cycle = (event: KeyboardEvent) => {
      if (!event.ctrlKey || event.key !== '`') return
      const windows = desktop().windows
      const first = windows[0]
      if (first === undefined) return
      event.preventDefault()
      update((d) => focusWindow(d, first.id))
    }
    onMount(() => document.addEventListener('keydown', cycle))

    // Left alone long enough, Pigeon goes to sleep behind its screen saver or standby screen.
    let idle: ReturnType<typeof setTimeout> | undefined
    const restartIdle = () => {
      clearTimeout(idle)
      const minutes = settings().screensaverWait
      if (minutes > 0 && running()) idle = setTimeout(shutDown, minutes * 60_000)
    }
    const ACTIVITY = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'] as const
    onMount(() => {
      for (const kind of ACTIVITY) document.addEventListener(kind, restartIdle, { passive: true })
    })
    onCleanup(() => {
      clearTimeout(idle)
      for (const kind of ACTIVITY) document.removeEventListener(kind, restartIdle)
    })
    createEffect(on(() => [settings().screensaverWait, running()] as const, restartIdle))
    onCleanup(() => document.removeEventListener('keydown', cycle))

    const tasks = () =>
      [...specs().entries()].map(([id, spec]) => ({
        id,
        title: spec.taskTitle ?? spec.title,
        icon: spec.icon,
        active: desktop().active === id,
      }))

    const desktopView = () => (
      <>
        <Wallpaper screen={screen()} />
        <div
          class={styles.desktop}
          onPointerDown={(event) => {
            if (event.target !== event.currentTarget) return
            setSelectedIcon(null)
            update(blurAll)
          }}
        >
          <nav class={styles.icons} aria-label="Desktop">
            <For each={props.desktopIcons}>
              {(launcher) => (
                <DesktopIcon
                  icon={launcher.icon32}
                  label={launcher.label}
                  selected={selectedIcon() === launcher.id}
                  onSelect={() => setSelectedIcon(launcher.id)}
                  onOpen={() => launcher.onOpen()}
                />
              )}
            </For>
          </nav>
        </div>
        {/* Windows stay in opening order in the DOM, so a drag keeps its pointer capture when
            focus raises a window; z-index does the stacking. */}
        <For each={[...specs().keys()]}>
          {(id) => {
            const managed = () => findWindow(desktop(), id)
            const z = () => desktop().windows.findIndex((window) => window.id === id) + 1
            return (
              <Show when={specs().get(id)}>
                {(spec) => (
                  <Show when={managed()?.minimized === false ? managed() : undefined}>
                    {(window) => (
                      <Window
                        title={spec().title}
                        icon={spec().icon}
                        active={desktop().active === id}
                        bounds={window().bounds}
                        maximized={isMaximized(window())}
                        controls={{
                          minimize: spec().controls?.minimize ?? true,
                          maximize: spec().controls?.maximize ?? spec().resizable === true,
                        }}
                        resizable={spec().resizable}
                        zIndex={z()}
                        alert={alerts().get(id)}
                        onFocus={() => update((d) => focusWindow(d, id))}
                        onClose={() => close(id)}
                        onMinimize={() => update((d) => minimizeWindow(d, id))}
                        onToggleMaximize={() => update((d) => toggleMaximize(d, id, workspace()))}
                        onMove={(x, y) => update((d) => moveWindow(d, id, { x, y }, workspace()))}
                        onResize={(width, height) =>
                          update((d) => resizeWindow(d, id, { width, height }, workspace()))
                        }
                      >
                        {spec().content(handle(id))}
                      </Window>
                    )}
                  </Show>
                )}
              </Show>
            )
          }}
        </For>
        <Show when={notice()}>
          {(current) => (
            <div class={styles.balloonHost}>
              <Balloon
                title={current().title}
                icon={current().icon ?? tangoIcon('dialog-information', 16)}
                onClose={() => setNotice(null)}
                onClick={current().onClick}
              >
                {current().body}
              </Balloon>
            </div>
          )}
        </Show>
        <Show when={trayOpen() && props.tray}>
          {(tray) => <div class={styles.trayHost}>{tray().flyout(() => setTrayOpen(false))}</div>}
        </Show>
        <Show when={menuOpen()}>
          <PigeonMenu
            spec={props.menu}
            focusFirst={menuByKeyboard()}
            onClose={closeMenu}
            onShutDown={shutDown}
          />
        </Show>
        <div
          ref={(element) => {
            menuButton =
              element.querySelector<HTMLElement>('[data-pigeon-menu-button]') ?? undefined
          }}
          class={styles.taskbarHost}
        >
          <Taskbar
            menuOpen={menuOpen()}
            onToggleMenu={(keyboard) => {
              setMenuByKeyboard(keyboard)
              setMenuOpen(!menuOpen())
            }}
            quickLaunch={props.quickLaunch}
            tasks={tasks()}
            onTask={(id) => update((d) => toggleFromTaskbar(d, id))}
            now={env.now}
            peers={0}
            screenWidth={screen().width}
            tray={props.tray}
            trayOpen={trayOpen()}
            onToggleTray={() => {
              setNotice(null)
              setTrayOpen(!trayOpen())
            }}
          />
        </div>
      </>
    )

    const screenView = (current: { scale: number }) => (
      <Stage
        scale={current.scale}
        screen={screen()}
        pixelMode={settings().pixelMode}
        crt={settings().crtEffect}
      >
        <Show when={fullScreen()}>{(spec) => <FullScreen spec={spec()} />}</Show>
        <Show
          when={running()}
          fallback={
            settings().screensaver === 'maze' ? (
              <MazeSaver onWake={wake} still={env.prefersReducedMotion()} />
            ) : (
              <Screensaver onWake={wake} />
            )
          }
        >
          {desktopView()}
        </Show>
      </Stage>
    )

    return (
      <Switch
        fallback={
          <PhoneShell
            specs={specs()}
            desktop={desktop()}
            menu={props.menu}
            phone={props.phone}
            notice={notice()}
            onCloseNotice={() => setNotice(null)}
            now={env.now}
            touch={env.coarsePointer()}
            lcd={settings().lcdEffect}
            alerts={alerts()}
            visible={env.visible()}
            onShutDown={shutDown}
            asleep={!running()}
            onWake={wake}
            fullScreen={fullScreen()}
            handle={handle}
          />
        }
      >
        <Match
          when={(() => {
            const current = layout()
            return current.kind === 'monitor' ? current : undefined
          })()}
        >
          {(current) => (
            <div class={styles.room}>
              <Backdrop
                monitor={{
                  left: current().left,
                  top: current().top,
                  width: monitorSize(screen()).width * current().scale,
                  height: monitorSize(screen()).height * current().scale,
                }}
                still={env.prefersReducedMotion()}
              />
              <Monitor scale={current().scale} left={current().left} top={current().top}>
                {screenView(current())}
              </Monitor>
            </div>
          )}
        </Match>
        <Match
          when={(() => {
            const current = layout()
            return current.kind === 'bare' ? current : undefined
          })()}
        >
          {(current) => (
            <div class={styles.room}>
              <Backdrop
                monitor={{
                  left: current().left,
                  top: current().top,
                  width: screen().width,
                  height: screen().height,
                }}
                still={env.prefersReducedMotion()}
              />
              <div
                class={styles.bare}
                style={{ left: `${current().left}px`, top: `${current().top}px` }}
              >
                {screenView(current())}
              </div>
            </div>
          )}
        </Match>
      </Switch>
    )
  }

  return { api, Shell }
}
