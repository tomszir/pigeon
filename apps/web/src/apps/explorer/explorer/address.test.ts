import { describe, expect, it } from 'vitest'
import { linkTarget, typedAddress } from './address.ts'

describe('typedAddress', () => {
  it('reads a bare name as a pigeon:// address', () => {
    expect(typedAddress(' mika ')).toBe('pigeon://mika')
    expect(typedAddress('mika/pics/')).toBe('pigeon://mika/pics/')
  })

  it('spells the same page one way', () => {
    expect(typedAddress('PIGEON://Home/')).toBe('pigeon://home')
    expect(typedAddress('pigeon://home#top')).toBe('pigeon://home')
  })

  it('keeps other schemes as typed and ignores nothing', () => {
    expect(typedAddress('https://example.com')).toBe('https://example.com')
    expect(typedAddress('   ')).toBeUndefined()
  })
})

describe('linkTarget', () => {
  it('resolves relative links against the page', () => {
    expect(linkTarget('about', 'pigeon://home')).toBe('pigeon://home/about')
    expect(linkTarget('cats.htm', 'pigeon://mika/pics/')).toBe('pigeon://mika/pics/cats.htm')
    expect(linkTarget('../index.htm', 'pigeon://mika/pics/cats.htm')).toBe(
      'pigeon://mika/index.htm',
    )
    expect(linkTarget('//sam', 'pigeon://mika')).toBe('pigeon://sam')
  })

  it('keeps in-page links', () => {
    expect(linkTarget('#guestbook', 'pigeon://mika')).toBe('#guestbook')
    expect(linkTarget('#', 'pigeon://mika')).toBeUndefined()
  })

  it('drops everything that is not pigeon://', () => {
    for (const href of ['https://example.com', 'http://x', 'mailto:a@b', 'javascript:alert(1)']) {
      expect(linkTarget(href, 'pigeon://home')).toBeUndefined()
    }
  })
})
