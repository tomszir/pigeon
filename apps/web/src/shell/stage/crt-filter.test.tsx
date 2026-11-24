import { render } from '@solidjs/testing-library'
import { describe, expect, it } from 'vitest'
import { barrelShift, CrtFilter } from './crt-filter.tsx'

describe('barrelShift', () => {
  it.each([
    ['the centre stays put', 0, 0, 0, 0],
    ['a corner moves the full shift outwards', 1, 1, 4, 4],
    ['the middle of an edge moves half as far', 1, 0, 2, 0],
    ['the opposite corner mirrors it', -1, -1, -4, -4],
  ])('%s', (_, u, v, dx, dy) => {
    const [x, y] = barrelShift(u, v, 4)
    expect(x).toBeCloseTo(dx)
    expect(y).toBeCloseTo(dy)
  })
})

describe('CrtFilter', () => {
  it('draws a filter the size of the screen, and goes without curvature when there is no canvas', () => {
    const { container } = render(() => <CrtFilter id="crt" width={2048} height={1536} scale={2} />)
    const filter = container.querySelector('filter#crt')
    expect(filter?.getAttribute('width')).toBe('2048')
    expect(filter?.querySelector('feGaussianBlur')).not.toBeNull()
  })
})
