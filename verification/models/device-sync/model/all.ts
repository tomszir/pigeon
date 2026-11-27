// `node --test model/` runs this folder as one module: it loads every test file in turn.
// For one process per file, use `node --test model/*.test.ts`.
await import('./explore.test.ts')
await import('./legacy.test.ts')
await import('./chat.test.ts')
await import('./links.test.ts')
await import('./data.test.ts')
