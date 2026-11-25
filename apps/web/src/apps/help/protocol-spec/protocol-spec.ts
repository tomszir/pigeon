// "The Pigeon Protocol": an RFC-style spec made from docs/ each build, so it can't drift from
// them. docs/protocol.md gives the numbered sections, docs/flows.md and
// docs/glossary.md the appendices, one page per `##` section.

import flowsMarkdown from '../../../../../../docs/flows.md?raw'
import glossaryMarkdown from '../../../../../../docs/glossary.md?raw'
import protocolMarkdown from '../../../../../../docs/protocol.md?raw'
import {
  type Block,
  escapeHtml,
  parseBlocks,
  renderBlock,
  renderInline,
} from '../markdown/markdown.ts'
import { HELP_HOME, type HelpPage, helpDocument } from '../page/page.ts'

export const PROTOCOL_HOME = `${HELP_HOME}protocol/`

const SPEC_TITLE = 'The Pigeon Protocol'

/** A doc shown in the spec: its file name in docs/ and its Markdown. */
export interface SpecSource {
  readonly file: string
  readonly markdown: string
}

/** The first source is the spec's body; the rest are its appendices, in order. */
export const SPEC_SOURCES: readonly SpecSource[] = [
  { file: 'protocol.md', markdown: protocolMarkdown },
  { file: 'flows.md', markdown: flowsMarkdown },
  { file: 'glossary.md', markdown: glossaryMarkdown },
]

/** One line of the spec's table of contents. */
export interface SpecEntry {
  /** "4", "A.2" or "Appendix B". */
  readonly number: string
  readonly title: string
  readonly address: string
  /** 1 for a section, 0 for an appendix's own line in the contents. */
  readonly depth: 0 | 1
}

export interface Spec {
  readonly pages: ReadonlyMap<string, HelpPage>
  readonly contents: readonly SpecEntry[]
}

/** Markdown's inline syntax taken out, for a title. */
export const plainText = (markdown: string) =>
  markdown
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(^|\W)[*_]([^*_]+)[*_](?=\W|$)/g, '$1$2')

/** GitHub's anchor for a heading, which docs/ links to: `pigeon:// addresses` is `pigeon-addresses`. */
export const anchorOf = (heading: string) =>
  plainText(heading)
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-')

interface Section {
  readonly heading: string
  readonly blocks: readonly Block[]
}

interface ParsedDoc {
  readonly file: string
  readonly title: string
  readonly intro: readonly Block[]
  readonly sections: readonly Section[]
}

const parseDoc = (source: SpecSource): ParsedDoc => {
  const blocks = parseBlocks(source.markdown)
  let title = source.file
  const intro: Block[] = []
  const sections: { heading: string; blocks: Block[] }[] = []
  for (const block of blocks) {
    if (block.kind === 'heading' && block.level === 1) title = block.text
    else if (block.kind === 'heading' && block.level === 2)
      sections.push({ heading: block.text, blocks: [] })
    else (sections.at(-1)?.blocks ?? intro).push(block)
  }
  return { file: source.file, title, intro, sections }
}

/** The 72-column header every RFC page carries. */
const header = (right2: string) => {
  const line = (left: string, right: string) =>
    `${left}${' '.repeat(Math.max(1, 72 - left.length - right.length))}${right}`
  return `<pre class="head">${escapeHtml(
    [
      line('Pigeon Working Group', SPEC_TITLE),
      line('Pigeon Note: 1', right2),
      line('Category: Informational', 'Made from docs/ when built'),
    ].join('\n'),
  )}</pre>`
}

const STYLE = `
body { margin: 16px; background-color: #ffffff; color: #000000; }
body, p, li, td, th, pre, code, tt { font-family: "Courier New", Courier, monospace; font-size: 13px; }
h1 { font-size: 13px; font-weight: bold; text-align: center; margin: 24px 0 24px 0; }
h2, h3, h4 { font-size: 13px; font-weight: bold; margin: 24px 0 10px 0; }
p { margin: 0 0 10px 24px; line-height: 1.35; }
ul, ol { margin: 0 0 10px 24px; padding-left: 24px; }
li { margin-bottom: 4px; line-height: 1.35; }
pre { margin: 0 0 12px 24px; line-height: 1.2; }
pre.head { margin: 0; }
table { margin: 0 0 12px 24px; border-collapse: collapse; }
th { background-color: #eeeeee; text-align: left; }
.nav { margin: 0; }
.nav td { font-size: 12px; }
`

const BODY = 'bgcolor="#ffffff" text="#000000" link="#0000ee" vlink="#551a8b" alink="#ff0000"'

const link = (address: string, text: string) =>
  `<a href="${escapeHtml(address)}">${escapeHtml(text)}</a>`

const specPage = (title: string, right2: string, body: string, nav: string) =>
  helpDocument({
    title,
    style: STYLE,
    bodyAttributes: BODY,
    body: [
      '<table width="680" cellpadding="0" cellspacing="0" border="0"><tr><td>',
      header(right2),
      body,
      '<hr noshade size="1">',
      nav,
      '</td></tr></table>',
    ].join('\n'),
  })

/** Builds the spec's pages, and its contents, from the docs it's given. */
export function buildSpec(sources: readonly SpecSource[]): Spec {
  const docs = sources.map(parseDoc)
  const base = (file: string) => file.replace(/\.md$/, '')

  // Number every section and give it an address, before rendering, so links can find them.
  interface Placed {
    readonly doc: ParsedDoc
    readonly appendix: string | undefined
    readonly number: string
    readonly section: Section | undefined
    readonly address: string
  }
  const placed: Placed[] = []
  const contents: SpecEntry[] = []
  /** For each doc, the address of each anchor, and '' for the doc itself. */
  const anchors = new Map<string, Map<string, string>>()
  docs.forEach((doc, d) => {
    const own = new Map<string, string>()
    anchors.set(doc.file, own)
    if (d === 0) {
      own.set('', PROTOCOL_HOME)
      doc.sections.forEach((section, s) => {
        const address = `${PROTOCOL_HOME}${anchorOf(section.heading)}`
        own.set(anchorOf(section.heading), address)
        placed.push({ doc, appendix: undefined, number: `${s + 1}`, section, address })
        contents.push({
          number: `${s + 1}`,
          title: plainText(section.heading),
          address,
          depth: 1,
        })
      })
      return
    }
    const letter = String.fromCharCode(64 + d)
    const appendix = `Appendix ${letter}`
    if (doc.sections.length === 0) {
      const address = `${PROTOCOL_HOME}${base(doc.file)}`
      own.set('', address)
      placed.push({ doc, appendix, number: appendix, section: undefined, address })
      contents.push({ number: appendix, title: plainText(doc.title), address, depth: 0 })
      return
    }
    doc.sections.forEach((section, s) => {
      const address = `${PROTOCOL_HOME}${base(doc.file)}/${anchorOf(section.heading)}`
      if (s === 0) {
        own.set('', address)
        contents.push({ number: appendix, title: plainText(doc.title), address, depth: 0 })
      }
      own.set(anchorOf(section.heading), address)
      placed.push({ doc, appendix, number: `${letter}.${s + 1}`, section, address })
      contents.push({
        number: `${letter}.${s + 1}`,
        title: plainText(section.heading),
        address,
        depth: 1,
      })
    })
  })

  /**
   * Where a link in `from` goes: a doc shown in the spec goes to its page, and anything else
   * (other docs, the web) is shown as text.
   */
  const linkTo =
    (from: string) =>
    (href: string): string | undefined => {
      if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return undefined
      const [path = '', anchor = ''] = href.replace(/^\.\//, '').split('#')
      const doc = anchors.get(path === '' ? from : path)
      if (doc === undefined) return undefined
      return doc.get(anchor.toLowerCase()) ?? doc.get('')
    }

  const blocksHtml = (blocks: readonly Block[], file: string, number: string) => {
    let sub = 0
    return blocks
      .map((block) => {
        if (block.kind === 'heading' && block.level === 3) {
          sub++
          return `<h3>${escapeHtml(`${number}.${sub}.`)}&nbsp;&nbsp;${renderInline(block.text, linkTo(file))}</h3>`
        }
        if (block.kind === 'heading') return `<h4>${renderInline(block.text, linkTo(file))}</h4>`
        return renderBlock(block, linkTo(file))
      })
      .join('\n')
  }

  const nav = (i: number) => {
    const prev = i === 0 ? undefined : placed[i - 1]
    const next = placed[i + 1]
    const name = (p: Placed) => `${p.number}. ${plainText(p.section?.heading ?? p.doc.title)}`
    return [
      '<table class="nav" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>',
      `<td align="left" width="40%">${prev ? link(prev.address, `<< ${name(prev)}`) : link(PROTOCOL_HOME, '<< Contents')}</td>`,
      `<td align="center" width="20%">${link(PROTOCOL_HOME, 'Contents')}</td>`,
      `<td align="right" width="40%">${next ? link(next.address, `${name(next)} >>`) : link(HELP_HOME, 'Help >>')}</td>`,
      '</tr></table>',
    ].join('\n')
  }

  const pages = new Map<string, HelpPage>()

  // The contents page: the memo's status, protocol.md's opening as the abstract, the contents.
  const main = docs[0]
  const toc = contents
    .map((entry) => {
      // Appendix sections (A.1) sit under their appendix's line; body sections don't.
      const indent = entry.number.includes('.') ? '      ' : '   '
      const number = `${entry.number}.`.padEnd(entry.depth === 0 ? 14 : 6)
      return `${indent}${escapeHtml(number)}${link(entry.address, entry.title)}`
    })
    .join('\n')
  pages.set(
    PROTOCOL_HOME,
    specPage(
      SPEC_TITLE,
      'Contents',
      [
        `<h1>${escapeHtml(SPEC_TITLE)}</h1>`,
        '<h2>Status of This Memo</h2>',
        "<p>This memo says how Pigeon talks to other Pigeons: how a peer is known, how friends find each other, and what they send. It is put together from Pigeon's own notes every time Pigeon is built, so it always says what this copy of Pigeon does. Distribution of this memo is unlimited.</p>",
        '<h2>Abstract</h2>',
        main ? blocksHtml(main.intro, main.file, '0') : '',
        '<h2>Table of Contents</h2>',
        `<pre>${toc}</pre>`,
        `<p>${link(HELP_HOME, 'Back to Help')}</p>`,
      ].join('\n'),
      `<table class="nav" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="left">${link(HELP_HOME, '<< Help')}</td><td align="right">${placed[0] ? link(placed[0].address, `${placed[0].number}. ${plainText(placed[0].section?.heading ?? '')} >>`) : ''}</td></tr></table>`,
    ),
  )

  placed.forEach((p, i) => {
    const heading = p.section?.heading ?? p.doc.title
    const lead =
      p.appendix !== undefined && (p.section === undefined || p.number.endsWith('.1'))
        ? [
            `<h2>${escapeHtml(`${p.appendix}.`)}&nbsp;&nbsp;${renderInline(p.doc.title, linkTo(p.doc.file))}</h2>`,
            blocksHtml(p.doc.intro, p.doc.file, p.number),
          ].join('\n')
        : ''
    const own =
      p.section === undefined
        ? ''
        : [
            `<h2>${escapeHtml(`${p.number}.`)}&nbsp;&nbsp;${renderInline(heading, linkTo(p.doc.file))}</h2>`,
            blocksHtml(p.section.blocks, p.doc.file, p.number),
          ].join('\n')
    pages.set(
      p.address,
      specPage(
        `${p.number}. ${plainText(heading)} - ${SPEC_TITLE}`,
        p.appendix === undefined ? `Section ${p.number}` : p.appendix,
        [lead, own].filter((part) => part !== '').join('\n'),
        nav(i),
      ),
    )
  })

  return { pages, contents }
}

/** The spec made from the real docs. */
export const PROTOCOL_SPEC: Spec = buildSpec(SPEC_SOURCES)
