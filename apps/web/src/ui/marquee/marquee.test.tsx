import { render, screen } from '@solidjs/testing-library'
import { expect, it } from 'vitest'
import { Marquee, marqueeLeg } from './marquee.tsx'

it('stays still when the text fits', () => {
  render(() => <Marquee>Mika is online</Marquee>)
  expect(screen.getByText('Mika is online').hasAttribute('data-moving')).toBe(false)
})

it('takes longer for longer overflow, at a readable pace, with a pause at each end', () => {
  expect(marqueeLeg(0)).toBe(1.5)
  expect(marqueeLeg(100)).toBe(5.5)
  expect(marqueeLeg(200)).toBeGreaterThan(marqueeLeg(100))
})
