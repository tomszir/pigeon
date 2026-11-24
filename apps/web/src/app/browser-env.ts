// The shell's view of the browser: viewport size, motion preference, the clock, outside links.
import { createSignal } from 'solid-js'
import type { ShellEnv } from '../shell/shell/types.ts'

export function createBrowserEnv(): ShellEnv {
  const size = () => ({ width: window.innerWidth, height: window.innerHeight })
  const [viewport, setViewport] = createSignal(size())
  window.addEventListener('resize', () => setViewport(size()))

  const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
  const [reduced, setReduced] = createSignal(motion.matches)
  motion.addEventListener('change', () => setReduced(motion.matches))

  return {
    viewport,
    prefersReducedMotion: reduced,
    now: () => new Date(),
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
