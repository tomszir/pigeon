import { describe, expect, it } from 'vitest'
import { DIAGRAM_NOTE } from '../markdown/markdown.ts'
import { anchorOf, buildSpec, PROTOCOL_HOME, PROTOCOL_SPEC, SPEC_SOURCES } from './protocol-spec.ts'

const sources = [
  {
    file: 'protocol.md',
    markdown: [
      '# Protocol',
      '',
      'The opening, see [Rooms](#rooms).',
      '',
      '## Identity',
      '',
      'Keys. See [rooms](protocol.md#rooms), [flows](flows.md), [design](design.md) and [stack](stack.md).',
      '',
      '### Fingerprints',
      '',
      'Sixteen.',
      '',
      '## Rooms',
      '',
      '```mermaid',
      'graph',
      '```',
    ].join('\n'),
  },
  { file: 'flows.md', markdown: '# Flows\n\nDrawn.\n\n## One\n\n```text\n a --> b\n```\n' },
  { file: 'glossary.md', markdown: '# Glossary\n\nWords.\n\n- **Buzz**: shaking.\n' },
]

describe('buildSpec', () => {
  const spec = buildSpec(sources)
  const page = (address: string) => spec.pages.get(address)?.source ?? ''

  it('numbers sections and appendices, one page per ## section', () => {
    expect(spec.contents).toEqual([
      { number: '1', title: 'Identity', address: `${PROTOCOL_HOME}identity`, depth: 1 },
      { number: '2', title: 'Rooms', address: `${PROTOCOL_HOME}rooms`, depth: 1 },
      { number: 'Appendix A', title: 'Flows', address: `${PROTOCOL_HOME}flows/one`, depth: 0 },
      { number: 'A.1', title: 'One', address: `${PROTOCOL_HOME}flows/one`, depth: 1 },
      { number: 'Appendix B', title: 'Glossary', address: `${PROTOCOL_HOME}glossary`, depth: 0 },
    ])
    expect([...spec.pages.keys()]).toEqual([
      PROTOCOL_HOME,
      `${PROTOCOL_HOME}identity`,
      `${PROTOCOL_HOME}rooms`,
      `${PROTOCOL_HOME}flows/one`,
      `${PROTOCOL_HOME}glossary`,
    ])
    expect(page(`${PROTOCOL_HOME}identity`)).toContain('<h2>1.&nbsp;&nbsp;Identity</h2>')
    expect(page(`${PROTOCOL_HOME}identity`)).toContain('<h3>1.1.&nbsp;&nbsp;Fingerprints</h3>')
    expect(spec.pages.get(`${PROTOCOL_HOME}rooms`)?.title).toBe('2. Rooms - The Pigeon Protocol')
  })

  it("puts protocol.md's opening on the contents page as the abstract", () => {
    expect(page(PROTOCOL_HOME)).toContain(
      `<p>The opening, see <a href="${PROTOCOL_HOME}rooms">Rooms</a>.</p>`,
    )
  })

  it('maps links to docs in Help to their pages and shows the rest as text', () => {
    expect(page(`${PROTOCOL_HOME}identity`)).toContain(
      `See <a href="${PROTOCOL_HOME}rooms">rooms</a>, <a href="${PROTOCOL_HOME}flows/one">flows</a>, design and stack.`,
    )
  })

  it("opens an appendix with its doc's heading and opening", () => {
    expect(page(`${PROTOCOL_HOME}flows/one`)).toMatch(
      /Appendix A\.&nbsp;&nbsp;Flows<\/h2>\n<p>Drawn\.<\/p>\n<h2>A\.1\.&nbsp;&nbsp;One<\/h2>\n<pre> a --&gt; b<\/pre>/,
    )
    expect(page(`${PROTOCOL_HOME}glossary`)).toContain('<li><b>Buzz</b>: shaking.</li>')
  })

  it('leaves Mermaid out with a note', () => {
    expect(page(`${PROTOCOL_HOME}rooms`)).toContain(DIAGRAM_NOTE)
    expect(page(`${PROTOCOL_HOME}rooms`)).not.toContain('graph')
  })
})

describe('PROTOCOL_SPEC', () => {
  it('has a page for every ## section of the real docs', () => {
    const headings = SPEC_SOURCES.flatMap((source) =>
      [...source.markdown.matchAll(/^## (.+)$/gm)].map((match) => anchorOf(match[1] ?? '')),
    )
    expect(headings.length).toBeGreaterThan(10)
    for (const anchor of headings) {
      expect([...PROTOCOL_SPEC.pages.keys()].some((key) => key.endsWith(`/${anchor}`))).toBe(true)
    }
  })

  it('names sections the way GitHub anchors them', () => {
    expect(anchorOf('pigeon:// addresses')).toBe('pigeon-addresses')
    expect(anchorOf('Your data in a file')).toBe('your-data-in-a-file')
  })

  it('carries the ASCII flows as preformatted text', () => {
    expect(PROTOCOL_SPEC.pages.get(`${PROTOCOL_HOME}flows/invite-handshake`)?.source).toContain(
      'pair-accept { secret, 52 base32 chars } -------&gt;|',
    )
  })
})
