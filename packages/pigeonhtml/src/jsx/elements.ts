// The types of a page written in JSX: which elements it may use and which attributes each takes,
// derived from the allowlists the sanitizer enforces, so a page that doesn't type-check is one
// the sanitizer would cut something from. What the types can't see (a `data-` attribute is
// exempt from TypeScript's excess-attribute check, as is anything spread in) is checked by the
// test over every bundled page.

import type {
  BODY_ATTRIBUTE_TABLE,
  ELEMENT_TABLE,
  GLOBAL_ATTRIBUTE_TABLE,
  VOID_ELEMENT_TABLE,
} from '../allowlists.ts'

declare const htmlBrand: unique symbol

/**
 * Markup that is safe to put in a page: what a JSX expression makes, or `raw()` for the one
 * place a caller vouches for a string. It's an opaque value, not a string, so a plain string
 * can't stand in for it; `render()` gives the markup back as text.
 */
export interface Html {
  readonly [htmlBrand]: true
}

/** What a child may be. Strings and numbers are escaped; `false`, `null` and `undefined` write nothing. */
export type Child = Html | string | number | boolean | null | undefined | readonly Child[]

/** The attributes that stand alone, written `<hr noshade>`: present or absent. */
export type BooleanAttribute = 'compact' | 'ismap' | 'noshade' | 'nohref' | 'nowrap'

type Global = (typeof GLOBAL_ATTRIBUTE_TABLE)[number]
type ElementName = keyof typeof ELEMENT_TABLE
type VoidName = (typeof VOID_ELEMENT_TABLE)[number]
type AttributesOf<E extends ElementName> = (typeof ELEMENT_TABLE)[E][number]

/**
 * The attributes `names` lists, each a string or a number, or a boolean for the standalone ones.
 * `undefined` leaves one out, so `bgcolor={shaded ? '#eee' : undefined}` is fine.
 */
type Attributes<Names extends string> = {
  readonly [N in Names]?: N extends BooleanAttribute
    ? boolean | undefined
    : string | number | undefined
}

type WithChildren = { readonly children?: Child }
type WithoutChildren = { readonly children?: never }

type Props<Names extends string, Content> = Attributes<Names | Global> & Content

/** The attributes a `<body>` may carry, for a page that builds its own. */
export type BodyAttributes = Attributes<(typeof BODY_ATTRIBUTE_TABLE)[number] | Global>

type Elements = {
  readonly [E in ElementName]: Props<
    AttributesOf<E>,
    E extends VoidName ? WithoutChildren : WithChildren
  >
}

/**
 * The document's own elements, which the sanitizer writes itself and so aren't in the tables.
 * `style` holds CSS, which is text the page's author wrote and isn't escaped (it must not
 * hold a `<`); the others take what any element takes.
 */
type DocumentElements = {
  readonly html: Props<never, WithChildren>
  readonly head: WithChildren
  readonly title: { readonly children?: string | number }
  readonly style: { readonly children?: string }
  readonly body: Props<(typeof BODY_ATTRIBUTE_TABLE)[number], WithChildren>
}

/** What TypeScript reads for `jsxImportSource: "@pigeon/pigeonhtml"`. */
export declare namespace JSX {
  type Element = Html
  interface ElementChildrenAttribute {
    children: unknown
  }
  interface IntrinsicElements extends Elements, DocumentElements {}
}
