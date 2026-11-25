// The Node Lighthouse's MailStore: the shared SQL store (@pigeon/lighthouse) on node:sqlite, no
// dependency. What's stored is what the MailStore interface says, and nothing about who put or
// fetched it.
import { DatabaseSync } from 'node:sqlite'
import { createSqlStore, type MailStore, type SqlDatabase, type SqlValue } from '@pigeon/lighthouse'

/** node:sqlite as the SqlDatabase the shared store runs on. */
export function nodeSqlDatabase(db: DatabaseSync): SqlDatabase {
  const statements = new Map<string, ReturnType<DatabaseSync['prepare']>>()
  return {
    exec(query, ...values) {
      let statement = statements.get(query)
      if (statement === undefined) {
        statement = db.prepare(query)
        statements.set(query, statement)
      }
      // A statement that returns columns is read; anything else is run, and says what changed.
      if (statement.columns().length > 0)
        return {
          rows: statement.all(...values) as unknown as Readonly<Record<string, SqlValue>>[],
          changes: 0,
        }
      return { rows: [], changes: Number(statement.run(...values).changes) }
    },
  }
}

/** `path` is a file, or ':memory:' for a store that forgets on restart. */
export function createSqliteStore(path: string): MailStore & { close(): void } {
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL')
  return { ...createSqlStore(nodeSqlDatabase(db)), close: () => db.close() }
}
