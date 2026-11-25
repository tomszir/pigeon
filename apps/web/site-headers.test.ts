// @vitest-environment node
// The headers the site is served with. The end-to-end tests run the app under this policy and
// fail on anything it refuses; these keep the policy itself from quietly loosening.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { directives, parseHeaders, siteHeaders } from './site-headers.ts'

const headers = siteHeaders()
const policy = directives(headers['Content-Security-Policy'] ?? '')

describe('the site headers', () => {
  it('load nothing by default, and scripts only from the site itself', () => {
    expect(policy.get('default-src')).toEqual(["'none'"])
    expect(policy.get('script-src')).toEqual(["'self'"])
    expect(policy.get('object-src')).toEqual(["'none'"])
    expect(policy.get('base-uri')).toEqual(["'none'"])
    expect(policy.get('form-action')).toEqual(["'none'"])
  })

  it('keep Pigeon out of other sites’ frames', () => {
    expect(policy.get('frame-ancestors')).toEqual(["'none'"])
    expect(headers['X-Frame-Options']).toBe('DENY')
  })

  it('never name a host to load from, only the site and the schemes it needs', () => {
    for (const [name, sources] of policy) {
      for (const source of sources) expect(`${name} ${source}`).toMatch(/ ('[a-z-]+'|[a-z]+:)$/)
      expect(sources).not.toContain("'unsafe-eval'")
    }
    expect(policy.get('connect-src')).toEqual(["'self'", 'wss:', 'ws:'])
    // It would turn ws:// into wss:// and cut off a Lighthouse on this computer.
    expect(policy.has('upgrade-insecure-requests')).toBe(false)
  })

  it('allow what an Explorer page needs, since its frame inherits the policy', () => {
    expect(policy.get('style-src')).toContain("'unsafe-inline'")
    expect(policy.get('img-src')).toEqual(["'self'", 'data:'])
    expect(policy.get('font-src')).toEqual(["'self'"])
  })

  it('stop sniffing and send no referrer', () => {
    expect(headers['X-Content-Type-Options']).toBe('nosniff')
    expect(headers['Referrer-Policy']).toBe('no-referrer')
  })

  it('match a page that has no inline script to run', () => {
    const html = readFileSync(new URL('index.html', import.meta.url), 'utf8')
    for (const [, attributes] of html.matchAll(/<script\b([^>]*)>/g)) {
      expect(attributes).toMatch(/\bsrc=|type="application\/ld\+json"/)
    }
  })
})

describe('parseHeaders', () => {
  it('reads patterns, their indented headers, and skips comments', () => {
    const text = '# a comment\n/*\n  A: one: two\n\n  # another\n  B: 3\n/api/*\n  C: 4\n'
    expect(parseHeaders(text)).toEqual([
      { pattern: '/*', headers: { A: 'one: two', B: '3' } },
      { pattern: '/api/*', headers: { C: '4' } },
    ])
  })

  it('refuses a header line before any pattern', () => {
    expect(() => parseHeaders('  A: 1\n')).toThrow(/can't read/)
  })
})
