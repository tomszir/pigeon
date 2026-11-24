import { describe, expect, it } from 'vitest'
import { accessKeyOf, parseAccessKey, plainText } from './access-key.tsx'

describe('access keys', () => {
  it.each([
    ['&Send', '', 'S', 'end'],
    ['Se&al letter', 'Se', 'a', 'l letter'],
    ['No key', 'No key', '', ''],
    ['Fish && &Chips', 'Fish & ', 'C', 'hips'],
    ['Trailing &', 'Trailing &', '', ''],
  ])('%s', (text, before, key, after) => {
    expect(parseAccessKey(text)).toEqual({ before, key, after })
  })

  it('gives the plain text and the lower-case key', () => {
    expect(plainText('Send a &File...')).toBe('Send a File...')
    expect(accessKeyOf('Send a &File...')).toBe('f')
    expect(accessKeyOf('Help')).toBeUndefined()
  })
})
