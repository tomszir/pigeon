// For tests only: the two kinds of `urls` a page is sanitized with.

import type { PageUrls } from '../types.ts'

/** Lets every URL through as written, so only the sanitizer's own guard stands in the way. */
export const anyUrls: PageUrls = { image: (src) => src, link: (href) => href }

export const IMAGE_PREFIX = '/files/'
export const LINK_PREFIX = 'pigeon://example/'

/**
 * Serves every image from the page's files and every link as a pigeon:// address, as Explorer
 * will, and passes its own outputs through, so sanitizing twice gives the same page.
 */
export const servedUrls: PageUrls = {
  image: (src) => (src.startsWith(IMAGE_PREFIX) ? src : IMAGE_PREFIX + encodeURIComponent(src)),
  link: (href) => (href.startsWith(LINK_PREFIX) ? href : LINK_PREFIX + encodeURIComponent(href)),
}
