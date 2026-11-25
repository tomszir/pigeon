// pigeon:// addresses as Explorer reads them: what's typed in the address bar, and where a page's
// links go. One spelling per page, so history and the bundled pages agree on what is the same page.

export const HOME_ADDRESS = 'pigeon://home'

const SCHEME = /^[a-z][a-z0-9+.-]*:/i

/**
 * The one spelling of a pigeon:// address: scheme and name in lower case, no "/" after a bare
 * name, no #fragment. Undefined for anything that isn't a pigeon:// address.
 */
export function canonicalAddress(url: URL): string | undefined {
  if (url.protocol !== 'pigeon:' || url.host === '') return undefined
  const path = url.pathname === '/' ? '' : url.pathname
  return `pigeon://${url.host.toLowerCase()}${path}${url.search}`
}

/**
 * What the address bar opens for what was typed: "mika" and "mika/pics/" are pigeon:// addresses.
 * Any other scheme is kept as typed, so it can be shown as a page nobody is hosting.
 */
export function typedAddress(typed: string): string | undefined {
  const text = typed.trim()
  if (text === '') return undefined
  const withScheme = SCHEME.test(text) && !/^[^/]*:\d/.test(text) ? text : `pigeon://${text}`
  try {
    return canonicalAddress(new URL(withScheme)) ?? text
  } catch {
    return text
  }
}

/**
 * Where a link on the page at `base` goes: a pigeon:// address, an in-page "#name", or undefined
 * to drop the link (http, mailto, javascript and the rest don't exist in-world).
 */
export function linkTarget(href: string, base: string): string | undefined {
  const text = href.trim()
  if (text.startsWith('#')) return text.length > 1 ? text : undefined
  try {
    return canonicalAddress(new URL(text, base))
  } catch {
    return undefined
  }
}
