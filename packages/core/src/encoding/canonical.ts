// Canonical JSON: the one byte string a value signs as. Object keys are sorted and only
// JSON-safe values are allowed, so two peers always sign and verify the same bytes.
import { utf8Encode } from './bytes.ts'

export type Json =
  | string
  | number
  | boolean
  | null
  | readonly Json[]
  | { readonly [key: string]: Json }

export function canonicalJson(value: Json): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string')
    return JSON.stringify(value)
  if (typeof value === 'number') {
    // Bugs, not input: callers validate numbers before signing them.
    if (!Number.isFinite(value)) throw new Error('canonicalJson: non-finite number')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const object = value as { readonly [key: string]: Json }
  const keys = Object.keys(object).sort()
  const fields: string[] = []
  for (const key of keys) {
    const field = object[key]
    if (field !== undefined) fields.push(`${JSON.stringify(key)}:${canonicalJson(field)}`)
  }
  return `{${fields.join(',')}}`
}

export const canonicalBytes = (value: Json): Uint8Array => utf8Encode(canonicalJson(value))
