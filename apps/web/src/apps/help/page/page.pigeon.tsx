/** @jsxImportSource @pigeon/pigeonhtml */
// What every Help page is made of: a PigeonHTML document with a title and a CSS 2.1 style
// sheet, the same as anyone's page, written as typed JSX (docs/pigeonhtml.md).

import { type BodyAttributes, type Child, render } from '@pigeon/pigeonhtml/jsx-runtime'

export interface HelpPage {
  readonly title: string
  /** PigeonHTML: HTML 4.01 with presentational attributes, CSS 2.1, no scripts. */
  readonly source: string
}

/** Help's contents page. Every Help address starts with it. */
export const HELP_HOME = 'pigeon://help/'

/** A whole PigeonHTML document, as the page's text. `style` is CSS and `body` the page's content. */
export const helpDocument = (page: {
  readonly title: string
  readonly style: string
  readonly bodyAttributes: BodyAttributes
  readonly body: Child
}): HelpPage => ({
  title: page.title,
  source: render(
    // biome-ignore lint/a11y/useHtmlLang: a Help page is written like any Pigeonweb page of its era, with no language set
    <html>
      <head>
        <title>{page.title}</title>
        <style>{page.style.trim()}</style>
      </head>
      <body {...page.bodyAttributes}>{page.body}</body>
    </html>,
  ),
})

/**
 * Monospaced text, such as an ASCII diagram, kept exactly as given apart from the blank lines
 * around it. JSX collapses the whitespace of text written between tags, but not of a string
 * passed in a prop or a `{}`, so diagrams and anything else whose spaces and line breaks
 * count go through this and not into a bare `<pre>`.
 */
export const Pre = (props: { readonly text: string; readonly class?: string }) => (
  <pre class={props.class}>{props.text.replace(/^\n+|\s+$/g, '')}</pre>
)
