import { render, screen } from '@solidjs/testing-library'
import { describe, expect, it } from 'vitest'
import { Monitor } from './monitor.tsx'

describe('Monitor', () => {
  it('frames the screen with nothing to press', () => {
    render(() => (
      <Monitor scale={1} left={0} top={0}>
        <p>Desktop</p>
      </Monitor>
    ))
    expect(screen.getByText('Desktop')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })
})
