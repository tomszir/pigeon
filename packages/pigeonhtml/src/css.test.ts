import { describe, expect, it } from 'vitest'
import { type CssContext, sanitizeDeclarations, sanitizeStylesheet, tokenize } from './css.ts'
import type { Removed } from './types.ts'

const context = (image: (src: string) => string | undefined = (src) => `/files/${src}`) => {
  const removed: Removed[] = []
  const value: CssContext = { image, report: (what) => removed.push(what) }
  return { context: value, removed }
}

const style = (text: string) => sanitizeDeclarations(text, context().context)
const sheet = (text: string) => sanitizeStylesheet(text, context().context)

describe('tokenize', () => {
  it('decodes escapes in names the way the browser does', () => {
    const [first] = tokenize(String.raw`\65 xpression`)
    expect(first).toMatchObject({ type: 'ident', value: 'expression' })
    expect(tokenize(String.raw`be\havior`)[0]).toMatchObject({ value: 'behavior' })
    expect(tokenize(String.raw`\000065xpression`)[0]).toMatchObject({ value: 'expression' })
  })

  it('reads strings, URLs, numbers and comments', () => {
    expect(tokenize(`'a\\'b' url( x.gif ) 1.5em 50% /* gone */ #fff`).map((t) => t.type)).toEqual([
      'string',
      'ws',
      'url',
      'ws',
      'dimension',
      'ws',
      'percentage',
      'ws',
      'ws',
      'hash',
    ])
    expect(tokenize('url("x.gif")').map((t) => t.type)).toEqual(['function', 'string', ')'])
  })

  it('marks broken strings and URLs', () => {
    expect(tokenize('"open\nx')[0]).toMatchObject({ type: 'bad' })
    expect(tokenize('url(a b)')[0]).toMatchObject({ type: 'bad' })
    expect(tokenize('url(a"b)')[0]).toMatchObject({ type: 'bad' })
  })
})

describe('declarations', () => {
  it('keeps CSS 2.1 and writes it out the same way every time', () => {
    expect(style('COLOR:Red;font-weight : bold ;; margin:0 auto')).toBe(
      'color: Red; font-weight: bold; margin: 0 auto',
    )
    expect(style('color: red !important')).toBe('color: red !important')
    expect(style('font: 12px/1.5 Verdana, sans-serif')).toBe('font: 12px/1.5 Verdana, sans-serif')
    expect(style('clip: rect(0px, 10px, 10px, 0px); color: rgb(0, 128, 255)')).toBe(
      'clip: rect(0px, 10px, 10px, 0px); color: rgb(0, 128, 255)',
    )
  })

  it('keeps font-family as written, for Explorer to map to the bundled clones', () => {
    expect(style(`font-family: 'Comic Sans MS', "Times New Roman", Arial`)).toBe(
      'font-family: "Comic Sans MS", "Times New Roman", Arial',
    )
  })

  it('drops properties and values from after 2003', () => {
    for (const text of [
      'border-radius: 4px',
      'box-shadow: 0 0 2px black',
      'display: flex',
      'display: grid',
      'position: sticky',
      'width: calc(100% - 2px)',
      'color: var(--x)',
      'color: rgba(0, 0, 0, 0.5)',
      'background: linear-gradient(red, blue)',
      'transform: rotate(1deg)',
      'width: 10vw',
      'font-size: 2rem',
      '-webkit-box-shadow: none',
    ])
      expect(style(text), text).toBe('')
  })

  it('drops script hooks however they are spelled', () => {
    for (const text of [
      'width: expression(alert(1))',
      String.raw`width: e\78 pression(alert(1))`,
      String.raw`width: expr\65ssion(alert(1))`,
      'width: expr/**/ession(alert(1))',
      'behavior: url(x.htc)',
      String.raw`b\65havior: url(x.htc)`,
      '-moz-binding: url(x.xml#x)',
      String.raw`-moz-b\69nding: url(x.xml#x)`,
      'background: url(javascript:alert(1))',
      'background: url("javascript:alert(1)")',
      String.raw`background: url(java\73 cript:alert(1))`,
      'background: url(data:text/html,x)',
    ])
      expect(style(text), text).toBe('')
  })

  it('sends url() through urls.image, only where an image belongs', () => {
    expect(style('background: #fff url(bg.gif) repeat-x')).toBe(
      'background: #fff url("/files/bg.gif") repeat-x',
    )
    expect(style("list-style-image: url('dot.gif')")).toBe(
      'list-style-image: url("/files/dot.gif")',
    )
    expect(style('color: url(x.gif)')).toBe('')
    expect(style('background: rgb(url(x.gif))')).toBe('')
    const { context: none, removed } = context(() => undefined)
    expect(sanitizeDeclarations('background-image: url(bg.gif); color: red', none)).toBe(
      'color: red',
    )
    expect(removed).toEqual([
      { what: 'url', name: 'bg.gif' },
      { what: 'property', name: 'background-image' },
    ])
  })

  it('escapes what could close the element in strings', () => {
    expect(style(String.raw`font-family: "\3c /style\3e"`)).toBe(
      String.raw`font-family: "\3c /style\3e "`,
    )
    expect(style('font-family: "a\\"b"')).toBe(String.raw`font-family: "a\22 b"`)
  })

  it('drops names that need escapes', () => {
    expect(style(String.raw`font-family: url\28 "x"\29`)).toBe('')
    expect(style(String.raw`color: \31 23`)).toBe('')
  })

  it('reports what it drops', () => {
    const { context: value, removed } = context()
    sanitizeDeclarations('border-radius: 2px; color: red; junk', value)
    expect(removed).toEqual([
      { what: 'property', name: 'border-radius' },
      { what: 'property', name: 'junk' },
    ])
  })
})

describe('stylesheets', () => {
  it('keeps CSS 2.1 rules and selectors', () => {
    expect(
      sheet(
        'body{background:#000;color:#0f0} a:hover , a:visited{color:yellow} td.x > b + i{font-weight:bold} input[type="text"]{color:red} p:first-letter{font-size:2em} :lang(en){quotes:"a" "b"}',
      ),
    ).toBe(
      [
        'body { background: #000; color: #0f0 }',
        'a:hover , a:visited { color: yellow }',
        'td.x > b + i { font-weight: bold }',
        'input[type="text"] { color: red }',
        'p:first-letter { font-size: 2em }',
        ':lang(en) { quotes: "a" "b" }',
      ].join('\n'),
    )
  })

  it('keeps @media for screen and print only', () => {
    expect(sheet('@media screen, print { b { color: red } }')).toBe(
      '@media screen, print {\nb { color: red }\n}',
    )
    expect(sheet('@media (min-width: 1px) { b { color: red } }')).toBe('')
    expect(sheet('@media screen and (color) { b { color: red } }')).toBe('')
    expect(sheet('@media tv { b { color: red } }')).toBe('')
    expect(sheet('@media print { @media print { b { color: red } } }')).toBe('')
  })

  it('drops @import, @font-face and every other at-rule', () => {
    const { context: value, removed } = context()
    expect(
      sanitizeStylesheet(
        '@import "x.css"; @import url(x.css); @font-face { font-family: x; src: url(x.ttf) } @charset "utf-8"; @page { margin: 0 } @keyframes k { from { color: red } } b { color: red }',
        value,
      ),
    ).toBe('b { color: red }')
    expect(removed.map((r) => r.name)).toEqual([
      '@import',
      '@import',
      '@font-face',
      '@charset',
      '@page',
      '@keyframes',
    ])
    expect(sheet(String.raw`@im\port "x.css"; b { color: red }`)).toBe('b { color: red }')
  })

  it('drops selectors from after CSS 2.1', () => {
    for (const text of [
      'p::before { color: red }',
      'p:nth-child(2) { color: red }',
      'p:not(.x) { color: red }',
      'a[href^="x"] { color: red }',
      'p ~ p { color: red }',
      'p:has(b) { color: red }',
    ])
      expect(sheet(text), text).toBe('')
  })

  it('ignores the comment markers pages wrapped their styles in', () => {
    expect(sheet('<!-- b { color: red } -->')).toBe('b { color: red }')
  })

  it('never writes out anything that could close <style>', () => {
    const out = sheet(
      String.raw`b:after { content: "</style><script>alert(1)</script>" } i:after { content: "\3c /style\3e" } </style> <!-- --> u { color: red }`,
    )
    expect(out).not.toMatch(/<|>/)
  })
})

describe('what a page may not do to the frame around it', () => {
  it('drops position: fixed, which could pin a layer over the whole frame', () => {
    expect(style('position: fixed; color: red')).toBe('color: red')
    expect(style('position: absolute')).toBe('position: absolute')
  })

  it('keeps z-index to whole numbers near 0', () => {
    expect(style('z-index: 100')).toBe('z-index: 100')
    expect(style('z-index: -100')).toBe('z-index: -100')
    expect(style('z-index: auto')).toBe('z-index: auto')
    expect(style('z-index: 101')).toBe('')
    expect(style('z-index: 99999')).toBe('')
    expect(style('z-index: 1.5')).toBe('')
  })

  it('drops cursor images, which can paint past the frame', () => {
    expect(style('cursor: url(hand.cur), pointer')).toBe('')
    expect(style('cursor: pointer')).toBe('cursor: pointer')
  })

  it('refuses words a comment kept apart, rather than writing them as one', () => {
    const { context: ctx, removed } = context()
    expect(sanitizeDeclarations('width: 100/**/vw; color: red', ctx)).toBe('color: red')
    expect(removed).toEqual([{ what: 'property', name: 'width' }])
    expect(style('margin: 1px/**/2px')).toBe('')
    expect(style('margin: 1px 2px')).toBe('margin: 1px 2px')
    expect(style('font: 12px/1.5 serif')).toBe('font: 12px/1.5 serif')
  })
})
