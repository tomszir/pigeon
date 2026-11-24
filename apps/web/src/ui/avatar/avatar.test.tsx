import { type AvatarTraits, avatarTraits } from '@pigeon/core'
import { render, screen } from '@solidjs/testing-library'
import { describe, expect, it } from 'vitest'
import { Avatar } from './avatar.tsx'

const traits: AvatarTraits = {
  ...avatarTraits(new Uint8Array(32)),
  plumage: 'slate',
  neck: 'copper',
  headwear: 'flat cap',
  neckwear: 'none',
  eyewear: 'none',
  held: 'none',
  scene: 'none',
}

describe('Avatar', () => {
  it('draws the bird, named for whose it is', () => {
    render(() => <Avatar traits={traits} size={32} name="Mika" />)
    const picture = screen.getByRole('img', {
      name: "Mika's pigeon: A slate pigeon with a copper neck, wearing a flat cap",
    })
    expect(picture.getAttribute('src')).toMatch(/^data:image\/svg\+xml/)
    expect(picture.getAttribute('width')).toBe('32')
  })

  it('holds the place with an empty frame while the traits are worked out', () => {
    const { container } = render(() => <Avatar traits={undefined} size={32} name="Mika" />)
    expect(screen.queryByRole('img')).toBeNull()
    expect((container.firstElementChild as HTMLElement).style.width).toBe('38px')
  })
})
