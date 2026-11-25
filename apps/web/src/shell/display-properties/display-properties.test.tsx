import { render, screen } from '@solidjs/testing-library'
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

describe('Display Properties', () => {
  it('is about the display alone: how Pigeon connects lives in Network', () => {
    render(() => (
      <DisplayProperties
        settings={settings}
        scale={1}
        layout="monitor"
        prefersReducedMotion={false}
        onChange={() => undefined}
        onClose={() => undefined}
      />
    ))
    expect(screen.queryByRole('tab', { name: 'Connection' })).toBeNull()
    expect(screen.queryByLabelText(/Always go through the relay/)).toBeNull()
  })
})
