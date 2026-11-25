// The one config file a Lighthouse runs from, JSON so it needs no parser:
//   { "name": "Ada's Lighthouse", "port": 8787, "url": "wss://lighthouse.example.ts.net/" }
// Everything but `name` and `url` has a default. Paths are relative to the config file.
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { MAX_LIGHTHOUSE_NAME_LENGTH } from '@pigeon/core'
import { DEFAULT_LIMITS, type Limits } from '@pigeon/lighthouse'

export interface LighthouseConfig {
  /** Its name, shown beside its fingerprint. */
  readonly name: string
  /** The wss:// URL people reach it at, for the address it prints. */
  readonly url: string
  readonly host: string
  readonly port: number
  /** Its key: made on first start, never replaced. */
  readonly keyFile: string
  /** The SQLite file mail is kept in. */
  readonly database: string
  /** A personal Lighthouse's pass. */
  readonly pass?: string | undefined
  /**
   * Take the client's address from X-Forwarded-For. Only behind a proxy that sets it, such as
   * Tailscale Funnel; otherwise anyone could claim any address and dodge the limits.
   */
  readonly trustForwardedFor: boolean
  readonly limits: Limits
}

type Fields = Record<string, unknown>

const text = (fields: Fields, key: string, fallback?: string): string => {
  const value = fields[key] ?? fallback
  if (typeof value !== 'string' || value.trim() === '')
    throw new Error(`config: "${key}" is needed`)
  return value
}

const count = (fields: Fields, key: string, fallback: number): number => {
  const value = fields[key] ?? fallback
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new Error(`config: "${key}" must be a whole number`)
  return value
}

/** Reads and checks a config; a mistake is an error naming the field, never a guess. */
export function parseConfig(json: string, base: string): LighthouseConfig {
  const fields = JSON.parse(json) as unknown
  if (typeof fields !== 'object' || fields === null || Array.isArray(fields))
    throw new Error('config: expected an object')
  const f = fields as Fields
  const name = text(f, 'name').trim()
  if (name.length > MAX_LIGHTHOUSE_NAME_LENGTH)
    throw new Error(`config: "name" is longer than ${MAX_LIGHTHOUSE_NAME_LENGTH}`)
  const url = text(f, 'url')
  if (!/^wss?:\/\//.test(url)) throw new Error('config: "url" must be a ws:// or wss:// URL')
  const port = count(f, 'port', 8787)
  if (port > 65535) throw new Error('config: "port" is out of range')
  const limits = (f['limits'] ?? {}) as Fields
  const pass = f['pass']
  if (pass !== undefined && (typeof pass !== 'string' || pass === ''))
    throw new Error('config: "pass" must be text')
  return {
    name,
    url,
    host: text(f, 'host', '0.0.0.0'),
    port,
    keyFile: resolve(base, text(f, 'keyFile', 'lighthouse.key')),
    database: resolve(base, text(f, 'database', 'lighthouse.sqlite')),
    pass: pass as string | undefined,
    trustForwardedFor: f['trustForwardedFor'] === true,
    // Each limit as given, or its default: every one is a whole number.
    limits: Object.fromEntries(
      Object.entries(DEFAULT_LIMITS).map(([key, fallback]) => [key, count(limits, key, fallback)]),
    ) as unknown as Limits,
  }
}

export async function readConfig(path: string): Promise<LighthouseConfig> {
  return parseConfig(await readFile(path, 'utf8'), dirname(resolve(path)))
}
