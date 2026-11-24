// Vendors the files a lock in vendor/ names into an output folder, from their pinned sources:
// an npm package at a version, a URL, or a folder in this repository. Every download's sha512 must
// match the lock. The output folder is replaced, so review the diff like any other change.
//
//   node scripts/vendor.mjs vendor/fonts.lock.json apps/web/src/fonts
//
// A lock has `sources` and a list of entries (`files` or `icons`). An entry names a source and may
// carry `path` and `out`, or template variables ({icon}, {context}, {size} from each of `sizes`)
// that fill the source's own `path` and `out`. A source's `licence` is copied once.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const WORKSPACE = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const [lockPath, outPath] = process.argv.slice(2)
if (lockPath === undefined || outPath === undefined) {
  console.error('usage: node scripts/vendor.mjs <lock.json> <output folder>')
  process.exit(2)
}

const lock = JSON.parse(readFileSync(resolve(WORKSPACE, lockPath), 'utf8'))
const out = resolve(WORKSPACE, outPath)
const scratch = mkdtempSync(join(tmpdir(), 'pigeon-vendor-'))

const sri = (bytes) => `sha512-${createHash('sha512').update(bytes).digest('base64')}`

function verify(id, bytes, integrity) {
  const actual = sri(bytes)
  if (actual !== integrity) throw new Error(`${id}: integrity ${actual} does not match the lock`)
}

/** Downloads or locates one source and returns the folder (or file) its paths are relative to. */
async function fetchSource(id, source) {
  if (source.local !== undefined) return resolve(WORKSPACE, source.local)

  const dir = join(scratch, id.replace(/[^a-z0-9.-]/gi, '_'))
  mkdirSync(dir)
  let file
  if (source.package !== undefined) {
    execFileSync(
      'npm',
      ['pack', `${source.package}@${source.version}`, '--pack-destination', dir, '--silent'],
      { stdio: ['ignore', 'pipe', 'inherit'] },
    )
    const name = readdirSync(dir).find((entry) => entry.endsWith('.tgz'))
    if (name === undefined) throw new Error(`${id}: npm pack produced no tarball`)
    file = join(dir, name)
  } else {
    const response = await fetch(source.url)
    if (!response.ok) throw new Error(`${id}: ${source.url} answered ${response.status}`)
    file = join(dir, 'download')
    writeFileSync(file, Buffer.from(await response.arrayBuffer()))
  }
  verify(id, readFileSync(file), source.integrity)

  if (source.archive === undefined) return file
  execFileSync('tar', ['xf', file, '-C', dir])
  return join(dir, source.archive)
}

const fill = (template, vars) =>
  template.replace(/\{(\w+)\}/g, (_, key) => {
    const value = vars[key]
    if (value === undefined) throw new Error(`template ${template} needs {${key}}`)
    return String(value)
  })

/** Every (source, path, out) copy the lock asks for. */
function copies(lock) {
  const result = []
  for (const entry of [...(lock.files ?? []), ...(lock.icons ?? [])]) {
    const source = lock.sources[entry.source]
    if (source === undefined) throw new Error(`unknown source ${entry.source}`)
    for (const size of entry.sizes ?? [undefined]) {
      const vars = { ...entry, size }
      const path = entry.path ?? (source.path === undefined ? '' : fill(source.path, vars))
      result.push({ id: entry.source, path, out: entry.out ?? fill(source.out, vars) })
    }
  }
  for (const [id, source] of Object.entries(lock.sources)) {
    if (source.licence !== undefined) result.push({ id, ...source.licence })
  }
  return result
}

try {
  const roots = {}
  for (const [id, source] of Object.entries(lock.sources)) roots[id] = await fetchSource(id, source)

  rmSync(out, { recursive: true, force: true })
  for (const copy of copies(lock)) {
    const from = copy.path === '' ? roots[copy.id] : join(roots[copy.id], copy.path)
    const to = join(out, copy.out)
    mkdirSync(dirname(to), { recursive: true })
    copyFileSync(from, to)
  }
  const sources = Object.keys(lock.sources).join(', ')
  console.log(`vendored ${copies(lock).length} files from ${sources} into ${outPath}`)
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
