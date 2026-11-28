// Planted defects: patches under verification/defects/ that each break one thing a check is
// there to catch. A patch file starts with a header, then the diff, which `git apply` reads
// past the header:
//
//   defect: isCanonicalSignature takes an Ed25519 S at or past the group order
//   test: apps/web src/platform/crypto/crypto-contract.test.ts
//   expect: own-refusal ed25519
//
// `test` is the package folder and the test file to run there; `expect` is text that the full
// name of at least one failing test must contain, so a defect only counts as caught when the
// check meant for it fails, not when something else breaks.

export interface Defect {
  readonly name: string
  readonly description: string
  readonly dir: string
  readonly testFile: string
  readonly expect: string
}

/** The defect a patch file describes, or a list of what its header gets wrong. */
export function parseDefect(name: string, text: string): Defect | readonly string[] {
  const header = new Map<string, string>()
  for (const line of text.split('\n')) {
    if (line.startsWith('diff --git ')) break
    const match = /^(defect|test|expect): (.+)$/.exec(line)
    if (match?.[1] !== undefined && match[2] !== undefined) header.set(match[1], match[2].trim())
  }
  const errors: string[] = []
  for (const key of ['defect', 'test', 'expect'])
    if (!header.has(key)) errors.push(`${name}: no "${key}:" line in its header`)
  if (!text.includes('\ndiff --git ')) errors.push(`${name}: no diff after its header`)
  const test = (header.get('test') ?? '').split(/\s+/)
  if (header.has('test') && test.length !== 2)
    errors.push(`${name}: "test:" needs a package folder and a test file`)
  if (errors.length > 0) return errors
  return {
    name,
    description: header.get('defect') ?? '',
    dir: test[0] ?? '',
    testFile: test[1] ?? '',
    expect: header.get('expect') ?? '',
  }
}

/** One test from Vitest's JSON report. */
export interface TestOutcome {
  readonly fullName: string
  readonly status: string
}

/** Every test in a Vitest JSON report, flattened. */
export function outcomes(report: unknown): readonly TestOutcome[] {
  const files = (report as { testResults?: unknown }).testResults
  if (!Array.isArray(files)) throw new Error('not a Vitest JSON report: no testResults')
  return files.flatMap((file) => {
    const tests = (file as { assertionResults?: unknown }).assertionResults
    if (!Array.isArray(tests)) throw new Error('not a Vitest JSON report: no assertionResults')
    return tests.map((test) => {
      const { fullName, status } = test as { fullName?: unknown; status?: unknown }
      return { fullName: String(fullName), status: String(status) }
    })
  })
}

/**
 * Whether a run caught the defect: some failing test's name holds `expect`. A run with no tests
 * at all, or one where nothing failed, didn't.
 */
export function caught(defect: Defect, run: readonly TestOutcome[]): boolean {
  return run.some((test) => test.status === 'failed' && test.fullName.includes(defect.expect))
}
