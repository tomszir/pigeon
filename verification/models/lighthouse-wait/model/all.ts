// `node --test model/` runs this folder as one module: it loads every test file in turn.
// For one process per file, use `node --test model/*.test.ts`.
await import('./explore.test.ts')
await import('./letters.test.ts')
await import('./fetch.test.ts')
await import('./conformance.test.ts')
await import('./wait.test.ts')

export {}
