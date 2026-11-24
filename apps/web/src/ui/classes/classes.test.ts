import { describe, expect, it } from 'vitest'
import { classes } from './classes.ts'

describe('classes', () => {
  it('joins the names that are on', () => {
    expect(classes('a', false, 'b', undefined, null, '', 'c')).toBe('a b c')
  })
})
