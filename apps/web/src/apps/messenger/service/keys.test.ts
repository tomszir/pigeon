import { describe, expect, it } from 'vitest'
import { DEVICE_KEYS } from './devices.ts'
import inviteLinksSource from './invite-links.ts?raw'
import mailboxSource from './mailbox.ts?raw'
import { KEYS } from './stored.ts'

// Every part of the Messenger writes to one shared Store, each with its own table of keys. Two
// tables using the same key would overwrite each other's records, and nothing else would notice.
// This covers the four `KEYS` tables of service (stored.ts), devices, invite-links and mailbox. Keys
// named elsewhere (`letters:${friend}` in letters.ts, and the identity, sealing key and hint keys of
// the code that starts the Messenger) aren't in a table and aren't checked.

/** A key, or for one made from an id (`log:${id}`) the part before the id. */
interface Key {
  readonly name: string
  readonly prefix: boolean
}

const ID = '\u0000'

/** The keys of a table the test can import: plain strings, and functions that take an id. */
const keysOf = (table: Readonly<Record<string, string | ((id: never) => string)>>): Key[] =>
  Object.values(table).map((value) =>
    typeof value === 'string'
      ? { name: value, prefix: false }
      : { name: (value as (id: string) => string)(ID).split(ID)[0] ?? '', prefix: true },
  )

/**
 * The keys of a table that isn't exported, read from its source: the quoted strings it holds,
 * and the text before the id in each template string. Comments are dropped first, and the text
 * must be a whole table whose every entry was read, so a table written in a way this doesn't
 * understand fails here, not silently as fewer keys.
 */
const keysInSource = (source: string, table: string): Key[] => {
  const start = source.indexOf(`const ${table} = {`)
  expect(start, `${table} not found`).toBeGreaterThanOrEqual(0)
  const end = source.indexOf('} as const', start)
  expect(end, `${table} has no closing "} as const"`).toBeGreaterThan(start)
  const body = source
    .slice(start, end)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
  const keys = [
    ...[...body.matchAll(/:\s*'([^']+)'/g)].map((match) => ({
      name: match[1] ?? '',
      prefix: false,
    })),
    ...[...body.matchAll(/=>\s*`([^`$]*)\$\{/g)].map((match) => ({
      name: match[1] ?? '',
      prefix: true,
    })),
  ]
  const entries = [...body.matchAll(/^\s*[A-Za-z_]\w*\s*:/gm)].length
  expect(keys.length, `${table}: ${entries} entries, ${keys.length} keys read`).toBe(entries)
  return keys
}

const collide = (a: Key, b: Key) =>
  a.name === b.name ||
  (a.prefix && b.name.startsWith(a.name)) ||
  (b.prefix && a.name.startsWith(b.name))

describe('storage keys', () => {
  const tables = {
    service: keysOf(KEYS),
    devices: keysOf(DEVICE_KEYS),
    'invite-links': keysInSource(inviteLinksSource, 'KEYS'),
    mailbox: keysInSource(mailboxSource, 'KEYS'),
  }

  it('reads every table whole', () => {
    // A table that came back short would make the check below pass for nothing. These counts are
    // each table's keys today: adding a key to a table means raising its number here.
    expect(tables.service).toHaveLength(17)
    expect(tables.devices).toHaveLength(5)
    expect(tables['invite-links']).toHaveLength(3)
    expect(tables.mailbox).toHaveLength(3)
  })

  it('has no key two tables share', () => {
    const named = Object.entries(tables).flatMap(([table, keys]) =>
      keys.map((key) => ({ ...key, table })),
    )
    const shared = named.flatMap((a, i) =>
      named
        .slice(i + 1)
        .filter((b) => collide(a, b))
        .map((b) => `${a.table}:${a.name} and ${b.table}:${b.name}`),
    )
    expect(shared).toEqual([])
  })
})
