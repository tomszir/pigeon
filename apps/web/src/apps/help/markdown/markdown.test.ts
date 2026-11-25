import { describe, expect, it } from 'vitest'
import { DIAGRAM_NOTE, escapeHtml, markdownToHtml, parseBlocks, renderInline } from './markdown.ts'

const help = (href: string) => (href === 'protocol.md' ? 'pigeon://help/protocol/' : undefined)
const html = (md: string) => markdownToHtml(md, help)

describe('parseBlocks', () => {
  it('reads headings, paragraphs, lists, tables and fences', () => {
    const blocks = parseBlocks(
      [
        '# Title',
        '',
        'One line',
        'and its next.',
        '',
        '- a',
        '- b',
        '  continued',
        '',
        '1. first',
        '2. second',
        '',
        '| A | B |',
        '| - | :-: |',
        '| `x|y` | 2 |',
        '',
        '```text',
        '  <drawn>',
        '```',
      ].join('\n'),
    )
    expect(blocks).toEqual([
      { kind: 'heading', level: 1, text: 'Title' },
      { kind: 'paragraph', text: 'One line and its next.' },
      { kind: 'list', ordered: false, start: 1, items: ['a', 'b continued'] },
      { kind: 'list', ordered: true, start: 1, items: ['first', 'second'] },
      {
        kind: 'table',
        head: ['A', 'B'],
        align: [undefined, 'center'],
        rows: [['`x|y`', '2']],
      },
      { kind: 'code', lang: 'text', text: '  <drawn>' },
    ])
  })

  it('runs an unclosed fence to the end', () => {
    expect(parseBlocks('```\na\nb')).toEqual([{ kind: 'code', lang: '', text: 'a\nb' }])
  })

  it('keeps a numbered list starting elsewhere', () => {
    expect(parseBlocks('3. c\n4. d')).toEqual([
      { kind: 'list', ordered: true, start: 3, items: ['c', 'd'] },
    ])
  })
})

describe('renderInline', () => {
  it('renders bold, italic and code', () => {
    expect(renderInline('**bold** *it* _also_ `a<b`', help)).toBe(
      '<b>bold</b> <i>it</i> <i>also</i> <code>a&lt;b</code>',
    )
  })

  it('leaves underscores inside words alone', () => {
    expect(renderInline('snake_case_name', help)).toBe('snake_case_name')
  })

  it('links docs shown in Help and shows the rest as text', () => {
    expect(renderInline('[the spec](protocol.md) and [design](design.md)', help)).toBe(
      '<a href="pigeon://help/protocol/">the spec</a> and design',
    )
  })

  it('keeps nested brackets and parentheses in a link', () => {
    expect(renderInline('[a [b]](protocol.md) (aside)', help)).toBe(
      '<a href="pigeon://help/protocol/">a [b]</a> (aside)',
    )
  })

  it('takes a backslash-escaped character literally', () => {
    expect(renderInline('\\*not italic\\*', help)).toBe('*not italic*')
  })
})

describe('escaping hostile Markdown', () => {
  it('shows raw HTML as text', () => {
    expect(html('<script>alert(1)</script>')).toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>')
    expect(html('<img src=x onerror="alert(1)">')).not.toContain('<img')
  })

  it('never links javascript: or any address outside pigeon://', () => {
    const anything = (href: string) => href
    expect(renderInline('[click](javascript:alert(1))', anything)).toBe('click')
    expect(renderInline('[click](JavaScript:alert(1))', anything)).toBe('click')
    expect(renderInline('[click](https://example.com)', anything)).toBe('click')
    expect(renderInline('[click](data:text/html,x)', anything)).toBe('click')
  })

  it('refuses a pigeon:// address that would break out of its attribute', () => {
    expect(renderInline('[x](protocol.md)', () => 'pigeon://help/" onclick="x')).toBe('x')
  })

  it('escapes quotes and markup in link text', () => {
    expect(renderInline('[a" onmouseover="x <b>](protocol.md)', help)).toBe(
      '<a href="pigeon://help/protocol/">a&quot; onmouseover=&quot;x &lt;b&gt;</a>',
    )
  })

  it('escapes headings, list items, table cells and code', () => {
    const out = html(
      [
        '## <i>head</i>',
        '- <b>item</b>',
        '| <x> |',
        '| --- |',
        "| 'q' |",
        '```',
        '</pre><script>',
        '```',
      ].join('\n'),
    )
    expect(out).not.toMatch(/<(?:i|x|script)>|<\/pre><script/)
    expect(out).toContain('&lt;i&gt;head&lt;/i&gt;')
    expect(out).toContain('&#39;q&#39;')
    expect(out).toContain('<pre>&lt;/pre&gt;&lt;script&gt;</pre>')
  })

  it('escapes every special character', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;')
  })
})

describe('markdownToHtml', () => {
  it('leaves out Mermaid with a note', () => {
    expect(html('```mermaid\nflowchart LR\n  a --> b\n```')).toBe(`<p><i>[${DIAGRAM_NOTE}]</i></p>`)
  })

  it('renders lists and tables as HTML 4', () => {
    expect(html('2. b\n3. c')).toBe('<ol start="2">\n<li>b</li>\n<li>c</li>\n</ol>')
    expect(html('| a |\n| -: |\n| 1 |')).toBe(
      '<table border="1" cellpadding="4" cellspacing="0">\n<tr><th align="right" valign="top">a</th></tr>\n<tr><td align="right" valign="top">1</td></tr>\n</table>',
    )
  })
})
