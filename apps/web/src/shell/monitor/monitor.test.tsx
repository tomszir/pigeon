import { fireEvent, render, screen } from '@solidjs/testing-library'
import { describe, expect, it } from 'vitest'
import { Monitor } from './monitor.tsx'

describe('Monitor', () => {
  it('turns the screen off and on with its power button', () => {
    render(() => (
      <Monitor scale={1} left={0} top={0}>
        <p>Desktop</p>
      </Monitor>
    ))
    const power = screen.getByRole('button', { name: 'Monitor power' })
    expect(power.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(power)
    expect(power.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(power)
    expect(power.getAttribute('aria-pressed')).toBe('true')
  })
})
