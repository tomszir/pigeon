import { fireEvent, render, screen } from '@solidjs/testing-library'
import { createSignal } from 'solid-js'
import { describe, expect, it } from 'vitest'
import type { Settings } from '../shell/types.ts'
import { DisplayProperties } from './display-properties.tsx'

const settings: Settings = {
  resolution: '1024x768',
  crtEffect: true,
  pixelMode: false,
  shakeOnBuzz: true,
  lcdEffect: true,
  screensaver: 'pigeons',
  screensaverWait: 5,
}

function renderSettings(layout: 'monitor' | 'phone', relayOnly: boolean | undefined) {
  const [on, setOn] = createSignal(relayOnly)
  render(() => (
    <DisplayProperties
      settings={settings}
      scale={1}
      layout={layout}
      prefersReducedMotion={false}
      connection={{ relayOnly: on, setRelayOnly: setOn }}
      onChange={() => undefined}
      onClose={() => undefined}
    />
  ))
  return on
}

describe('Display Properties', () => {
  it('has the relay setting on its Connection tab, the same one the Messenger has', () => {
    const on = renderSettings('monitor', false)
    fireEvent.click(screen.getByRole('tab', { name: 'Connection' }))
    const check = screen.getByLabelText(/Always go through the relay/)
    fireEvent.click(check)
    expect(on()).toBe(true)
  })

  it('shows it on the phone too', () => {
    renderSettings('phone', true)
    const check = screen.getByLabelText(/Always go through the relay/)
    expect((check as HTMLInputElement).checked).toBe(true)
  })

  it('waits for the Messenger before it can be changed', () => {
    renderSettings('phone', undefined)
    const check = screen.getByLabelText(/Always go through the relay/)
    expect((check as HTMLInputElement).disabled).toBe(true)
    expect(screen.getByText('Available once Pigeon Messenger has started.')).toBeTruthy()
  })
})
