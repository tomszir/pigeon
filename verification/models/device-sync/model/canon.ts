// One spelling for a state, so two states that are the same hash the same: object keys sorted,
// arrays kept in the order the model keeps them (the model sorts the ones whose order means
// nothing).

export function canon(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(canon).join(',')}]`
  const record = value as Record<string, unknown>
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canon(record[key])}`).join(',')}}`
}

/** A deep copy of plain data: states are never changed in place. */
export const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

export const sorted = <T>(items: readonly T[]): T[] => [...items].sort()

export const uniq = <T>(items: readonly T[]): T[] => [...new Set(items)].sort()
