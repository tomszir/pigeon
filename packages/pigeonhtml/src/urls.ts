// A second check on every URL, before and after `urls.image` and `urls.link`: whoever shows the
// page decides what a URL may be, but nothing that can run script ever gets through, even if
// their function would let it.

/** Controls, spaces and invisible characters, which could hide a scheme from a plain match. */
const isSkipped = (code: number) =>
  code <= 0x20 ||
  (code >= 0x7f && code <= 0x9f) ||
  code === 0xad ||
  (code >= 0x200b && code <= 0x200f) ||
  code === 0x2028 ||
  code === 0x2029 ||
  code === 0xfeff

/** The scheme a browser would read, ignoring the whitespace and controls it skips, lowercased. */
export function schemeOf(url: string): string | undefined {
  const squeezed = [...url].filter((char) => !isSkipped(char.codePointAt(0) ?? 0)).join('')
  return /^([a-z][a-z0-9+.-]*):/i.exec(squeezed)?.[1]?.toLowerCase()
}

const scriptSchemes = new Set(['javascript', 'vbscript', 'livescript', 'mocha', 'jscript'])

/** False for a URL that could run script or load a document: script schemes, and data: that isn't a GIF, JPEG or PNG. */
export function isSafeUrl(url: string, kind: 'image' | 'link'): boolean {
  const scheme = schemeOf(url)
  if (scheme === undefined) return true
  if (scriptSchemes.has(scheme)) return false
  if (scheme === 'data') {
    return (
      kind === 'image' &&
      // biome-ignore lint/suspicious/noControlCharactersInRegex: matched as browsers read it
      /^data:image\/(gif|png|jpeg)[;,]/i.test(url.replace(/[\u0000-\u0020]/g, ''))
    )
  }
  return true
}
