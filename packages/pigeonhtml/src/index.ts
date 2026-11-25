// PigeonHTML: the 2000s-only subset pages may use (docs/pigeonhtml.md).
// Pages are parsed with parse5, walked against the allowlists in allowlists.ts, and written
// back out with only what's kept.

import { MAX_NODES, type Report, sanitizePass, TooManyNodes } from './sanitize.ts'
import type { PageUrls, Problem, Removed, Sanitized } from './types.ts'

export type { PageUrls, Problem, Removed, Sanitized } from './types.ts'

export const PIGEONHTML_VERSION = '1.0'

export const PAGE_BUDGET_BYTES = 100 * 1024

/** UTF-8 length, counted by code point. */
const utf8Bytes = (text: string) => {
  let bytes = 0
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4
  }
  return bytes
}

/** Later passes read URLs the first one already served, so they pass them through as they are. */
const servedUrls: PageUrls = { image: (src) => src, link: (href) => href }

/** Passes after the first, until the output reads back as itself. */
const MAX_SETTLING_PASSES = 4

/** What's returned for a page that can't be sanitized: nothing of it at all. */
const EMPTY_PAGE = '<html><head></head><body></body></html>'

/**
 * Dropping tags can leave markup the parser would rebuild differently (a <p> inside a <p> once
 * the element between them is gone), so the output is sanitized again until it reads back as
 * itself. What the later passes drop is reported too. Output that never settles isn't returned.
 */
function settle(html: string, report: Report): string | undefined {
  let current = html
  for (let pass = 0; pass < MAX_SETTLING_PASSES; pass++) {
    const again = sanitizePass(current, servedUrls, report, false).html
    if (again === current) return current
    current = again
  }
  return undefined
}

/**
 * The page with everything not on PigeonHTML's allowlists taken out. A page over the budget,
 * one that builds more than MAX_NODES elements, or one whose output never settles is not
 * parsed or not returned: its `html` is an empty page and `removed` says `#document`.
 */
export function sanitize(source: string, urls: PageUrls): Sanitized {
  const bytes = utf8Bytes(source)
  const removed: Removed[] = []
  const nothing = (): Sanitized => ({
    html: EMPTY_PAGE,
    title: undefined,
    bytes,
    removed: [{ what: 'element', name: '#document' }],
  })
  if (bytes > PAGE_BUDGET_BYTES) return nothing()
  try {
    const add: Report = (what) => removed.push(what)
    const first = sanitizePass(source, urls, add, false)
    const html = settle(first.html, add)
    if (html === undefined) return nothing()
    return { html, title: first.title, bytes, removed }
  } catch (error) {
    if (error instanceof TooManyNodes) return nothing()
    throw error
  }
}

const describe = (removed: Removed): string => {
  switch (removed.what) {
    case 'element':
      return `<${removed.name}> isn't PigeonHTML.`
    case 'attribute':
      return `The ${removed.name} attribute isn't PigeonHTML.`
    case 'property':
      return removed.name === 'selector'
        ? "This CSS selector isn't CSS 2.1."
        : removed.name.startsWith('@')
          ? `${removed.name} isn't PigeonHTML.`
          : `The CSS property ${removed.name} isn't PigeonHTML, or its value isn't CSS 2.1.`
    case 'url':
      return `This address can't be used: ${removed.name}`
    case 'comment':
      return 'A comment.'
  }
}

/**
 * Where a page strays from PigeonHTML; empty when it's valid. It reports what `sanitize` would
 * take out, apart from comments (widgets are comments) and URLs, which only the page's host
 * can judge, except for those that could run script.
 */
export function validate(source: string): readonly Problem[] {
  const bytes = utf8Bytes(source)
  // Over the budget, a page isn't parsed at all, so that's the one thing to say.
  if (bytes > PAGE_BUDGET_BYTES) {
    return [
      {
        line: 1,
        column: 1,
        message: `The page is ${Math.ceil(bytes / 1024)} KB, over the ${PAGE_BUDGET_BYTES / 1024} KB budget.`,
      },
    ]
  }
  const problems: Problem[] = []
  const add = (removed: Removed, line: number, column: number) => {
    if (removed.what !== 'comment') problems.push({ line, column, message: describe(removed) })
  }
  try {
    const first = sanitizePass(
      source,
      servedUrls,
      (removed, at) => add(removed, at?.line ?? 1, at?.column ?? 1),
      true,
    )
    // What only the settling passes find has no place in the source, so it's said at the top.
    const settled = settle(first.html, (removed) => add(removed, 1, 1))
    if (settled === undefined)
      problems.push({ line: 1, column: 1, message: "The page doesn't read back as itself." })
  } catch (error) {
    if (!(error instanceof TooManyNodes)) throw error
    return [
      {
        line: 1,
        column: 1,
        message: `The page builds more than ${MAX_NODES} elements; check for tags left open.`,
      },
    ]
  }
  return problems.sort((a, b) => a.line - b.line || a.column - b.column)
}
