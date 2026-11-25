// What the shell offers the composition root (app/) and what it needs from it.
import type { Bounds, WindowId } from '@pigeon/core'
import type { JSX } from 'solid-js'
import type { Icon } from '../../ui/icons/icons.ts'
import type { MessageKind } from '../../ui/message-box/message-box.tsx'
import type { ResolutionId } from '../stage/stage-scale.ts'

/** Everything the shell reads from the browser, passed in so tests can stand in fakes. */
export interface ShellEnv {
  readonly viewport: () => { readonly width: number; readonly height: number }
  /**
   * The part of the page actually on screen. On a phone the on-screen keyboard shrinks it, and
   * it may be scrolled down by `top`; elsewhere it matches the viewport.
   */
  readonly visible: () => { readonly height: number; readonly top: number }
  readonly prefersReducedMotion: () => boolean
  /** The main pointer is a finger, so the phone layout expects an on-screen keyboard. */
  readonly coarsePointer: () => boolean
  readonly now: () => Date
  /** Vibrates the device; false where it can't (most desktops, iPhones). */
  readonly vibrate: (pattern: readonly number[]) => boolean
  /** Opens an outside page in a new tab. */
  readonly openLink: (url: string) => void
}

export interface WindowHandle {
  readonly id: WindowId
  readonly close: () => void
  readonly minimize: () => void
  /** Shakes the window, or flashes its title bar when motion is reduced. */
  readonly buzz: () => void
  readonly isActive: () => boolean
}

export interface WindowSpec {
  readonly title: string
  /** Shorter title for the taskbar button. */
  readonly taskTitle?: string
  /** 16px, for the title bar and taskbar. */
  readonly icon: Icon
  readonly bounds: Bounds
  readonly controls?: { readonly minimize?: boolean; readonly maximize?: boolean }
  readonly resizable?: boolean
  readonly content: (window: WindowHandle) => JSX.Element
}

export interface Notice {
  readonly title: string
  readonly body: JSX.Element
  readonly icon?: Icon
  /** Clicking the balloon does this, then closes it. */
  readonly onClick?: () => void
}

export interface MessageSpec {
  readonly title: string
  readonly kind: MessageKind
  readonly text: readonly string[]
}

/** The desktop's screen savers: pigeons crossing a night sky, or a walk through a maze. */
export type ScreensaverId = 'pigeons' | 'maze'

export interface Settings {
  /** The screen resolution the desktop is laid out at. */
  readonly resolution: ResolutionId
  /** Scanlines, phosphor grille, curved glass and refresh roll over the screen; on by default. */
  readonly crtEffect: boolean
  /** Sample one pixel per 2×2 block at scale 2. */
  readonly pixelMode: boolean
  /** Shake a window on a buzz; when off, or when motion is reduced, the title bar flashes. */
  readonly shakeOnBuzz: boolean
  /** The Pocket's pixel grid and backlight on a phone; on by default. */
  readonly lcdEffect: boolean
  /** What the desktop shows while Pigeon is turned off. */
  readonly screensaver: ScreensaverId
  /** Minutes without a touch, click or key before Pigeon goes to sleep by itself; 0 never. */
  readonly screensaverWait: number
}

export interface ShellApi {
  readonly open: (id: WindowId, spec: WindowSpec) => void
  readonly close: (id: WindowId) => void
  readonly isOpen: (id: WindowId) => boolean
  /** True while the window has focus. */
  readonly isActive: (id: WindowId) => boolean
  readonly buzz: (id: WindowId) => void
  readonly notify: (notice: Notice) => void
  /** The Pocket's phone layout is showing, not the desktop. */
  readonly onPhone: () => boolean
  readonly message: (message: MessageSpec) => void
  readonly openDisplayProperties: () => void
  readonly settings: () => Settings
  readonly setSettings: (settings: Settings) => void
  readonly shutDown: () => void
  /**
   * Covers the whole screen, for a state nothing behind it works in: Pigeon in another tab,
   * or Pigeon unable to start. Undefined clears it.
   */
  readonly setScreen: (screen: ScreenSpec | undefined) => void
}

/** What a full screen says, and the few things it lets you do. */
export interface ScreenSpec {
  /** An error shows the error icon; a notice, Pigeon's own. */
  readonly kind: 'notice' | 'error'
  readonly title: string
  readonly text: string
  /** What went wrong, in a developer's words, for a bug report. */
  readonly details?: string | undefined
  readonly buttons: readonly {
    readonly label: string
    readonly onClick: () => void
    readonly isDefault?: boolean
  }[]
}

/** Something the user can start from the desktop, the menu or the quick-launch bar. */
export interface Launcher {
  readonly id: string
  readonly label: string
  /** Second line in the menu: "Chat with friends". */
  readonly description?: string
  readonly icon16: Icon
  readonly icon22?: Icon
  readonly icon32: Icon
  readonly onOpen: () => void
  readonly disabled?: boolean
}

export interface PigeonMenuSpec {
  /** Big icons on the white side. */
  readonly programs: readonly Launcher[]
  /** Bold places on the blue side. */
  readonly places: readonly Launcher[]
  /** Plain items under the places. */
  readonly tools: readonly Launcher[]
  /** Everything, for All Programs. */
  readonly all: readonly Launcher[]
  /**
   * Who the header greets, as XP's did: your name and your picture. Without it, or before you
   * have a name, the header says Pigeon with its logo.
   */
  readonly user?: () => { readonly name: string; readonly picture: Icon | undefined }
}

/** The left soft key's word and what it does, for whatever is on the Pocket's screen. */
export interface SoftKey {
  readonly label: string
  readonly onPress: () => void
}

/** What the phone layout needs from app/ beyond the menu. */
/** Pigeon's own icon in the desktop's tray: how many things wait, and the list it opens. */
export interface TraySpec {
  readonly count: () => number
  /** What the icon says to a screen reader and in its tooltip. */
  readonly label: () => string
  /** The list it opens above the tray; `close` closes it. */
  readonly flyout: (close: () => void) => JSX.Element
}

export interface PhoneSpec {
  /** The Today screen, shown at start and on the home key. */
  readonly home: () => JSX.Element
  /** The left soft key for the window in front, or for Today when there is none. */
  readonly leftSoftKey: (front: WindowId | undefined) => SoftKey
  /** What the standby screen says is new ("1 new from Mika"), or nothing. */
  readonly news: () => string | undefined
}
