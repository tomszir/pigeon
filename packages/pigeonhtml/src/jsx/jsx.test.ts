import { describe, expect, it } from 'vitest'
import { sanitize, validate } from '../index.ts'
import * as dev from './jsx-dev-runtime.ts'
import { escapeHtml, Fragment, type Html, jsx, jsxs, raw, render } from './jsx-runtime.ts'

const text = (value: Html) => render(value)

describe('jsx', () => {
  it('writes an element with its attributes and children', () => {
    expect(text(jsx('a', { href: 'pigeon://help/', class: 'big', children: 'Help' }))).toBe(
      '<a href="pigeon://help/" class="big">Help</a>',
    )
  })

  it('escapes every string and number child and every attribute value', () => {
    const hostile = `<script>alert("x")</script> & 'y'`
    expect(text(jsx('p', { children: hostile }))).toBe(
      '<p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;y&#39;</p>',
    )
    expect(text(jsx('p', { title: `" onclick="x`, children: 7 }))).toBe(
      '<p title="&quot; onclick=&quot;x">7</p>',
    )
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;')
  })

  it('writes children nested, in arrays and fragments, leaving out what is empty', () => {
    const list = jsxs('ul', {
      children: [1, 2, 3].map((n) => jsx('li', { children: ['No. ', n, null, false, undefined] })),
    })
    expect(text(list)).toBe('<ul><li>No. 1</li><li>No. 2</li><li>No. 3</li></ul>')
    expect(
      text(jsx(Fragment, { children: [jsx('b', { children: 'a' }), ' ', jsx('i', {})] })),
    ).toBe('<b>a</b> <i></i>')
  })

  it('writes a void element with no end tag, and refuses children for it', () => {
    expect(text(jsx('br', {}))).toBe('<br>')
    expect(text(jsx('img', { src: 'a.gif', alt: '' }))).toBe('<img src="a.gif" alt="">')
    expect(() => jsx('br', { children: 'text' })).toThrow('takes no children')
  })

  it('writes a standalone attribute bare when true and not at all when false', () => {
    expect(text(jsx('hr', { noshade: true, size: 1 }))).toBe('<hr noshade size="1">')
    expect(text(jsx('hr', { noshade: false, width: undefined }))).toBe('<hr>')
  })

  it('refuses an attribute name that could break out of its tag, or a value that is no text', () => {
    expect(() => jsx('p', { 'x onclick="y"': '1' })).toThrow('Not an attribute name')
    expect(() => jsx('p', { title: { toString: () => 'x' } })).toThrow('not a string or number')
    expect(() => jsx('p x', {})).toThrow('Not an element name')
  })

  it('makes Html a value no string or look-alike can stand in for', () => {
    expect(() => render('<b>x</b>' as unknown as Html)).toThrow('Not Html')
    expect(() => render({} as Html)).toThrow('Not Html')
    // A forged object as a child is refused, not written.
    expect(() => jsx('p', { children: { html: '<script>' } })).toThrow('Not Html')
    // A string that looks like markup is text.
    expect(text(jsx('p', { children: '<b>x</b>' }))).toBe('<p>&lt;b&gt;x&lt;/b&gt;</p>')
  })

  it('puts markup in as it is only through raw()', () => {
    expect(text(jsx('p', { children: raw('<b>trusted</b>') }))).toBe('<p><b>trusted</b></p>')
  })

  it('calls a component with its props, and takes only Html back from it', () => {
    const Greeting = (props: { readonly name?: unknown }) =>
      jsx('b', { children: props.name as string })
    expect(text(jsx(Greeting, { name: 'Mika' }))).toBe('<b>Mika</b>')
    const NotHtml = () => '<b>x</b>' as unknown as Html
    expect(() => jsx(NotHtml, {})).toThrow('Not Html')
  })

  it('writes a style as it is, and refuses one that could close itself', () => {
    expect(text(jsx('style', { children: 'p > b { color: #fff; content: "a" }' }))).toBe(
      '<style>p > b { color: #fff; content: "a" }</style>',
    )
    expect(() => jsx('style', { children: 'a {}</style><script>' })).toThrow('"<"')
  })

  it('serves the development runtime the same functions', () => {
    expect(text(dev.jsxDEV('b', { children: 'x' }, undefined, false))).toBe('<b>x</b>')
    expect(dev.jsx).toBe(jsx)
    expect(dev.Fragment).toBe(Fragment)
  })

  it('makes a page the sanitizer keeps whole, whatever text goes into it', () => {
    const hostile = [
      '<script>alert(1)</script>',
      '"><img src=x onerror=alert(1)>',
      '</title><script>x</script>',
      '&lt;b&gt; &amp;',
      '\u0000   ﻿',
    ]
    const page = text(
      jsx('html', {
        children: [
          jsx('head', { children: jsx('title', { children: hostile.join(' ') }) }),
          jsx('body', {
            bgcolor: hostile[1],
            children: hostile.map((h) =>
              jsx('p', { title: h, children: [h, jsx('a', { href: h, children: h })] }),
            ),
          }),
        ],
      }),
    )
    const result = sanitize(page, { image: (src) => src, link: (href) => href })
    expect(result.removed).toEqual([])
    expect(result.html).not.toMatch(/<(script|img)\b/)
    expect(validate(page).map((p) => p.message)).toEqual([])
    // The hostile text is still there, as text.
    expect(result.title).toContain('<script>alert(1)</script>')
  })
})
