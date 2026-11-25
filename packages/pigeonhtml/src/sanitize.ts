// The sanitizer's one pass: parse with parse5, walk the tree against the allowlists, and write
// out only what's kept. Output is built from the tree, never copied from the source, with
// every text and attribute escaped.

import {
  type DefaultTreeAdapterMap,
  type DefaultTreeAdapterTypes,
  defaultTreeAdapter,
  html as htmlSpec,
  parse,
  type TreeAdapter,
} from 'parse5'
import {
  BODY_ATTRIBUTES,
  DROPPED_WITH_CONTENT,
  ELEMENTS,
  GLOBAL_ATTRIBUTES,
  IMAGE_ATTRIBUTES,
  LINK_ATTRIBUTES,
  VOID_ELEMENTS,
} from './allowlists.ts'
import { sanitizeDeclarations, sanitizeStylesheet } from './css.ts'
import type { PageUrls, Removed } from './types.ts'
import { isSafeUrl } from './urls.ts'

type Element = DefaultTreeAdapterTypes.Element
type ChildNode = DefaultTreeAdapterTypes.ChildNode
type TextNode = DefaultTreeAdapterTypes.TextNode

/** Where something starts in the source, 1-based, when the parse kept locations. */
export interface Position {
  readonly line: number
  readonly column: number
}

export type Report = (removed: Removed, at: Position | undefined) => void

export interface Pass {
  readonly html: string
  readonly title: string | undefined
}

const HTML_NS = htmlSpec.NS.HTML

/**
 * How deep elements may nest before what's below is dropped, so a page can't exhaust the
 * stack. Browsers stop nesting at about 512, and no page of the time came near this.
 */
export const MAX_DEPTH = 256

/**
 * How many elements and comments one parse may make. A page within the 100 KB budget can't
 * honestly hold more than about 35,000 elements, but misnested tags make the parser rebuild
 * open formatting elements over and over, so a small page could build millions.
 */
export const MAX_NODES = 50_000

/** The page builds more nodes than MAX_NODES: it isn't sanitized at all. */
export class TooManyNodes extends Error {
  constructor() {
    super(`a page may build at most ${MAX_NODES} elements`)
  }
}

/** parse5's own tree, counting what it makes and stopping past MAX_NODES. */
function countingAdapter(): TreeAdapter<DefaultTreeAdapterMap> {
  let made = 0
  const count = () => {
    if (++made > MAX_NODES) throw new TooManyNodes()
  }
  return {
    ...defaultTreeAdapter,
    createElement: (tagName, namespaceURI, attrs) => {
      count()
      return defaultTreeAdapter.createElement(tagName, namespaceURI, attrs)
    },
    createCommentNode: (data) => {
      count()
      return defaultTreeAdapter.createCommentNode(data)
    },
  }
}

const escapeText = (text: string) =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

const escapeAttribute = (text: string) => escapeText(text).replaceAll('"', '&quot;')

const isElement = (node: ChildNode): node is Element => 'tagName' in node

const isText = (node: ChildNode): node is TextNode => node.nodeName === '#text'

const textOf = (element: Element) =>
  element.childNodes
    .filter(isText)
    .map((node) => node.value)
    .join('')

/** A map's name, as `usemap` may point to it. */
const fragmentRef = /^#[A-Za-z0-9_.:-]+$/

/** Where each line of a text node's value starts, worked out once per node. */
const lineStarts = new WeakMap<TextNode, readonly number[]>()

const startsOf = (node: TextNode): readonly number[] => {
  let starts = lineStarts.get(node)
  if (starts === undefined) {
    const found = [0]
    for (let i = node.value.indexOf('\n'); i !== -1; i = node.value.indexOf('\n', i + 1))
      found.push(i + 1)
    starts = found
    lineStarts.set(node, starts)
  }
  return starts
}

/** Where an offset into a text node's value falls in the source. */
function positionIn(node: TextNode | undefined, offset: number): Position | undefined {
  const start = node?.sourceCodeLocation
  if (node === undefined || start == null) return undefined
  const starts = startsOf(node)
  // The last line start at or before the offset.
  let low = 0
  let high = starts.length - 1
  while (low < high) {
    const mid = (low + high + 1) >> 1
    if ((starts[mid] ?? 0) <= offset) low = mid
    else high = mid - 1
  }
  const lineStart = starts[low] ?? 0
  return low === 0
    ? { line: start.startLine, column: start.startCol + offset }
    : { line: start.startLine + low, column: offset - lineStart + 1 }
}

const elementAt = (node: {
  readonly sourceCodeLocation?: { startLine: number; startCol: number } | null
}): Position | undefined => {
  const at = node.sourceCodeLocation
  return at == null ? undefined : { line: at.startLine, column: at.startCol }
}

const attributeAt = (element: Element, name: string): Position | undefined => {
  const at = element.sourceCodeLocation?.attrs?.[name]
  return at === undefined ? elementAt(element) : { line: at.startLine, column: at.startCol }
}

/** One sanitizing pass over a whole page. Throws TooManyNodes for a page that builds too much. */
export function sanitizePass(
  source: string,
  urls: PageUrls,
  report: Report,
  locations: boolean,
): Pass {
  const document = parse(source, {
    sourceCodeLocationInfo: locations,
    scriptingEnabled: false,
    treeAdapter: countingAdapter(),
  })
  let title: string | undefined
  let titleSeen = false

  const served = (kind: 'image' | 'link', url: string): string | undefined => {
    if (!isSafeUrl(url, kind)) return undefined
    const result = kind === 'image' ? urls.image(url) : urls.link(url)
    return result !== undefined && isSafeUrl(result, kind) ? result : undefined
  }

  const style = (element: Element): string => {
    const text = element.childNodes.find(isText)
    const css = sanitizeStylesheet(textOf(element), {
      image: (src) => served('image', src),
      report: (removed, offset) => report(removed, positionIn(text, offset) ?? elementAt(element)),
    })
    return css === '' ? '' : `<style>${css}</style>`
  }

  /** The attributes kept, written out, or undefined when an image has nothing to show. */
  const attributes = (element: Element, allowed: ReadonlySet<string>): string | undefined => {
    let out = ''
    for (const attribute of element.attrs) {
      const { name, value } = attribute
      const at = () => attributeAt(element, name)
      if (
        attribute.namespace !== undefined ||
        (!GLOBAL_ATTRIBUTES.has(name) && !allowed.has(name))
      ) {
        report({ what: 'attribute', name }, at())
        continue
      }
      let kept: string | undefined = value
      if (name === 'style') {
        kept = sanitizeDeclarations(value, {
          image: (src) => served('image', src),
          report: (removed) => report(removed, at()),
        })
        if (kept === '') continue
      } else if (IMAGE_ATTRIBUTES.has(name) || LINK_ATTRIBUTES.has(name)) {
        kept = served(IMAGE_ATTRIBUTES.has(name) ? 'image' : 'link', value)
        if (kept === undefined) {
          report({ what: 'url', name: value }, at())
          if (element.tagName === 'img' && name === 'src') return undefined
          continue
        }
      } else if (name === 'usemap' && !fragmentRef.test(value)) {
        report({ what: 'attribute', name }, at())
        continue
      }
      out += ` ${name}="${escapeAttribute(kept)}"`
    }
    return out
  }

  let depth = 0
  const children = (nodes: readonly ChildNode[]): string => {
    depth++
    const out = nodes.map(node).join('')
    depth--
    return out
  }

  const node = (child: ChildNode): string => {
    if (isText(child)) return escapeText(child.value)
    if (child.nodeName === '#comment') {
      report({ what: 'comment', name: '#comment' }, elementAt(child))
      return ''
    }
    if (!isElement(child)) return ''
    const tag = child.tagName
    if (child.namespaceURI !== HTML_NS || DROPPED_WITH_CONTENT.has(tag) || depth > MAX_DEPTH) {
      report({ what: 'element', name: tag }, elementAt(child))
      return ''
    }
    if (tag === 'style') return style(child)
    if (tag === 'title') {
      if (titleSeen) report({ what: 'element', name: tag }, elementAt(child))
      else takeTitle(child)
      return ''
    }
    const allowed = ELEMENTS.get(tag)
    if (allowed === undefined) {
      report({ what: 'element', name: tag }, elementAt(child))
      return children(child.childNodes)
    }
    const attrs = attributes(child, allowed)
    if (attrs === undefined) return ''
    if (VOID_ELEMENTS.has(tag)) return `<${tag}${attrs}>`
    // The parser drops a newline straight after <pre>, so one that's meant is written twice.
    const first = child.childNodes[0]
    const newline =
      tag === 'pre' && first !== undefined && isText(first) && first.value.startsWith('\n')
    return `<${tag}${attrs}>${newline ? '\n' : ''}${children(child.childNodes)}</${tag}>`
  }

  const takeTitle = (element: Element) => {
    titleSeen = true
    const text = textOf(element)
      .replace(/[\t\n\f\r ]+/g, ' ')
      .trim()
    title = text === '' ? undefined : text
  }

  // Document: a doctype (dropped, the page renders in quirks mode), comments and <html>.
  let head = ''
  let body = ''
  let bodyAttributes = ''
  let htmlAttributes = ''
  for (const top of document.childNodes) {
    if (top.nodeName === '#documentType') continue
    if (!isElement(top)) {
      node(top)
      continue
    }
    htmlAttributes = attributes(top, new Set()) ?? ''
    for (const part of top.childNodes) {
      if (!isElement(part)) {
        if (!isText(part)) node(part)
        continue
      }
      if (part.tagName === 'head') {
        for (const attribute of part.attrs)
          report({ what: 'attribute', name: attribute.name }, attributeAt(part, attribute.name))
        for (const inHead of part.childNodes) {
          if (isText(inHead)) continue
          head += node(inHead)
        }
      } else if (part.tagName === 'body') {
        bodyAttributes = attributes(part, BODY_ATTRIBUTES) ?? ''
        body = children(part.childNodes)
      } else {
        // A frameset in place of the body: deferred (docs/pigeonhtml.md).
        report({ what: 'element', name: part.tagName }, elementAt(part))
      }
    }
  }
  const titleTag = title === undefined ? '' : `<title>${escapeText(title)}</title>`
  return {
    html: `<html${htmlAttributes}><head>${titleTag}${head}</head><body${bodyAttributes}>${body}</body></html>`,
    title,
  }
}
