// CSS for PigeonHTML: a small tokenizer after CSS Syntax Level 3, so escapes, comments and
// strings are read the way the browser will read them, then an allowlist over the tokens.
// What's kept is written back out from the tokens, never copied from the source, so no
// escape, comment or `</style>` in the source survives into the output.

import {
  CSS_FUNCTIONS,
  CSS_KEYWORDS,
  CSS_MEDIA,
  CSS_PROPERTIES,
  CSS_PSEUDOS,
  CSS_UNITS,
  CSS_URL_PROPERTIES,
  MAX_Z_INDEX,
} from './allowlists.ts'
import type { Removed } from './types.ts'
import { isSafeUrl } from './urls.ts'

type Simple =
  | 'ws'
  | ':'
  | ';'
  | ','
  | '('
  | ')'
  | '['
  | ']'
  | '{'
  | '}'
  | 'cdo'
  | 'cdc'
  | 'bad'
  | 'eof'

export type Token =
  | { readonly type: Simple; readonly at: number }
  | {
      readonly type: 'ident' | 'function' | 'at-keyword' | 'hash' | 'string' | 'url' | 'delim'
      readonly value: string
      readonly at: number
    }
  | { readonly type: 'number' | 'percentage'; readonly repr: string; readonly at: number }
  | {
      readonly type: 'dimension'
      readonly repr: string
      readonly unit: string
      readonly at: number
    }

const isDigit = (c: string | undefined) => c !== undefined && c >= '0' && c <= '9'
const isHex = (c: string | undefined) => c !== undefined && /^[0-9a-fA-F]$/.test(c)
const isNameStart = (c: string | undefined) =>
  c !== undefined && (/^[a-zA-Z_]$/.test(c) || c.charCodeAt(0) >= 0x80)
const isName = (c: string | undefined) => isNameStart(c) || isDigit(c) || c === '-'
const isWs = (c: string | undefined) => c === ' ' || c === '\t' || c === '\n'
const isNonPrintable = (c: string) => {
  const code = c.charCodeAt(0)
  return code <= 0x08 || code === 0x0b || (code >= 0x0e && code <= 0x1f) || code === 0x7f
}
const validEscape = (a: string | undefined, b: string | undefined) => a === '\\' && b !== '\n'
const startsIdent = (a: string | undefined, b: string | undefined, c: string | undefined) =>
  a === '-' ? isNameStart(b) || b === '-' || validEscape(b, c) : isNameStart(a) || validEscape(a, b)
const startsNumber = (a: string | undefined, b: string | undefined, c: string | undefined) =>
  a === '+' || a === '-'
    ? isDigit(b) || (b === '.' && isDigit(c))
    : a === '.'
      ? isDigit(b)
      : isDigit(a)

/** CSS's tokens, after its input preprocessing. Comments are skipped. */
export function tokenize(source: string): Token[] {
  const s = source.replace(/\r\n?|\f/g, '\n').replaceAll('\0', '\ufffd')
  const tokens: Token[] = []
  let i = 0

  const consumeEscape = (): string => {
    // The backslash is already consumed.
    if (i >= s.length) return '\ufffd'
    if (isHex(s[i])) {
      let hex = ''
      while (hex.length < 6 && isHex(s[i])) hex += s[i++]
      if (isWs(s[i])) i++
      const code = Number.parseInt(hex, 16)
      return code === 0 || (code >= 0xd800 && code <= 0xdfff) || code > 0x10ffff
        ? '\ufffd'
        : String.fromCodePoint(code)
    }
    const code = s.codePointAt(i) ?? 0xfffd
    const char = String.fromCodePoint(code)
    i += char.length
    return char
  }

  const name = (): string => {
    let out = ''
    for (;;) {
      if (isName(s[i])) out += s[i++]
      else if (validEscape(s[i], s[i + 1])) {
        i++
        out += consumeEscape()
      } else return out
    }
  }

  const numeric = (at: number): Token => {
    let repr = ''
    if (s[i] === '+' || s[i] === '-') repr += s[i++]
    while (isDigit(s[i])) repr += s[i++]
    if (s[i] === '.' && isDigit(s[i + 1])) {
      repr += s[i++]
      while (isDigit(s[i])) repr += s[i++]
    }
    if (
      (s[i] === 'e' || s[i] === 'E') &&
      (isDigit(s[i + 1]) || ((s[i + 1] === '+' || s[i + 1] === '-') && isDigit(s[i + 2])))
    ) {
      repr += s.slice(i, i + 2)
      i += 2
      while (isDigit(s[i])) repr += s[i++]
    }
    if (startsIdent(s[i], s[i + 1], s[i + 2])) return { type: 'dimension', repr, unit: name(), at }
    if (s[i] === '%') {
      i++
      return { type: 'percentage', repr, at }
    }
    return { type: 'number', repr, at }
  }

  const badUrlRemnants = () => {
    while (i < s.length && s[i] !== ')') {
      if (validEscape(s[i], s[i + 1])) {
        i++
        consumeEscape()
      } else i++
    }
    i++
  }

  const url = (at: number): Token => {
    let out = ''
    while (isWs(s[i])) i++
    for (;;) {
      const c = s[i]
      if (c === undefined || c === ')') {
        i++
        return { type: 'url', value: out, at }
      }
      if (isWs(c)) {
        while (isWs(s[i])) i++
        if (s[i] === ')' || s[i] === undefined) continue
        badUrlRemnants()
        return { type: 'bad', at }
      }
      if (c === '"' || c === "'" || c === '(' || isNonPrintable(c)) {
        badUrlRemnants()
        return { type: 'bad', at }
      }
      if (c === '\\') {
        if (!validEscape(c, s[i + 1])) {
          badUrlRemnants()
          return { type: 'bad', at }
        }
        i++
        out += consumeEscape()
      } else {
        out += c
        i++
      }
    }
  }

  const identLike = (at: number): Token => {
    const value = name()
    if (value.toLowerCase() === 'url' && s[i] === '(') {
      i++
      let j = i
      while (isWs(s[j])) j++
      if (s[j] === '"' || s[j] === "'") {
        i = j
        return { type: 'function', value, at }
      }
      return url(at)
    }
    if (s[i] === '(') {
      i++
      return { type: 'function', value, at }
    }
    return { type: 'ident', value, at }
  }

  const string = (quote: string, at: number): Token => {
    let out = ''
    for (;;) {
      const c = s[i]
      if (c === undefined) return { type: 'string', value: out, at }
      if (c === quote) {
        i++
        return { type: 'string', value: out, at }
      }
      if (c === '\n') return { type: 'bad', at }
      if (c === '\\') {
        i++
        if (s[i] === undefined) continue
        if (s[i] === '\n') i++
        else out += consumeEscape()
      } else {
        out += c
        i++
      }
    }
  }

  while (i < s.length) {
    const at = i
    const c = s[i] ?? ''
    if (c === '/' && s[i + 1] === '*') {
      const end = s.indexOf('*/', i + 2)
      i = end === -1 ? s.length : end + 2
      continue
    }
    if (isWs(c)) {
      while (isWs(s[i])) i++
      tokens.push({ type: 'ws', at })
    } else if (c === '"' || c === "'") {
      i++
      tokens.push(string(c, at))
    } else if (c === '#') {
      if (isName(s[i + 1]) || validEscape(s[i + 1], s[i + 2])) {
        i++
        tokens.push({ type: 'hash', value: name(), at })
      } else {
        i++
        tokens.push({ type: 'delim', value: c, at })
      }
    } else if (
      c === '(' ||
      c === ')' ||
      c === '[' ||
      c === ']' ||
      c === '{' ||
      c === '}' ||
      c === ',' ||
      c === ':' ||
      c === ';'
    ) {
      i++
      tokens.push({ type: c, at })
    } else if ((c === '+' || c === '.') && startsNumber(c, s[i + 1], s[i + 2])) {
      tokens.push(numeric(at))
    } else if (c === '-') {
      if (startsNumber(c, s[i + 1], s[i + 2])) tokens.push(numeric(at))
      else if (s.startsWith('-->', i)) {
        i += 3
        tokens.push({ type: 'cdc', at })
      } else if (startsIdent(c, s[i + 1], s[i + 2])) tokens.push(identLike(at))
      else {
        i++
        tokens.push({ type: 'delim', value: c, at })
      }
    } else if (c === '<' && s.startsWith('<!--', i)) {
      i += 4
      tokens.push({ type: 'cdo', at })
    } else if (c === '@' && startsIdent(s[i + 1], s[i + 2], s[i + 3])) {
      i++
      tokens.push({ type: 'at-keyword', value: name(), at })
    } else if (c === '\\' && validEscape(c, s[i + 1])) {
      tokens.push(identLike(at))
    } else if (isDigit(c)) {
      tokens.push(numeric(at))
    } else if (isNameStart(c)) {
      tokens.push(identLike(at))
    } else {
      i++
      tokens.push({ type: 'delim', value: c, at })
    }
  }
  return tokens
}

// Component values: tokens with functions and blocks gathered into trees.

interface Fn {
  readonly type: 'fn'
  readonly name: string
  readonly args: Component[]
  readonly at: number
}
interface Block {
  readonly type: 'block'
  readonly open: '(' | '[' | '{'
  readonly items: Component[]
  readonly at: number
}
type Component = Token | Fn | Block

const closer = { '(': ')', '[': ']', '{': '}' } as const

/** How deep blocks and functions may nest; anything deeper is skipped. CSS 2.1 needs three. */
const MAX_NESTING = 16

function components(tokens: readonly Token[]): Component[] {
  let i = 0
  const until = (close: string | undefined, depth: number): Component[] => {
    const out: Component[] = []
    if (depth > MAX_NESTING) {
      // Skip to the matching close without building anything, counting what opens and closes.
      let open = 0
      while (i < tokens.length) {
        const token = tokens[i++]
        if (token === undefined) break
        if (
          token.type === 'function' ||
          token.type === '(' ||
          token.type === '[' ||
          token.type === '{'
        )
          open++
        else if (token.type === ')' || token.type === ']' || token.type === '}') {
          if (open === 0) return out
          open--
        }
      }
      return out
    }
    while (i < tokens.length) {
      const token = tokens[i++]
      if (token === undefined) break
      if (token.type === close) return out
      if (token.type === 'function')
        out.push({ type: 'fn', name: token.value, args: until(')', depth + 1), at: token.at })
      else if (token.type === '(' || token.type === '[' || token.type === '{')
        out.push({
          type: 'block',
          open: token.type,
          items: until(closer[token.type], depth + 1),
          at: token.at,
        })
      else out.push(token)
    }
    return out
  }
  return until(undefined, 0)
}

// Writing tokens back out, escaped so they read back as the same tokens and never hold `<`.

const hexEscape = (char: string) => `\\${(char.codePointAt(0) ?? 0xfffd).toString(16)} `

/**
 * Whether a name reads back as itself without escapes. Names that need escapes (only an
 * escape in the source can make one) are dropped rather than written out escaped, so the
 * output holds no escapes outside strings.
 */
function isPlainName(value: string, asIdent: boolean): boolean {
  if (value === '' || (asIdent && (value === '-' || /^-?[0-9]/.test(value)))) return false
  for (const char of value) {
    if (!/^[a-zA-Z0-9_-]$/.test(char) && (char.codePointAt(0) ?? 0) < 0x80) return false
  }
  return true
}

function quote(value: string): string {
  let out = '"'
  for (const char of value) {
    // biome-ignore lint/suspicious/noControlCharactersInRegex: controls are written as escapes
    out += /^["\\<>&\u0000-\u001f\u007f]$/.test(char) ? hexEscape(char) : char
  }
  return `${out}"`
}

// The allowlist.

export interface CssContext {
  /** `urls.image`, already checked by the caller's guard. */
  readonly image: (src: string) => string | undefined
  /** Something dropped, at an offset into the CSS text. */
  readonly report: (removed: Removed, at: number) => void
}

const isWsToken = (c: Component | undefined) => c?.type === 'ws'

const trim = (list: readonly Component[]): Component[] => {
  let start = 0
  let end = list.length
  while (start < end && isWsToken(list[start])) start++
  while (end > start && isWsToken(list[end - 1])) end--
  return list.slice(start, end)
}

/** One URL in a value, through the guard and `urls.image`, or undefined to drop the declaration. */
function imageUrl(src: string, at: number, context: CssContext): string | undefined {
  const served = isSafeUrl(src, 'image') ? context.image(src) : undefined
  if (served === undefined || !isSafeUrl(served, 'image')) {
    context.report({ what: 'url', name: src }, at)
    return undefined
  }
  return `url(${quote(served)})`
}

/** A declaration's value written back out, or undefined if anything in it isn't allowed. */
/** Tokens that run together when written side by side. */
const WORDLIKE: ReadonlySet<string> = new Set([
  'ident',
  'hash',
  'number',
  'percentage',
  'dimension',
  'fn',
  'url',
])

function value(
  property: string,
  list: readonly Component[],
  context: CssContext,
  inFunction: boolean,
): string | undefined {
  let out = ''
  let previous: Component | undefined
  for (const part of list) {
    // Two words or numbers with nothing between them were kept apart only by a comment
    // (`100/**/vw`). Written out side by side they'd read back as one token, so the whole
    // value goes.
    if (WORDLIKE.has(previous?.type ?? '') && WORDLIKE.has(part.type)) return undefined
    previous = part
    switch (part.type) {
      case 'ws':
        out += ' '
        break
      case 'ident':
        if (!isPlainName(part.value, true)) return undefined
        out += part.value
        break
      case 'hash':
        if (!isPlainName(part.value, false)) return undefined
        out += `#${part.value}`
        break
      case 'string':
        out += quote(part.value)
        break
      case 'number':
        out += part.repr
        break
      case 'percentage':
        out += `${part.repr}%`
        break
      case 'dimension':
        if (!CSS_UNITS.has(part.unit.toLowerCase())) return undefined
        out += part.repr + part.unit.toLowerCase()
        break
      case ',':
        out += ','
        break
      case 'delim':
        if (part.value !== '/') return undefined
        out += '/'
        break
      case 'url': {
        if (inFunction || !CSS_URL_PROPERTIES.has(property)) return undefined
        const written = imageUrl(part.value, part.at, context)
        if (written === undefined) return undefined
        out += written
        break
      }
      case 'fn': {
        const name = part.name.toLowerCase()
        if (inFunction || !CSS_FUNCTIONS.has(name)) return undefined
        if (name === 'url') {
          const args = trim(part.args)
          const [only] = args
          if (args.length !== 1 || only?.type !== 'string' || !CSS_URL_PROPERTIES.has(property))
            return undefined
          const written = imageUrl(only.value, only.at, context)
          if (written === undefined) return undefined
          out += written
        } else {
          const args = value(property, trim(part.args), context, true)
          if (args === undefined) return undefined
          out += `${name}(${args})`
        }
        break
      }
      default:
        return undefined
    }
  }
  return out
}

/** `auto`, `inherit`, or a whole number no further from 0 than MAX_Z_INDEX. */
function zIndexAllowed(parts: readonly Component[]): boolean {
  const [only] = parts
  if (parts.length !== 1 || only === undefined) return false
  if (only.type === 'ident') return ['auto', 'inherit'].includes(only.value.toLowerCase())
  return (
    only.type === 'number' &&
    /^[+-]?\d+$/.test(only.repr) &&
    Math.abs(Number(only.repr)) <= MAX_Z_INDEX
  )
}

/** A list of declarations, as in a `style` attribute or a rule's block, written back out. */
function declarations(list: readonly Component[], context: CssContext): string {
  const kept: string[] = []
  const chunks: Component[][] = [[]]
  for (const part of list) {
    if (part.type === ';') chunks.push([])
    else chunks.at(-1)?.push(part)
  }
  for (const chunk of chunks.map(trim)) {
    const [head, ...rest] = chunk
    if (head === undefined) continue
    const body = trim(rest)
    if (head.type !== 'ident' || body[0]?.type !== ':') {
      context.report(
        {
          what: 'property',
          name: head.type === 'ident' || head.type === 'at-keyword' ? head.value : '?',
        },
        head.at,
      )
      continue
    }
    const property = head.value.toLowerCase()
    let parts = trim(body.slice(1))
    let important = false
    const last = parts.at(-1)
    const bang = trim(parts.slice(0, -1)).at(-1)
    if (
      last?.type === 'ident' &&
      last.value.toLowerCase() === 'important' &&
      bang?.type === 'delim' &&
      bang.value === '!'
    ) {
      important = true
      parts = trim(trim(parts.slice(0, -1)).slice(0, -1))
    }
    if (!CSS_PROPERTIES.has(property) || parts.length === 0) {
      context.report({ what: 'property', name: property }, head.at)
      continue
    }
    const keywords = CSS_KEYWORDS.get(property)
    const [single] = parts
    if (
      keywords !== undefined &&
      (parts.length !== 1 || single?.type !== 'ident' || !keywords.has(single.value.toLowerCase()))
    ) {
      context.report({ what: 'property', name: property }, head.at)
      continue
    }
    if (property === 'z-index' && !zIndexAllowed(parts)) {
      context.report({ what: 'property', name: property }, head.at)
      continue
    }
    const written = value(property, parts, context, false)
    if (written === undefined) {
      context.report({ what: 'property', name: property }, head.at)
      continue
    }
    kept.push(`${property}: ${written}${important ? ' !important' : ''}`)
  }
  return kept.join('; ')
}

/** A rule's selector written back out, or undefined if it isn't CSS 2.1. */
function selector(list: readonly Component[]): string | undefined {
  let out = ''
  for (let i = 0; i < list.length; i++) {
    const part = list[i]
    if (part === undefined) break
    switch (part.type) {
      case 'ws':
        out += ' '
        break
      case 'ident':
        if (!isPlainName(part.value, true)) return undefined
        out += part.value
        break
      case 'hash':
        if (!isPlainName(part.value, false)) return undefined
        out += `#${part.value}`
        break
      case ',':
        out += ','
        break
      case 'delim':
        if (!['*', '>', '+', '.'].includes(part.value)) return undefined
        out += part.value
        break
      case ':': {
        const next = list[++i]
        if (next?.type === 'ident' && CSS_PSEUDOS.has(next.value.toLowerCase()))
          out += `:${next.value.toLowerCase()}`
        else if (next?.type === 'fn' && next.name.toLowerCase() === 'lang') {
          const args = trim(next.args)
          const [only] = args
          if (args.length !== 1 || only?.type !== 'ident' || !isPlainName(only.value, true))
            return undefined
          out += `:lang(${only.value})`
        } else return undefined
        break
      }
      case 'block': {
        if (part.open !== '[') return undefined
        const written = attributeSelector(trim(part.items))
        if (written === undefined) return undefined
        out += written
        break
      }
      default:
        return undefined
    }
  }
  const trimmed = out.trim()
  return trimmed === '' ? undefined : trimmed
}

function attributeSelector(items: readonly Component[]): string | undefined {
  const [name, ...rest] = items
  if (name?.type !== 'ident' || !isPlainName(name.value, true)) return undefined
  const after = trim(rest)
  if (after.length === 0) return `[${name.value}]`
  let operator = ''
  let index = 0
  const first = after[0]
  const second = after[1]
  if (first?.type === 'delim' && first.value === '=') {
    operator = '='
    index = 1
  } else if (
    first?.type === 'delim' &&
    (first.value === '~' || first.value === '|') &&
    second?.type === 'delim' &&
    second.value === '='
  ) {
    operator = `${first.value}=`
    index = 2
  } else return undefined
  const operand = trim(after.slice(index))
  const [only] = operand
  if (only?.type === 'ident' && operand.length === 1 && isPlainName(only.value, true))
    return `[${name.value}${operator}${only.value}]`
  if (only?.type === 'string' && operand.length === 1)
    return `[${name.value}${operator}${quote(only.value)}]`
  return undefined
}

/** `@media`'s list of media written back out, or undefined if it names anything but screen and print. */
function mediaList(list: readonly Component[]): string | undefined {
  const media: string[] = []
  let expectMedium = true
  for (const part of trim(list)) {
    if (part.type === 'ws') continue
    if (expectMedium && part.type === 'ident' && CSS_MEDIA.has(part.value.toLowerCase())) {
      media.push(part.value.toLowerCase())
      expectMedium = false
    } else if (!expectMedium && part.type === ',') expectMedium = true
    else return undefined
  }
  return media.length === 0 || expectMedium ? undefined : media.join(', ')
}

function rules(list: readonly Component[], context: CssContext, nested: boolean): string[] {
  const out: string[] = []
  let i = 0
  while (i < list.length) {
    const part = list[i]
    if (part === undefined) break
    if (part.type === 'ws' || part.type === 'cdo' || part.type === 'cdc') {
      i++
      continue
    }
    if (part.type === 'at-keyword') {
      const prelude: Component[] = []
      let block: Block | undefined
      i++
      for (; i < list.length; i++) {
        const next = list[i]
        if (next === undefined || next.type === ';') break
        if (next.type === 'block' && next.open === '{') {
          block = next
          break
        }
        prelude.push(next)
      }
      i++
      const name = part.value.toLowerCase()
      const media =
        name === 'media' && !nested && block !== undefined ? mediaList(prelude) : undefined
      if (media === undefined || block === undefined) {
        context.report({ what: 'property', name: `@${name}` }, part.at)
        continue
      }
      const inner = rules(block.items, context, true)
      if (inner.length > 0) out.push(`@media ${media} {\n${inner.join('\n')}\n}`)
      continue
    }
    const prelude: Component[] = []
    let block: Block | undefined
    for (; i < list.length; i++) {
      const next = list[i]
      if (next === undefined) break
      if (next.type === 'block' && next.open === '{') {
        block = next
        break
      }
      prelude.push(next)
    }
    i++
    const written = selector(trim(prelude))
    if (block === undefined || written === undefined) {
      context.report({ what: 'property', name: 'selector' }, part.at)
      continue
    }
    const body = declarations(block.items, context)
    if (body !== '') out.push(`${written} { ${body} }`)
  }
  return out
}

/** A `style` attribute's declarations, with everything off the allowlist dropped. */
export function sanitizeDeclarations(text: string, context: CssContext): string {
  return declarations(components(tokenize(text)), context)
}

/** A `<style>` element's sheet, with everything off the allowlist dropped. */
export function sanitizeStylesheet(text: string, context: CssContext): string {
  return rules(components(tokenize(text)), context, false).join('\n')
}
