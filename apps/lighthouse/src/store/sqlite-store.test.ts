import { describeMailStore } from '@pigeon/lighthouse/testing'
import { createSqliteStore } from './sqlite-store.ts'

describeMailStore('the SQLite store', () => createSqliteStore(':memory:'))
