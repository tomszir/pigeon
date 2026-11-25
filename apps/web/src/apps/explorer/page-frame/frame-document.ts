// The document a sanitized page is shown in (docs/pigeonhtml.md): no doctype, so
// quirks mode; a CSP that loads nothing but inline styles, the page's own images and the fonts
// below; and a base stylesheet that maps the era's font names to Pigeon's bundled clones.
import monoFont from '../../../fonts/vera-sans-mono.ttf?url'
import sansFont from '../../../fonts/wine-tahoma.ttf?url'
import { type PageView, viewStylesheet } from './view.ts'

/** Sans-serif families of the era, all drawn with the Wine Tahoma clone. */
const SANS_FAMILIES = ['Tahoma', 'Verdana', 'Arial', 'Helvetica', 'Geneva', 'Trebuchet MS']
/** Monospace families of the era, all drawn with Bitstream Vera Sans Mono. */
const MONO_FAMILIES = ['Courier New', 'Courier', 'Lucida Console', 'Monaco']

/** An absolute URL, or the `data:` scheme, as a CSP source for exactly that file. */
function source(url: string, base: string): string {
  if (url.startsWith('data:')) return 'data:'
  const absolute = new URL(url, base)
  return `${absolute.origin}${absolute.pathname}`
}

const sources = (urls: readonly string[], base: string): string => {
  const unique = [...new Set(urls.map((url) => source(url, base)))]
  return unique.length === 0 ? "'none'" : unique.join(' ')
}

/** The page may load its own images and the two fonts, and nothing else; no scripts at all. */
export function contentSecurityPolicy(imageUrls: readonly string[], base: string): string {
  return [
    "default-src 'none'",
    `img-src ${sources(imageUrls, base)}`,
    "style-src 'unsafe-inline'",
    `font-src ${sources([sansFont, monoFont], base)}`,
  ].join('; ')
}

const face = (family: string, url: string) =>
  `@font-face{font-family:"${family}";src:url("${url}") format("truetype")}`

/** Lowest in the cascade, so anything the page says wins. */
export const BASE_STYLESHEET = [
  ...SANS_FAMILIES.map((family) => face(family, sansFont)),
  ...MONO_FAMILIES.map((family) => face(family, monoFont)),
  'html{font-family:"Tahoma"}',
  'pre,tt,code,kbd,samp,xmp,listing,plaintext{font-family:"Courier New"}',
  'img{image-rendering:pixelated}',
  // Modern engines dropped <blink>; PigeonHTML keeps it (docs/pigeonhtml.md).
  'blink{animation:pg-blink 1s steps(1) infinite}',
  '@keyframes pg-blink{50%{visibility:hidden}}',
  '@media (prefers-reduced-motion:reduce){blink{animation:none}}',
].join('\n')

const escapeAttribute = (text: string) => text.replaceAll('&', '&amp;').replaceAll('"', '&quot;')

/**
 * What's written into the frame. The policy, the base styles and the view's styles come first,
 * so the parser puts them in the head before anything the page holds and the policy covers every
 * image it loads. No doctype.
 */
export function frameDocument(
  html: string,
  imageUrls: readonly string[],
  base: string,
  view?: { readonly view: PageView; readonly phone: boolean },
): string {
  const policy = escapeAttribute(contentSecurityPolicy(imageUrls, base))
  const viewed = view === undefined ? '' : viewStylesheet(view.view, view.phone)
  const viewStyle = viewed === '' ? '' : `<style>${viewed}</style>`
  return `<meta http-equiv="Content-Security-Policy" content="${policy}"><style>${BASE_STYLESHEET}</style>${viewStyle}${html}`
}
