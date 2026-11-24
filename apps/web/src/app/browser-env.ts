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

/** Waits for the bundled fonts so the first frame is drawn in them (decision 0009). */
export async function loadFonts(): Promise<void> {
  await Promise.all([
    document.fonts.load('11px "Wine Tahoma"'),
    document.fonts.load('12px "Vera Sans Mono"'),
  ]).catch(() => undefined)
}
