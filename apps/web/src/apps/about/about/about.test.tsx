import { render, screen } from '@solidjs/testing-library'
import { describe, expect, it } from 'vitest'
import { About, WALLPAPER_PHOTOGRAPHER_URL } from './about.tsx'

describe('About', () => {
  it('credits the wallpaper photographer with a link to their Unsplash profile', () => {
    render(() => <About onClose={() => undefined} />)
    const link = screen.getByRole('link', { name: 'photo by @bchen22 on Unsplash' })
    expect(link.getAttribute('href')).toBe(WALLPAPER_PHOTOGRAPHER_URL)
  })
})
