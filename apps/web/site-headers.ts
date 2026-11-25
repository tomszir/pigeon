// The response headers in public/_headers, which Cloudflare adds to every file of the site in
// production. Vite's dev and preview servers send the `/*` rule's headers too, so the site runs
// under the same Content Security Policy everywhere and a change that breaks it shows up in
// development and in the end-to-end tests, not first in production.
import { readFileSync } from 'node:fs'

export interface HeaderRule {
  /** The URL pattern the rule is for, such as `/*`. */
  readonly pattern: string
  readonly headers: Readonly<Record<string, string>>
}

/**
 * Reads Cloudflare's `_headers` format: a URL pattern on a line of its own, then its headers as
 * indented `Name: value` lines. Lines starting with `#` are comments.
 */
export function parseHeaders(text: string): HeaderRule[] {
  const rules: { pattern: string; headers: Record<string, string> }[] = []
  for (const line of text.split('\n')) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue
    if (!/^\s/.test(line)) {
      rules.push({ pattern: line.trim(), headers: {} })
      continue
    }
    const colon = line.indexOf(':')
    const rule = rules.at(-1)
    if (rule === undefined || colon < 0) throw new Error(`_headers: can't read "${line.trim()}"`)
    rule.headers[line.slice(0, colon).trim()] = line.slice(colon + 1).trim()
  }
  return rules
}

/** The headers every response of the site carries: the `/*` rule's. */
export function siteHeaders(
  text = readFileSync(new URL('public/_headers', import.meta.url), 'utf8'),
) {
  const rule = parseHeaders(text).find((candidate) => candidate.pattern === '/*')
  if (rule === undefined) throw new Error('_headers has no rule for /*')
  return rule.headers
}

/** The Content-Security-Policy as a map from each directive to its sources. */
export function directives(policy: string): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const part of policy.split(';')) {
    const [name, ...sources] = part.trim().split(/\s+/)
    if (name !== undefined && name !== '') out.set(name, sources)
  }
  return out
}
