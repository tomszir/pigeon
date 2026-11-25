// What every Help page is made of: a PigeonHTML document with a title and a CSS 2.1 style
// sheet, the same as anyone's page.

import { escapeHtml } from '../markdown/markdown.ts'

export interface HelpPage {
  readonly title: string
  /** PigeonHTML: HTML 4.01 with presentational attributes, CSS 2.1, no scripts. */
  readonly source: string
}

/** Help's contents page. Every Help address starts with it. */
export const HELP_HOME = 'pigeon://help/'

/** A whole PigeonHTML document. `title` is text; `style` and `body` are already HTML. */
export const helpDocument = (page: {
  readonly title: string
  readonly style: string
  readonly bodyAttributes: string
  readonly body: string
}): HelpPage => ({
  title: page.title,
  source: [
    '<html>',
    '<head>',
    `<title>${escapeHtml(page.title)}</title>`,
    '<style>',
    page.style.trim(),
    '</style>',
    '</head>',
    `<body ${page.bodyAttributes}>`,
    page.body.trim(),
    '</body>',
    '</html>',
    '',
  ].join('\n'),
})

/** Monospaced text, such as an ASCII diagram, escaped into a `<pre>`. */
export const pre = (text: string) => `<pre>${escapeHtml(text.replace(/^\n+|\s+$/g, ''))}</pre>`
