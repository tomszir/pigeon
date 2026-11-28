// What chat and device-log entries are signed over, in each form, and what each release signs
// and takes: written from docs/protocol.md and verification/specs/signed-entries.md, not from
// the code. A signature here is what it is over, by whom; a verifier takes it for an entry when
// a form it takes builds those very bytes from the entry's fields.

/** Canonical JSON as protocol.md has it: object keys sorted, no spaces, JSON's own primitives. */
export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const record = value as Record<string, unknown>
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`
}

export type Form = 'untyped' | 'typed'
export const FORMS: readonly Form[] = ['untyped', 'typed']

export interface ChatFields {
  readonly log: string
  readonly author: string
  readonly seq: number
  readonly lamport: number
  readonly at: number
  readonly text: string
}

export type DeviceKind = 'add' | 'remove' | 'name'

export interface DeviceFields {
  readonly identity: string
  readonly epoch: number
  readonly seq: number
  readonly prev: string
  readonly kind: DeviceKind
  readonly device: string
  readonly name?: string
  readonly at: number
}

export type Entry =
  | { readonly kind: 'chat'; readonly fields: ChatFields }
  | { readonly kind: 'device'; readonly fields: DeviceFields }

/** Who signs an entry: a chat entry's author, a device-log entry's epoch's writer. */
export type Writer = (entry: Entry) => string

/** The rules the model checks; a planted defect turns one off. */
export interface Rules {
  /** The `v` a typed chat entry names. */
  readonly chatContext: string
  /** The `v` a typed device-log entry names. */
  readonly deviceContext: string
  /** The `v` the current release signs a device-log entry with, which every taker knows. */
  readonly signsKnownContext: boolean
  /** The current release takes the untyped form too. */
  readonly takesUntyped: boolean
  /** A typed device-log entry's bytes carry its kind. */
  readonly typedHasKind: boolean
  /** A chat entry's bytes carry its chat's id. */
  readonly bindsLog: boolean
}

export const RULES: Rules = {
  chatContext: 'pigeon/chat-entry/v1',
  deviceContext: 'pigeon/device-entry/v1',
  signsKnownContext: true,
  takesUntyped: true,
  typedHasKind: true,
  bindsLog: true,
}

/** An entry's bytes in one form, as a verifier builds them. */
export function bytes(entry: Entry, form: Form, rules: Rules = RULES): string {
  if (entry.kind === 'chat') {
    const { log, author, seq, lamport, at, text } = entry.fields
    const fields = { ...(rules.bindsLog ? { log } : {}), author, seq, lamport, at, text }
    return canonical(form === 'typed' ? { v: rules.chatContext, ...fields } : fields)
  }
  const { identity, epoch, seq, prev, kind, device, name, at } = entry.fields
  const fields = { identity, seq, prev, kind, device, ...(name === undefined ? {} : { name }), at }
  if (form === 'untyped') return canonical(epoch === 0 ? fields : { epoch, ...fields })
  const { kind: _kind, ...kindless } = fields
  return canonical({
    v: rules.deviceContext,
    epoch,
    ...(rules.typedHasKind ? fields : kindless),
  })
}

export interface Release {
  readonly version: string
  readonly signs: Form
  readonly takes: readonly Form[]
}

/** Each release by what it signs and takes; a tab keeps the one it loaded until it reloads. */
export const RELEASES: readonly Release[] = [
  { version: '0.8.1', signs: 'untyped', takes: ['untyped'] },
  { version: '0.8.2', signs: 'untyped', takes: ['untyped', 'typed'] },
  { version: '0.8.3', signs: 'untyped', takes: ['untyped', 'typed'] },
  { version: '0.8.4', signs: 'typed', takes: ['untyped', 'typed'] },
]

export const CURRENT = '0.8.4'
/** The first release that takes the typed form. */
export const FIRST_TYPED_TAKER = '0.8.2'

export const releaseOf = (version: string): Release => {
  const found = RELEASES.find((release) => release.version === version)
  if (found === undefined) throw new Error(`no release ${version}`)
  return found
}

/** Release `a` is `b` or later. */
export const atLeast = (a: string, b: string): boolean =>
  RELEASES.findIndex((r) => r.version === a) >= RELEASES.findIndex((r) => r.version === b)

/** A signature: by whom, over what. */
export interface Signature {
  readonly by: string
  readonly over: string
}

/** What `version` signs `entry` as, by `writer`. */
export function sign(
  version: string,
  entry: Entry,
  writer: Writer,
  rules: Rules = RULES,
): Signature {
  const form = releaseOf(version).signs
  // The defect: a context of its own, which no release takes.
  const own =
    version === CURRENT && !rules.signsKnownContext
      ? { ...rules, chatContext: 'pigeon/chat-entry/v2', deviceContext: 'pigeon/device-entry/v2' }
      : rules
  return { by: writer(entry), over: bytes(entry, form, own) }
}

/** Whether `version` takes `signature` as `entry`'s. */
export function takes(
  version: string,
  entry: Entry,
  signature: Signature,
  writer: Writer,
  rules: Rules = RULES,
): boolean {
  if (signature.by !== writer(entry)) return false
  const forms = releaseOf(version).takes.filter(
    (form) => form === 'typed' || version !== CURRENT || rules.takesUntyped,
  )
  return forms.some((form) => bytes(entry, form, rules) === signature.over)
}

/** Shapes of what else Pigeon signs: each carries a `v` of its own, or a `type`. */
export const OTHER_SIGNED: readonly string[] = [
  canonical({ v: 'pigeon/letter/v1', from: 'a', to: 'b', at: 1 }),
  canonical({ v: 1, from: 'a', room: 'r', at: 1, body: 'x' }),
  canonical({ identity: 'i', type: 'recovery-key', key: 'k', at: 1 }),
  canonical({ identity: 'i', type: 'recover', epoch: 1, writer: 'w', keep: [], next: 'n', at: 1 }),
]
