// A small Markdown-to-PigeonHTML converter for the subset docs/ uses (decision 0032): headings,
// paragraphs, bullet and numbered lists, tables, links, bold, italic, inline code and fenced
// blocks. Everything taken from the Markdown is escaped; raw HTML in it shows as text.

export type Align = 'left' | 'center' | 'right' | undefined

export type Block =
  | { readonly kind: 'heading'; readonly level: number; readonly text: string }
  | { readonly kind: 'paragraph'; readonly text: string }
  | {
      readonly kind: 'list'
      readonly ordered: boolean
      readonly start: number
      readonly items: readonly string[]
    }
  | {
      readonly kind: 'table'
      readonly head: readonly string[]
      readonly align: readonly Align[]
      readonly rows: readonly (readonly string[])[]
    }
  | { readonly kind: 'code'; readonly lang: string; readonly text: string }

/** Where a link to `href` goes, or undefined to show the link's text alone. */
export type LinkTo = (href: string) => string | undefined

const ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

/** Text made safe for an element's content or a quoted attribute. */
export const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c)

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([\w-]*)/
const HEADING = /^ {0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/
const ITEM = /^\s*(?:([-*+])|(\d{1,9})[.)])\s+(.*)$/
const TABLE_RULE = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/

const isTableStart = (lines: readonly string[], i: number) =>
  (lines[i] ?? '').trimStart().startsWith('|') && TABLE_RULE.test(lines[i + 1] ?? '')

const startsBlock = (lines: readonly string[], i: number) => {
  const line = lines[i] ?? ''
  return FENCE.test(line) || HEADING.test(line) || ITEM.test(line) || isTableStart(lines, i)
}

/** A table row's cells, split on pipes outside inline code; `\|` is a literal pipe. */
const splitRow = (line: string) => {
  let row = line.trim()
  if (row.startsWith('|')) row = row.slice(1)
  if (row.endsWith('|') && !row.endsWith('\\|')) row = row.slice(0, -1)
  const cells: string[] = []
  let cell = ''
  let inCode = false
  for (let i = 0; i < row.length; i++) {
    const c = row[i]
    if (c === '\\' && row[i + 1] === '|') {
      cell += '|'
      i++
    } else if (c === '`') {
      inCode = !inCode
      cell += c
    } else if (c === '|' && !inCode) {
      cells.push(cell.trim())
      cell = ''
    } else {
      cell += c
    }
  }
  cells.push(cell.trim())
  return cells
}

const alignOf = (rule: string): Align => {
  const r = rule.trim()
  if (r.startsWith(':') && r.endsWith(':')) return 'center'
  if (r.endsWith(':')) return 'right'
  if (r.startsWith(':')) return 'left'
  return undefined
}

/** The Markdown's blocks, in order. */
export function parseBlocks(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  const blocks: Block[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i] ?? ''
    if (line.trim() === '') {
      i++
      continue
    }
    const fence = FENCE.exec(line)
    if (fence) {
      const marker = fence[1] ?? '```'
      const body: string[] = []
      i++
      while (i < lines.length) {
        const l = lines[i] ?? ''
        const close = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(l)?.[1]
        if (close !== undefined && close[0] === marker[0] && close.length >= marker.length) break
        body.push(l)
        i++
      }
      i++
      blocks.push({ kind: 'code', lang: (fence[2] ?? '').toLowerCase(), text: body.join('\n') })
      continue
    }
    const heading = HEADING.exec(line)
    if (heading) {
      blocks.push({ kind: 'heading', level: heading[1]?.length ?? 1, text: heading[2] ?? '' })
      i++
      continue
    }
    if (isTableStart(lines, i)) {
      const head = splitRow(line)
      const align = splitRow(lines[i + 1] ?? '').map(alignOf)
      const rows: string[][] = []
      i += 2
      while (i < lines.length && (lines[i] ?? '').trimStart().startsWith('|')) {
        rows.push(splitRow(lines[i] ?? ''))
        i++
      }
      blocks.push({ kind: 'table', head, align, rows })
      continue
    }
    const first = ITEM.exec(line)
    if (first) {
      const ordered = first[2] !== undefined
      const items: string[] = []
      while (i < lines.length) {
        const l = lines[i] ?? ''
        const item = ITEM.exec(l)
        if (item && (item[2] !== undefined) === ordered) {
          items.push(item[3] ?? '')
          i++
        } else if (item) {
          break
        } else if (l.trim() === '') {
          // A blank line ends the list unless another item of the same kind follows it.
          const next = ITEM.exec(lines[i + 1] ?? '')
          if (next && (next[2] !== undefined) === ordered) i++
          else break
        } else if (startsBlock(lines, i)) {
          break
        } else {
          items[items.length - 1] = `${items[items.length - 1] ?? ''} ${l.trim()}`
          i++
        }
      }
      blocks.push({ kind: 'list', ordered, start: Number(first[2] ?? 1), items })
      continue
    }
    const text: string[] = []
    while (i < lines.length && (lines[i] ?? '').trim() !== '' && !startsBlock(lines, i)) {
      text.push((lines[i] ?? '').trim())
      i++
    }
    blocks.push({ kind: 'paragraph', text: text.join(' ') })
  }
  return blocks
}

const PUNCTUATION = /[!-/:-@[-`{-~]/
const WORD = /[\p{L}\p{N}]/u

/** Where the bracket or parenthesis opened at `open` closes, or -1. */
const closing = (text: string, open: number, left: string, right: string) => {
  let depth = 0
  for (let i = open; i < text.length; i++) {
    const c = text[i]
    if (c === '\\') i++
    else if (c === left) depth++
    else if (c === right && --depth === 0) return i
  }
  return -1
}

/** A link's destination: `<...>` unwrapped and any `"title"` after it dropped. */
const destination = (raw: string) => {
  const d = raw.trim()
  if (d.startsWith('<')) return d.slice(1, d.indexOf('>') > 0 ? d.indexOf('>') : undefined)
  return d.split(/\s+/)[0] ?? ''
}

/**
 * Help links only stay inside Pigeon: whatever `linkTo` returns, an address that isn't
 * pigeon:// is shown as text.
 */
const safeTarget = (target: string | undefined) =>
  target !== undefined && /^pigeon:\/\/[^\s"'<>]*$/i.test(target) ? target : undefined

/** One line of Markdown's inline syntax as PigeonHTML. */
export function renderInline(text: string, linkTo: LinkTo, inLink = false): string {
  let out = ''
  let i = 0
  while (i < text.length) {
    const c = text[i] ?? ''
    if (c === '\\' && PUNCTUATION.test(text[i + 1] ?? '')) {
      out += escapeHtml(text[i + 1] ?? '')
      i += 2
      continue
    }
    if (c === '`') {
      let run = 1
      while (text[i + run] === '`') run++
      const ticks = '`'.repeat(run)
      let end = text.indexOf(ticks, i + run)
      while (end !== -1 && text[end + run] === '`') end = text.indexOf(ticks, end + run + 1)
      if (end === -1) {
        out += escapeHtml(ticks)
        i += run
        continue
      }
      let code = text.slice(i + run, end)
      if (code.length > 2 && code.startsWith(' ') && code.endsWith(' ')) code = code.slice(1, -1)
      out += `<code>${escapeHtml(code)}</code>`
      i = end + run
      continue
    }
    if (c === '[' && !inLink) {
      const close = closing(text, i, '[', ']')
      if (close !== -1 && text[close + 1] === '(') {
        const end = closing(text, close + 1, '(', ')')
        if (end !== -1) {
          const label = renderInline(text.slice(i + 1, close), linkTo, true)
          const target = safeTarget(linkTo(destination(text.slice(close + 2, end))))
          out += target === undefined ? label : `<a href="${escapeHtml(target)}">${label}</a>`
          i = end + 1
          continue
        }
      }
    }
    if ((c === '*' || c === '_') && text[i + 1] === c) {
      const end = text.indexOf(c + c, i + 2)
      if (end > i + 2 && text[i + 2] !== ' ') {
        out += `<b>${renderInline(text.slice(i + 2, end), linkTo, inLink)}</b>`
        i = end + 2
        continue
      }
    }
    if (c === '*' || c === '_') {
      const opens = text[i + 1] !== undefined && text[i + 1] !== ' ' && text[i + 1] !== c
      const wordBefore = c === '_' && WORD.test(text[i - 1] ?? '')
      if (opens && !wordBefore) {
        let end = text.indexOf(c, i + 1)
        while (
          end !== -1 &&
          (text[end - 1] === ' ' ||
            text[end + 1] === c ||
            (c === '_' && WORD.test(text[end + 1] ?? '')))
        ) {
          end = text.indexOf(c, end + 1)
        }
        if (end !== -1) {
          out += `<i>${renderInline(text.slice(i + 1, end), linkTo, inLink)}</i>`
          i = end + 1
          continue
        }
      }
    }
    out += escapeHtml(c)
    i++
  }
  return out
}

/** What the source docs say in place of a Mermaid diagram, which PigeonHTML can't draw. */
export const DIAGRAM_NOTE = 'A diagram is drawn here in the source docs, for a newer browser.'

const ALIGN_ATTR = (align: Align) => (align === undefined ? '' : ` align="${align}"`)

/** One block as PigeonHTML. Headings come out as plain `<hN>`; callers may number their own. */
export function renderBlock(block: Block, linkTo: LinkTo): string {
  switch (block.kind) {
    case 'heading': {
      const level = Math.min(Math.max(block.level, 1), 6)
      return `<h${level}>${renderInline(block.text, linkTo)}</h${level}>`
    }
    case 'paragraph':
      return `<p>${renderInline(block.text, linkTo)}</p>`
    case 'list': {
      const items = block.items.map((item) => `<li>${renderInline(item, linkTo)}</li>`).join('\n')
      if (!block.ordered) return `<ul>\n${items}\n</ul>`
      const start = block.start === 1 ? '' : ` start="${block.start}"`
      return `<ol${start}>\n${items}\n</ol>`
    }
    case 'table': {
      const cell = (tag: 'th' | 'td', text: string, col: number) =>
        `<${tag}${ALIGN_ATTR(block.align[col])} valign="top">${renderInline(text, linkTo)}</${tag}>`
      const head = `<tr>${block.head.map((text, col) => cell('th', text, col)).join('')}</tr>`
      const rows = block.rows.map(
        (row) => `<tr>${block.head.map((_, col) => cell('td', row[col] ?? '', col)).join('')}</tr>`,
      )
      return `<table border="1" cellpadding="4" cellspacing="0">\n${[head, ...rows].join('\n')}\n</table>`
    }
    case 'code':
      if (block.lang === 'mermaid') return `<p><i>[${escapeHtml(DIAGRAM_NOTE)}]</i></p>`
      return `<pre>${escapeHtml(block.text)}</pre>`
  }
}

/** Markdown as PigeonHTML, block by block. */
export const markdownToHtml = (markdown: string, linkTo: LinkTo) =>
  parseBlocks(markdown)
    .map((block) => renderBlock(block, linkTo))
    .join('\n')
