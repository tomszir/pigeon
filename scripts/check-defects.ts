// Usage: node scripts/check-defects.ts [name ...]
//
// Shows that the checks catch what they're for. Each patch in verification/defects/ (or the
// ones named) is applied on its own, its package is typechecked, and its test file is run; the
// defect has to make a test whose name holds its `expect` text fail (scripts/defects.ts). Before
// any of that, every test file is run once on the code as it is, and has to pass, so a failure
// later is the defect's and not one already there.
//
// It refuses to start when a file a patch touches has uncommitted changes, since it puts the code
// back by checking those files out again from HEAD after each defect, and also when it stops
// early: on an error, on exit, or on Ctrl-C. So a weakened file is never left behind, but an edit
// made to one of those files while it runs is lost. A patch that no longer applies fails the
// run: a defect that has quietly stopped being planted checks nothing.
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { caught, type Defect, outcomes, parseDefect } from './defects.ts'

const WORKSPACE = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DEFECTS = join(WORKSPACE, 'verification/defects')

const git = (...args: string[]) =>
  execFileSync('git', args, { cwd: WORKSPACE, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

function fail(message: string): never {
  console.error(`✗ ${message}`)
  process.exit(1)
}

const wanted = process.argv.slice(2)
const defects: { defect: Defect; patch: string; touched: string[] }[] = []
for (const file of readdirSync(DEFECTS)
  .filter((name) => name.endsWith('.patch'))
  .sort()) {
  const name = file.replace(/\.patch$/, '')
  if (wanted.length > 0 && !wanted.includes(name)) continue
  const patch = join(DEFECTS, file)
  const parsed = parseDefect(name, readFileSync(patch, 'utf8'))
  if (!('name' in parsed)) fail(parsed.join('\n✗ '))
  defects.push({ defect: parsed, patch, touched: [] })
}
for (const name of wanted)
  if (!defects.some(({ defect }) => defect.name === name)) fail(`no defect named ${name}`)
if (defects.length === 0) fail('no defects to plant')

// Every patch must apply to the code as it is, onto files with nothing uncommitted.
for (const entry of defects) {
  const { defect, patch } = entry
  try {
    git('apply', '--check', patch)
  } catch {
    fail(`${defect.name} no longer applies: update the patch to plant the same defect`)
  }
  const touched = git('apply', '--numstat', patch)
    .trim()
    .split('\n')
    .map((line) => line.split('\t')[2] ?? '')
  if (git('status', '--porcelain', '--', ...touched).trim() !== '')
    fail(`${defect.name} touches files with uncommitted changes: ${touched.join(', ')}`)
  entry.touched = touched
}

const scratch = mkdtempSync(join(tmpdir(), 'pigeon-defects-'))

/** The files a planted defect has changed, until they're put back. */
let planted: readonly string[] = []

/**
 * Puts back what a defect changed, in the working tree and the index: those files matched HEAD
 * before the run, so HEAD holds what they were, even if something staged them meanwhile.
 */
function restore() {
  if (planted.length > 0) git('checkout', 'HEAD', '--', ...planted)
  planted = []
}

process.on('exit', () => {
  restore()
  rmSync(scratch, { recursive: true, force: true })
})
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const)
  process.on(signal, () => {
    console.error(`✗ stopped by ${signal}; the code is put back`)
    process.exit(130)
  })

/** Runs a command in a package folder; a child stopped by a signal stops the whole run. */
function run(dir: string, args: string[], stderr: 'pipe' | 'inherit') {
  const child = spawnSync('pnpm', args, {
    cwd: join(WORKSPACE, dir),
    stdio: ['ignore', 'pipe', stderr],
    encoding: 'utf8',
  })
  if (child.signal !== null) {
    console.error(`✗ ${args.join(' ')} was stopped by ${child.signal}; the code is put back`)
    process.exit(130)
  }
  return { ok: child.status === 0, output: `${child.stdout ?? ''}${child.stderr ?? ''}` }
}

/** Runs one test file with Vitest's JSON reporter and returns every test's outcome. */
function runTests(dir: string, testFile: string) {
  const out = join(scratch, 'report.json')
  rmSync(out, { force: true })
  run(dir, ['exec', 'vitest', 'run', testFile, '--reporter=json', `--outputFile=${out}`], 'inherit')
  try {
    return outcomes(JSON.parse(readFileSync(out, 'utf8')))
  } catch (error) {
    fail(`${dir} ${testFile}: no test report (${(error as Error).message})`)
  }
}

const typecheck = (dir: string) => run(dir, ['run', 'typecheck'], 'pipe')
const tail = (output: string) => output.trim().split('\n').slice(-15).join('\n  ')

let survived = 0
{
  // The control run: each package typechecks and each test file passes on the code as it is,
  // so a failure later is the defect's. (A fresh clone's web app doesn't typecheck until the
  // WebAssembly is built, which `pnpm -r typecheck` does.)
  for (const dir of new Set(defects.map(({ defect }) => defect.dir))) {
    const checked = typecheck(dir)
    if (!checked.ok)
      fail(`control: ${dir} doesn't typecheck before any defect:\n  ${tail(checked.output)}`)
    console.log(`  control ${dir}: typechecks`)
  }
  const suites = new Map(defects.map(({ defect }) => [`${defect.dir} ${defect.testFile}`, defect]))
  for (const [suite, defect] of suites) {
    const run = runTests(defect.dir, defect.testFile)
    const failed = run.filter((test) => test.status !== 'passed')
    if (run.length === 0) fail(`control: ${suite} ran no tests`)
    if (failed.length > 0)
      fail(`control: ${suite} already fails before any defect:\n  ${failed[0]?.fullName}`)
    console.log(`  control ${suite}: ${run.length} passed`)
  }

  for (const { defect, patch, touched } of defects) {
    planted = touched
    git('apply', patch)
    try {
      const checked = typecheck(defect.dir)
      if (!checked.ok) {
        console.error(`✗ ${defect.name}: doesn't typecheck, so a failing test proves nothing:`)
        console.error(`  ${tail(checked.output)}`)
        survived += 1
        continue
      }
      const run = runTests(defect.dir, defect.testFile)
      if (caught(defect, run)) {
        const count = run.filter((test) => test.status === 'failed').length
        console.log(`✓ ${defect.name}: caught (${count} failing): ${defect.description}`)
      } else {
        console.error(`✗ ${defect.name}: survived: ${defect.description}`)
        survived += 1
      }
    } finally {
      restore()
    }
  }
}

if (survived > 0) fail(`${survived} of ${defects.length} planted defects weren't caught`)
console.log(`all ${defects.length} planted defects caught`)
