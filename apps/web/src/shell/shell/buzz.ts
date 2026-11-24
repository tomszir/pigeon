import type { WindowAlert } from '../../ui/window/window.tsx'

/** How a buzz feels on a phone: three short pulses, in ms on and off. */
export const BUZZ_VIBRATION: readonly number[] = [80, 40, 80, 40, 80]

/** A buzz shakes the window unless the visitor asked for less motion or turned shaking off. */
export function buzzAlert(
  prefersReducedMotion: boolean,
  shakeOnBuzz: boolean,
): WindowAlert['kind'] {
  return prefersReducedMotion || !shakeOnBuzz ? 'flash' : 'shake'
}
