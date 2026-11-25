import { describe, expect, it } from 'vitest'
import { frameDocument } from './frame-document.ts'
import {
  DESKTOP_WIDTH,
  defaultView,
  keep,
  MEDIUM,
  openingView,
  textSize,
  viewStylesheet,
} from './view.ts'

describe('views', () => {
  it('opens in One Column on a phone and Desktop Layout otherwise, at Medium', () => {
    expect(defaultView(true)).toEqual({ mode: 'one-column', text: MEDIUM })
    expect(defaultView(false)).toEqual({ mode: 'desktop', text: MEDIUM })
  })

  it('One Column stacks tables and shrinks images, but keeps preformatted lines', () => {
    const css = viewStylesheet({ mode: 'one-column', text: MEDIUM }, true)
    expect(css).toContain('td,th')
    expect(css).toContain('display:block!important')
    expect(css).toContain('max-width:100%!important')
    expect(css).toContain('pre,xmp,listing{overflow-x:auto!important')
    expect(css).not.toContain('zoom')
  })

  it("Desktop Layout keeps a page's width on a phone and adds nothing on the desktop", () => {
    expect(viewStylesheet({ mode: 'desktop', text: MEDIUM }, true)).toBe(
      `html{min-width:${DESKTOP_WIDTH}px}`,
    )
    expect(viewStylesheet({ mode: 'desktop', text: MEDIUM }, false)).toBe('')
  })

  it('Text Size zooms the page, and stops at either end', () => {
    expect(viewStylesheet({ mode: 'desktop', text: 4 }, false)).toBe('html{zoom:1.45}')
    expect(viewStylesheet({ mode: 'desktop', text: 0 }, false)).toBe('html{zoom:0.7}')
    expect(textSize(9)).toBe(4)
    expect(textSize(-3)).toBe(0)
  })

  it("goes after the base styles and before the page, which it doesn't change", () => {
    const doc = frameDocument('<p>hi</p>', [], 'https://pigeon.test/', {
      view: { mode: 'one-column', text: MEDIUM },
      phone: true,
    })
    expect(doc.indexOf('display:block!important')).toBeGreaterThan(doc.indexOf('@font-face'))
    expect(doc.endsWith('<p>hi</p>')).toBe(true)
    expect(frameDocument('<p>hi</p>', [], 'https://pigeon.test/').match(/<style>/g)).toHaveLength(1)
  })

  it('keeps the text size for every window, but a mode only for the layout it was chosen on', () => {
    const desktop = openingView(undefined, false)
    // Text Larger on the desktop: the phone still opens in One Column, a size larger.
    const larger = keep(undefined, desktop, { ...desktop, text: 3 }, false)
    expect(larger).toEqual({ text: 3 })
    expect(openingView(larger, true)).toEqual({ mode: 'one-column', text: 3 })
    // Desktop Layout chosen on the phone stays the phone's, and the desktop keeps its own.
    const phone = openingView(larger, true)
    const chosen = keep(larger, phone, { ...phone, mode: 'desktop' }, true)
    expect(openingView(chosen, true)).toEqual({ mode: 'desktop', text: 3 })
    expect(openingView(chosen, false)).toEqual({ mode: 'desktop', text: 3 })
    const column = keep(chosen, desktop, { ...desktop, mode: 'one-column' }, false)
    expect(openingView(column, true).mode).toBe('desktop')
    expect(openingView(column, false).mode).toBe('one-column')
  })
})
