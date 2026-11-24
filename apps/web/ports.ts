// The ports this checkout's dev server and e2e server listen on. Each checkout (a worktree, a
// second clone) gets its own pair, picked from its path, so two can run side by side and an e2e
// run never reuses another checkout's server. The same checkout always gets the same ports, so
// its origin, and the dev identity kept in IndexedDB for it, stays put. PIGEON_PORT and
// PIGEON_E2E_PORT override them.
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const checkout = fileURLToPath(new URL('../..', import.meta.url))
const offset = createHash('sha256').update(checkout).digest().readUInt16BE(0) % 400

const port = (name: string, fallback: number): number => {
  const value = process.env[name]
  if (value === undefined || value === '') return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`${name} must be a port number, not "${value}"`)
  }
  return parsed
}

/** `mise run dev`: 5200 to 5599. */
export const devPort = port('PIGEON_PORT', 5200 + offset)
/** `mise run e2e`: 5600 to 5999, the same offset as the dev port. */
export const e2ePort = port('PIGEON_E2E_PORT', 5600 + offset)
