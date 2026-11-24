import { describe, expect, it } from 'vitest'
import { layoutFor, monitorSize, resolution } from './stage-scale.ts'

const xga = resolution('1024x768')
const monitor = monitorSize(xga)

describe('layoutFor', () => {
  it('sizes the monitor as the screen plus its plastic', () => {
    expect(monitor).toEqual({ width: 1116, height: 886 })
  })

  it.each([
    ['a 1080p browser window', 1920, 960, 1, 402, 37],
    ['a 1440p screen', 2560, 1300, 1, 722, 207],
    ['a 4K screen', 3840, 2000, 2, 804, 114],
    ['exactly two monitors', 2232, 1772, 2, 0, 0],
  ])('%s (%i×%i) shows the monitor at %i×', (_, width, height, scale, left, top) => {
    expect(layoutFor(width, height, xga)).toEqual({ kind: 'monitor', scale, left, top })
  })

  it.each([
    ['a small laptop', 1366, 650, 171, 0],
    ['a screen just short of the monitor', 1100, 768, 38, 0],
  ])('%s gets the bare screen at 1×', (_, width, height, left, top) => {
    expect(layoutFor(width, height, xga)).toEqual({ kind: 'bare', scale: 1, left, top })
  })

  it.each([
    ['a phone', 390, 844],
    ['a window narrower than the screen', 1000, 768],
    ['a letterbox-shaped window', 1440, 600],
  ])('%s gets the phone layout', (_, width, height) => {
    expect(layoutFor(width, height, xga)).toEqual({ kind: 'phone' })
  })

  it('fits a smaller resolution into the monitor sooner', () => {
    expect(layoutFor(1366, 650, xga).kind).toBe('bare')
    expect(layoutFor(1366, 760, resolution('800x600')).kind).toBe('monitor')
  })

  it('falls back to the bare screen for a resolution the window can hold but the monitor cannot', () => {
    expect(layoutFor(1920, 1040, resolution('1280x1024'))).toEqual({
      kind: 'bare',
      scale: 1,
      left: 320,
      top: 8,
    })
  })
})
