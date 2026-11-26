// A page written as JSX, made into PigeonHTML text: `/** @jsxImportSource @pigeon/pigeonhtml */`
// at the top of a `.tsx` file makes its elements call this (docs/pigeonhtml.md). Every string
// and number child and every attribute value is escaped on the way out; `raw()` is the one way
// to put markup in as it is. This only writes text: the page still goes through `sanitize` like
// anyone's, and the types in elements.ts are what say which elements and attributes are allowed.

import { VOID_ELEMENTS } from '../allowlists.ts'
import type { Child, Html } from './elements.ts'

export type { BodyAttributes, BooleanAttribute, Child, Html, JSX } from './elements.ts'

const ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

/** Text made safe for an element's content or a quoted attribute. */
export const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c)

/**
 * The markup of every Html this module has made. A value that isn't in here is not Html, however
 * it was typed, and is refused where it would be written into a page.
 */
const markupOf = new WeakMap<Html, string>()

const html = (markup: string): Html => {
  const value = Object.freeze({}) as Html
  markupOf.set(value, markup)
  return value
}

/** The markup as text, to hand to `sanitize` or a frame. */
export function render(value: Html): string {
  const markup = markupOf.get(value)
  if (markup === undefined) throw new TypeError('Not Html: made by JSX or raw()')
  return markup
}

/**
 * Markup the caller vouches for, written as it is. Only for markup that something other than a
 * person typed it into a page, such as the output of a converter that escapes what it reads.
 */
export const raw = (markup: string): Html => html(markup)

const children = (child: Child): string => {
  if (typeof child === 'string') return escapeHtml(child)
  if (typeof child === 'number') return escapeHtml(String(child))
  if (child === null || child === undefined || typeof child === 'boolean') return ''
  if (Array.isArray(child)) return (child as readonly Child[]).map(children).join('')
  return render(child as Html)
}

const NAME = /^[a-z][a-z0-9-]*$/i

const attributes = (props: Readonly<Record<string, unknown>>): string => {
  let out = ''
  for (const [name, value] of Object.entries(props)) {
    if (name === 'children' || value === false || value === null || value === undefined) continue
    if (!NAME.test(name)) throw new TypeError(`Not an attribute name: ${name}`)
    if (value === true) out += ` ${name}`
    else if (typeof value === 'string' || typeof value === 'number')
      out += ` ${name}="${escapeHtml(String(value))}"`
    else throw new TypeError(`The ${name} attribute is a ${typeof value}, not a string or number`)
  }
  return out
}

/**
 * A `<style>` holds raw text, so its CSS is written as it is, and can't close the element. What
 * isn't a string is refused, not turned into text: `false` would become "false".
 */
const styleText = (child: unknown): string => {
  if (child === undefined || child === null || child === false) return ''
  if (typeof child !== 'string') throw new TypeError('A <style> holds a string of CSS')
  if (child.includes('<')) throw new TypeError('A <style> may not hold a "<"; write it as \\3c')
  return child
}

type Props = Readonly<Record<string, unknown>>
type Component = (props: Props) => Html

/** What TypeScript calls for every element and component of a page. */
export function jsx(type: string | Component, props: Props, _key?: unknown): Html {
  if (typeof type === 'function') {
    const result = type(props)
    render(result)
    return result
  }
  if (!NAME.test(type)) throw new TypeError(`Not an element name: ${type}`)
  const tag = type.toLowerCase()
  const open = `<${tag}${attributes(props)}>`
  if (VOID_ELEMENTS.has(tag)) {
    if (props['children'] !== undefined) throw new TypeError(`<${tag}> takes no children`)
    return html(open)
  }
  const inside =
    tag === 'style' ? styleText(props['children']) : children(props['children'] as Child)
  return html(`${open}${inside}</${tag}>`)
}

/** The same as `jsx`, for an element whose children are written out in the source. */
export const jsxs = jsx

/** `<>...</>`: its children, with no element around them. */
export const Fragment = (props: Props): Html => html(children(props['children'] as Child))
