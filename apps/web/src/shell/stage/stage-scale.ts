// How the screen fits the browser window: the CRT monitor around it at
// a whole-number scale; the bare screen when the monitor won't fit; the one-app phone layout when
// even the screen won't.

export const TASKBAR_HEIGHT = 30

export const RESOLUTIONS = [
  { id: '800x600', width: 800, height: 600 },
  { id: '1024x768', width: 1024, height: 768 },
  { id: '1280x1024', width: 1280, height: 1024 },
] as const

export type Resolution = (typeof RESOLUTIONS)[number]
export type ResolutionId = Resolution['id']

export const DEFAULT_RESOLUTION: ResolutionId = '1024x768'

export function resolution(id: ResolutionId): Resolution {
  return RESOLUTIONS.find((candidate) => candidate.id === id) ?? RESOLUTIONS[1]
}

/** The monitor's plastic and glass around the screen, in screen pixels at 1×. */
export const BEZEL = { side: 25, top: 25, bottom: 25 } as const

export const monitorSize = (screen: Resolution) => ({
  width: screen.width + BEZEL.side * 2,
  height: screen.height + BEZEL.top + BEZEL.bottom,
})

export type Layout =
  | {
      readonly kind: 'monitor' | 'bare'
      readonly scale: number
      readonly left: number
      readonly top: number
    }
  | { readonly kind: 'phone' }

const fits = (viewport: number, size: number) => Math.floor(viewport / size)

export function layoutFor(
  viewportWidth: number,
  viewportHeight: number,
  screen: Resolution,
): Layout {
  const monitor = monitorSize(screen)
  const scale = Math.min(fits(viewportWidth, monitor.width), fits(viewportHeight, monitor.height))
  // Whole pixels, so the scaled screen never lands between device pixels.
  const centre = (viewport: number, size: number) => Math.max(0, Math.floor((viewport - size) / 2))
  if (scale >= 1) {
    return {
      kind: 'monitor',
      scale,
      left: centre(viewportWidth, monitor.width * scale),
      top: centre(viewportHeight, monitor.height * scale),
    }
  }
  // No room for the plastic: the bare screen at 1×, as long as most of it is visible.
  if (viewportWidth >= screen.width && viewportHeight >= screen.height * (5 / 6)) {
    return {
      kind: 'bare',
      scale: 1,
      left: centre(viewportWidth, screen.width),
      top: centre(viewportHeight, screen.height),
    }
  }
  return { kind: 'phone' }
}
