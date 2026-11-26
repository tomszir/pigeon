/** @jsxImportSource @pigeon/pigeonhtml */
import { render } from '@pigeon/pigeonhtml/jsx-runtime'
import { describe, expect, it } from 'vitest'
import { helpDocument, Pre } from './page.pigeon.tsx'

describe('Pre', () => {
  it('keeps spaces and line breaks exactly, trimming only the blank lines around', () => {
    const diagram = '\n   +--+\n   |  |   a  b\n   +--+\n\n'
    expect(render(<Pre text={diagram} />)).toBe('<pre>   +--+\n   |  |   a  b\n   +--+</pre>')
  })

  it('escapes the diagram and takes a class', () => {
    expect(render(<Pre class="head" text={`<-- "a" & 'b' -->`} />)).toBe(
      '<pre class="head">&lt;-- &quot;a&quot; &amp; &#39;b&#39; --&gt;</pre>',
    )
  })
})

describe('helpDocument', () => {
  it('makes a whole document from a title, a style sheet and a body', () => {
    const page = helpDocument({
      title: 'A <title> & more',
      style: '\np { margin: 0 }\n',
      bodyAttributes: { bgcolor: '#ffffff', text: '#000000' },
      body: <p>Hello</p>,
    })
    expect(page.title).toBe('A <title> & more')
    expect(page.source).toBe(
      '<html><head><title>A &lt;title&gt; &amp; more</title><style>p { margin: 0 }</style></head>' +
        '<body bgcolor="#ffffff" text="#000000"><p>Hello</p></body></html>',
    )
  })
})

// What PigeonHTML doesn't have doesn't compile. `tsc` is what checks these: a line below that
// did compile would make its `@ts-expect-error` an error of its own. The function is never called.
describe('the types of a page', () => {
  it('refuse an element, an attribute or a value PigeonHTML lacks', () => {
    const refused = () => [
      // @ts-expect-error <section> is HTML5
      <section>x</section>,
      // @ts-expect-error on* handlers aren't PigeonHTML
      <td onclick="x">x</td>,
      // @ts-expect-error an <img> has no name
      <img name="x" alt="" />,
      // @ts-expect-error a void element has no children
      <br {...{ children: 'text' }} />,
      // @ts-expect-error noshade stands alone, true or false
      <hr noshade="yes" />,
      // @ts-expect-error a <script> isn't an element a page has
      <script>x</script>,
      // @ts-expect-error a plain string is text, not Html
      helpDocument({ title: 't', style: '', bodyAttributes: { onload: 'x' }, body: '' }),
    ]
    expect(refused).toBeTypeOf('function')
  })
})
