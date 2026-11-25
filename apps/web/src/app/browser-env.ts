// The shell's view of the browser: viewport size, motion preference, the clock, outside links.
import { createSignal } from 'solid-js'
import type { ShellEnv } from '../shell/shell/types.ts'

export function createBrowserEnv(): ShellEnv {
  const size = () => ({ width: window.innerWidth, height: window.innerHeight })
  const [viewport, setViewport] = createSignal(size())
  window.addEventListener('resize', () => setViewport(size()))

  // The visual viewport shrinks when a phone's keyboard opens, where the layout viewport may not.
  const visibleNow = () => ({
    height: window.visualViewport?.height ?? window.innerHeight,
    top: window.visualViewport?.offsetTop ?? 0,
  })
  const [visible, setVisible] = createSignal(visibleNow())
  window.visualViewport?.addEventListener('resize', () => setVisible(visibleNow()))
  window.visualViewport?.addEventListener('scroll', () => setVisible(visibleNow()))
  window.addEventListener('resize', () => setVisible(visibleNow()))

  const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
  const [reduced, setReduced] = createSignal(motion.matches)
  motion.addEventListener('change', () => setReduced(motion.matches))

  const coarse = window.matchMedia('(pointer: coarse)')
  const [coarsePointer, setCoarsePointer] = createSignal(coarse.matches)
  coarse.addEventListener('change', () => setCoarsePointer(coarse.matches))

  return {
    viewport,
    coarsePointer,
    visible,
    prefersReducedMotion: reduced,
    now: () => new Date(),
    vibrate: (pattern) => {
      try {
        return typeof navigator.vibrate === 'function' && navigator.vibrate([...pattern])
      } catch {
        return false
      }
    },
    openLink: (url) => {
      window.open(url, '_blank', 'noopener')
    },
  }
}

/**
 * An iPhone or iPad in a browser tab rather than opened from the Home Screen, where Safari clears
 * a site's storage after 7 days without a visit, identity and all.
 */
export function needsHomeScreen(): boolean {
  const ios =
    /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const standalone =
    (navigator as Navigator & { standalone?: boolean }).standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches
  return ios && !standalone
}

/** "Firefox on Linux": what My Devices calls this browser until you rename it. */
export function deviceName(): string {
  const agent = navigator.userAgent
  const browser = /Edg\//.test(agent)
    ? 'Edge'
    : /Firefox\//.test(agent)
      ? 'Firefox'
      : /Chrome\//.test(agent)
        ? 'Chrome'
        : /Safari\//.test(agent)
          ? 'Safari'
          : 'A browser'
  const system = /iPhone/.test(agent)
    ? 'iPhone'
    : /iPad/.test(agent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
      ? 'iPad'
      : /Android/.test(agent)
        ? 'Android'
        : /Mac OS X/.test(agent)
          ? 'Mac'
          : /Windows/.test(agent)
            ? 'Windows'
            : /Linux/.test(agent)
              ? 'Linux'
              : 'a computer'
  return `${browser} on ${system}`
}

/** Waits for the bundled fonts so the first frame is drawn in them. */
export async function loadFonts(): Promise<void> {
  await Promise.all([
    document.fonts.load('11px "Wine Tahoma"'),
    document.fonts.load('12px "Vera Sans Mono"'),
  ]).catch(() => undefined)
}
