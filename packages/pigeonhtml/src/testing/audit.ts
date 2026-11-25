// For tests only: parse sanitized output again, as the rendering browser will, and list
// anything in it that the allowlists don't allow. It shares nothing with the sanitizer but
// the allowlist tables, which are the spec.

import { type DefaultTreeAdapterTypes, html as htmlSpec, parse } from 'parse5'
import { BODY_ATTRIBUTES, ELEMENTS, GLOBAL_ATTRIBUTES } from '../allowlists.ts'

type Node = DefaultTreeAdapterTypes.Node

export interface AuditOptions {
  /** Every image URL must start with this, as the test's `urls.image` makes them. */
  readonly imagePrefix?: string
  /** Every link must start with this, as the test's `urls.link` makes them. */
  readonly linkPrefix?: string
}

const STRUCTURE = new Set(['html', 'head', 'body', 'title', 'style'])

// biome-ignore lint/suspicious/noControlCharactersInRegex: browsers skip these in URLs
const squeeze = (url: string) => url.replace(/[\u0000-\u0020]/g, '').toLowerCase()

const scripted = (url: string) =>
  /^(javascript|vbscript|livescript|mocha|jscript):/.test(squeeze(url)) ||
  (squeeze(url).startsWith('data:') && !/^data:image\/(gif|png|jpeg)[;,]/.test(squeeze(url)))

const BANNED_CSS =
  /expression|javascript|vbscript|behavior|binding|@import|@font-face|<\/|<!--|-->/i

function cssProblems(css: string, where: string, options: AuditOptions): string[] {
  const problems: string[] = []
  if (BANNED_CSS.test(css)) problems.push(`${where}: banned CSS in ${JSON.stringify(css)}`)
  for (const match of css.matchAll(/url\(\s*(["']?)([^"')]*)/gi)) {
    const url = match[2] ?? ''
    if (match[1] === '') problems.push(`${where}: unquoted url() ${url}`)
    if (scripted(url)) problems.push(`${where}: scripted url() ${url}`)
    if (options.imagePrefix !== undefined && !url.startsWith(options.imagePrefix))
      problems.push(`${where}: url() not from urls.image: ${url}`)
  }
  return problems
}

/** Everything in `html` the allowlists don't allow; empty when it's clean. */
export function audit(html: string, options: AuditOptions = {}): string[] {
  const problems: string[] = []
  const document = parse(html, { scriptingEnabled: false })
  const visit = (node: Node, inHead: boolean) => {
    if (node.nodeName === '#documentType') problems.push('a doctype')
    if (node.nodeName === '#comment') problems.push('a comment')
    if ('tagName' in node) {
      const tag = node.tagName
      if (node.namespaceURI !== htmlSpec.NS.HTML) problems.push(`foreign <${tag}>`)
      if (!ELEMENTS.has(tag) && !STRUCTURE.has(tag)) problems.push(`<${tag}>`)
      if (tag === 'title' && !inHead) problems.push('<title> outside <head>')
      if (tag === 'template' || 'content' in node) problems.push('a template')
      const allowed = tag === 'body' ? BODY_ATTRIBUTES : (ELEMENTS.get(tag) ?? new Set<string>())
      for (const { name, value, namespace } of node.attrs) {
        if (namespace !== undefined || (!GLOBAL_ATTRIBUTES.has(name) && !allowed.has(name)))
          problems.push(`<${tag} ${name}>`)
        if (name === 'href' || name === 'src' || name === 'background') {
          if (scripted(value)) problems.push(`<${tag} ${name}="${value}">`)
          const prefix = name === 'href' ? options.linkPrefix : options.imagePrefix
          if (prefix !== undefined && !value.startsWith(prefix))
            problems.push(`<${tag} ${name}="${value}"> not from urls`)
        }
        if (name === 'usemap' && !/^#[A-Za-z0-9_.:-]+$/.test(value)) problems.push('a usemap URL')
        if (name === 'style') problems.push(...cssProblems(value, `<${tag} style>`, options))
      }
      if (tag === 'style') {
        const css = node.childNodes.map((child) => ('value' in child ? child.value : '')).join('')
        problems.push(...cssProblems(css, '<style>', options))
      }
    }
    if ('childNodes' in node)
      for (const child of node.childNodes) visit(child, inHead || node.nodeName === 'head')
  }
  visit(document, false)
  return problems
}
