import { render } from '@solidjs/testing-library'
import { describe, expect, it } from 'vitest'
import { Backdrop } from './backdrop.tsx'

describe('Backdrop', () => {
  it('leaves a plain, hidden canvas where WebGL is not available', () => {
    const { container } = render(() => (
      <Backdrop monitor={{ left: 0, top: 0, width: 1116, height: 886 }} still />
    ))
    const canvas = container.querySelector('canvas')
    expect(canvas).not.toBeNull()
    expect(canvas?.closest('[aria-hidden="true"]')).not.toBeNull()
  })
})
