import { describe, expect, it } from 'vitest'
import { BASE_STYLESHEET, contentSecurityPolicy, frameDocument } from './frame-document.ts'

describe('frameDocument', () => {
  it('starts with the policy, not a doctype, so the page renders in quirks mode', () => {
    const doc = frameDocument('<p>hi</p>', [], 'https://pigeon.test/')
    expect(doc.startsWith('<meta http-equiv="Content-Security-Policy"')).toBe(true)
    expect(doc.toLowerCase()).not.toContain('<!doctype')
    expect(doc.endsWith('<p>hi</p>')).toBe(true)
  })

  it('loads nothing but inline styles, its own images and the bundled fonts', () => {
    const policy = contentSecurityPolicy(
      ['/assets/a.png', 'https://pigeon.test/assets/a.png?v=1', 'data:image/gif;base64,R0lG'],
      'https://pigeon.test/explorer',
    )
    const parts = policy.split('; ')
    expect(parts[0]).toBe("default-src 'none'")
    expect(parts[1]).toBe('img-src https://pigeon.test/assets/a.png data:')
    expect(parts[2]).toBe("style-src 'unsafe-inline'")
    expect(parts[3]).toMatch(/^font-src /)
    expect(policy).not.toMatch(/script-src|unsafe-eval|\*/)
  })

  it('lets a page with no images load none', () => {
    expect(contentSecurityPolicy([], 'https://pigeon.test/')).toContain("img-src 'none'")
  })

  it("maps the era's font names to the bundled clones", () => {
    for (const family of ['Tahoma', 'Verdana', 'Arial', 'Courier New']) {
      expect(BASE_STYLESHEET).toContain(`font-family:"${family}"`)
    }
  })
})
