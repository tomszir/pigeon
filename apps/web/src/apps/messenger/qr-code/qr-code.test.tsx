import { render, screen } from '@solidjs/testing-library'
import { expect, it } from 'vitest'
import { QrCode } from './qr-code.tsx'

it('draws a whole number of pixels per module, with a quiet zone', () => {
  render(() => <QrCode text="https://pigeon.test/#invite/abc" label="Invite code" scale={3} />)
  const svg = screen.getByRole('img', { name: 'Invite code' })
  const size = Number(svg.getAttribute('width'))
  // Version 2 or 3 at this length: (25 or 29) modules + 2 × 2 border.
  expect([29 * 3, 33 * 3]).toContain(size)
  expect(svg.querySelector('path')?.getAttribute('d')).toMatch(/^M\d+ \d+h1v1h-1z/)
})
