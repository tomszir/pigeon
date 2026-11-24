import type { WindowAlert } from '../../ui/window/window.tsx'

/** A buzz shakes the window unless the visitor asked for less motion or turned shaking off. */
export function buzzAlert(
  prefersReducedMotion: boolean,
  shakeOnBuzz: boolean,
): WindowAlert['kind'] {
  return prefersReducedMotion || !shakeOnBuzz ? 'flash' : 'shake'
}
