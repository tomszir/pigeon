import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { caught, outcomes, parseDefect } from './defects.ts'

const DEFECTS = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'verification/defects')

const patch = (header: string) =>
  `${header}\n\ndiff --git a/x.ts b/x.ts\n--- a/x.ts\n+++ b/x.ts\n@@ -1 +1 @@\n-a\n+b\n`

test('a defect is read from its header', () => {
  const defect = parseDefect(
    'high-s',
    patch('defect: takes high-S\ntest: apps/web src/a.test.ts\nexpect: p256'),
  )
  assert.deepEqual(defect, {
    name: 'high-s',
    description: 'takes high-S',
    dir: 'apps/web',
    testFile: 'src/a.test.ts',
    expect: 'p256',
  })
})

test('a header missing a line, or a patch with no diff, is refused', () => {
  const errors = parseDefect('x', patch('defect: d\ntest: apps/web src/a.test.ts'))
  assert.ok(Array.isArray(errors) && errors.some((e) => e.includes('"expect:"')))
  const noDiff = parseDefect('x', 'defect: d\ntest: apps/web a.ts\nexpect: e\n')
  assert.ok(Array.isArray(noDiff) && noDiff.some((e) => e.includes('no diff')))
  const oneWord = parseDefect('x', patch('defect: d\ntest: apps/web\nexpect: e'))
  assert.ok(Array.isArray(oneWord) && oneWord.some((e) => e.includes('package folder')))
})

test('header-like lines inside the diff are not read as the header', () => {
  const text = `${patch('defect: d\ntest: apps/web a.ts\nexpect: real')}+expect: fake\n`
  const defect = parseDefect('x', text)
  assert.ok(!Array.isArray(defect) && 'expect' in defect && defect.expect === 'real')
})

test('a defect is caught only by a failing test with the expected name', () => {
  const defect = { name: 'x', description: '', dir: '', testFile: '', expect: 'p256' }
  assert.equal(caught(defect, [{ fullName: 'p256 tcId 1', status: 'failed' }]), true)
  assert.equal(caught(defect, [{ fullName: 'p256 tcId 1', status: 'passed' }]), false)
  assert.equal(caught(defect, [{ fullName: 'hkdf tcId 1', status: 'failed' }]), false)
  assert.equal(caught(defect, []), false)
})

test("Vitest's JSON report is flattened, and anything else is refused", () => {
  const report = {
    testResults: [{ assertionResults: [{ fullName: 'a b', status: 'failed' }] }],
  }
  assert.deepEqual(outcomes(report), [{ fullName: 'a b', status: 'failed' }])
  assert.throws(() => outcomes({}))
})

test('every planted defect in the repository has a well-formed header', () => {
  const files = readdirSync(DEFECTS).filter((name) => name.endsWith('.patch'))
  assert.ok(files.length > 0)
  for (const file of files) {
    const defect = parseDefect(file, readFileSync(join(DEFECTS, file), 'utf8'))
    assert.ok(!Array.isArray(defect), `${file}: ${JSON.stringify(defect)}`)
  }
})
