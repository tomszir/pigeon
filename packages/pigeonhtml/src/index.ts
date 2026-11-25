// PigeonHTML: the 2000s-only subset pages may use (docs/pigeonhtml.md, decisions 0004 and 0032).
// The allowlists, parse5 and the real sanitizer land in M17's sanitizer change. Until then
// `sanitize` keeps only the page's text, so nothing that calls it can render more than that.

export const PIGEONHTML_VERSION = '1.0'

export const PAGE_BUDGET_BYTES = 100 * 1024

/** What a page may load or link to, decided by whoever shows it. */
export interface PageUrls {
  /** The URL to serve an image the page names from, or undefined to drop the image. */
  readonly image: (src: string) => string | undefined
  /** The address a link goes to, or undefined to drop the link and keep its text. */
  readonly link: (href: string) => string | undefined
}

/** Something the sanitizer took out. */
export interface Removed {
  readonly what: 'element' | 'attribute' | 'property' | 'url' | 'comment'
  /** The element, attribute or CSS property's name, or the URL. */
  readonly name: string
}

export interface Sanitized {
  /** The page as it may be rendered: no doctype, only what the allowlists keep. */
  readonly html: string
  /** The page's `<title>`, as text. */
  readonly title: string | undefined
  /** The source's size in UTF-8 bytes, to hold against PAGE_BUDGET_BYTES. */
  readonly bytes: number
  readonly removed: readonly Removed[]
}

/** Something in a page that isn't PigeonHTML, where it starts in the source (1-based). */
export interface Problem {
  readonly line: number
  readonly column: number
  readonly message: string
}

/** UTF-8 length, counted by code point. */
const utf8Bytes = (text: string) => {
  let bytes = 0
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4
  }
  return bytes
}

const escapeText = (text: string) =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

/** The page with everything not on PigeonHTML's allowlists taken out. */
export function sanitize(source: string, _urls: PageUrls): Sanitized {
  const text = source
    .replace(/<[^>]*>?/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return {
    html: escapeText(text),
    title: undefined,
    bytes: utf8Bytes(source),
    removed: [],
  }
}

/** Where a page strays from PigeonHTML; empty when it's valid. */
export function validate(_source: string): readonly Problem[] {
  return [{ line: 1, column: 1, message: "PigeonHTML's checks aren't built yet." }]
}
