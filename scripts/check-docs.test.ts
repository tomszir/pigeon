// Runs on Node's own test runner (mise run check). It runs scripts/check-docs in small throwaway
// git repositories and checks what it reports about decision numbers and the paths docs cite.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const script = fileURLToPath(new URL('./check-docs', import.meta.url))
const dirs: string[] = []
after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

const doc = (title: string, body = '') => `# ${title}\n\nOne line about it.\n${body}`

/** The pairs check-docs allows to share a number. */
const SHARED = [
  '0039-link-previews-without-the-inviter.md',
  '0039-messages-through-lighthouses.md',
  '0040-a-content-security-policy-from-headers.md',
  '0040-minor-versions-for-bigger-features.md',
]

/** A committed repository holding `files`, plus a docs/README.md that lists them all. */
function repo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'pigeon-docs-'))
  dirs.push(dir)
  const all: Record<string, string> = {
    'docs/README.md': doc(
      'Docs',
      '\n- [decisions/](decisions/)\n- architecture.md\n- verification.md\n- protocol.md\n',
    ),
    'docs/architecture.md': doc('Architecture'),
    'docs/verification.md': doc('Verification'),
    'docs/protocol.md': doc('Protocol'),
    ...files,
  }
  for (const [path, content] of Object.entries(all)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    writeFileSync(join(dir, path), content)
  }
  mkdirSync(join(dir, 'scripts'), { recursive: true })
  copyFileSync(script, join(dir, 'scripts', 'check-docs'))
  git(dir, 'init', '-q')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', 'start')
  return dir
}

function git(dir: string, ...args: string[]): void {
  spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], {
    cwd: dir,
    encoding: 'utf8',
  })
}

/** Writes a file into a repository made by `repo`, without committing it. */
function write(dir: string, path: string, content: string): void {
  mkdirSync(dirname(join(dir, path)), { recursive: true })
  writeFileSync(join(dir, path), content)
}

function check(dir: string, ...args: string[]): { ok: boolean; report: string } {
  const run = spawnSync('sh', ['scripts/check-docs', ...args], { cwd: dir, encoding: 'utf8' })
  return { ok: run.status === 0, report: run.stderr }
}

const record = (name: string) => [`docs/decisions/${name}`, doc(name)] as const

describe('check-docs: decision numbers', () => {
  it('passes when every record has its own number', () => {
    const dir = repo(
      Object.fromEntries([record('0001-first.md'), record('0002-second.md'), record('0059-a.md')]),
    )
    assert.deepEqual(check(dir), { ok: true, report: '' })
  })

  it('fails when two records share a number, naming both', () => {
    const dir = repo(
      Object.fromEntries([record('0001-first.md'), record('0002-a.md'), record('0002-b.md')]),
    )
    const { ok, report } = check(dir)
    assert.equal(ok, false)
    assert.match(report, /docs\/decisions\/0002-a\.md shares the number 0002/)
    assert.match(report, /docs\/decisions\/0002-b\.md shares the number 0002/)
  })

  it('allows the pairs numbered in parallel, by name', () => {
    const dir = repo(Object.fromEntries(SHARED.map(record)))
    assert.deepEqual(check(dir), { ok: true, report: '' })
  })

  it('fails on a third record with an allowed number, naming only the new one', () => {
    const dir = repo(Object.fromEntries([...SHARED, '0039-another.md'].map(record)))
    const { ok, report } = check(dir)
    assert.equal(ok, false)
    assert.match(report, /0039-another\.md shares the number 0039/)
    assert.doesNotMatch(report, /0039-messages-through-lighthouses\.md shares/)
    assert.doesNotMatch(report, /0040-/)
  })

  it('fails when a pair that is not allowed shares a number beside the allowed ones', () => {
    const dir = repo(Object.fromEntries([...SHARED, '0041-a.md', '0041-b.md'].map(record)))
    const { ok, report } = check(dir)
    assert.equal(ok, false)
    assert.match(report, /0041-a\.md shares/)
  })
})

describe('check-docs: paths the docs cite', () => {
  for (const name of ['architecture', 'verification']) {
    const path = `docs/${name}.md`

    it(`passes when ${name}.md cites files and folders that exist`, () => {
      const dir = repo({
        'packages/core/src/index.ts': '',
        'scripts/tool.ts': '',
        [path]: doc(
          name,
          '\nSee `packages/core/src/index.ts`, `scripts/tool.ts:12` and `packages/core/`.\n',
        ),
      })
      assert.deepEqual(check(dir), { ok: true, report: '' })
    })

    it(`fails when ${name}.md cites a file that does not exist`, () => {
      const dir = repo({
        'packages/core/src/index.ts': '',
        [path]: doc(name, '\nThe rules are in `packages/core/src/gone.ts`.\n'),
      })
      const { ok, report } = check(dir)
      assert.equal(ok, false)
      assert.match(
        report,
        new RegExp(`${path} cites packages/core/src/gone\\.ts, which does not exist`),
      )
    })

    it(`fails when ${name}.md links to a file that does not exist`, () => {
      const dir = repo({ [path]: doc(name, '\nSee [the glossary](glossary.md#words).\n') })
      const { ok, report } = check(dir)
      assert.equal(ok, false)
      assert.match(report, /cites docs\/glossary\.md, which does not exist/)
    })

    it(`reads a link in ${name}.md from the doc's own folder`, () => {
      const dir = repo({
        'docs/glossary.md': doc('Glossary'),
        'docs/README.md': doc(
          'Docs',
          '\n- [decisions/](decisions/)\n- architecture.md\n- verification.md\n- protocol.md\n- glossary.md\n',
        ),
        [path]: doc(
          name,
          '\nSee [the glossary](glossary.md#words) and [the web](https://example.com/x).\n',
        ),
      })
      assert.deepEqual(check(dir), { ok: true, report: '' })
    })

    it(`skips placeholders and bare names in ${name}.md`, () => {
      const dir = repo({
        [path]: doc(
          name,
          '\n`apps/<name>/`, `packages/*`, `apps/<app>/<component>/`, `window/window.tsx`, `index.ts`, `@pigeon/core`.\n',
        ),
      })
      assert.deepEqual(check(dir), { ok: true, report: '' })
    })
  }

  it('does not read the paths other docs cite', () => {
    const dir = repo({
      'docs/protocol.md': doc('Protocol', '\nSee `packages/core/src/gone.ts`.\n'),
    })
    assert.deepEqual(check(dir), { ok: true, report: '' })
  })
})

describe('check-docs: what is read as a path', () => {
  const clean = (body: string) =>
    repo({
      'packages/core/src/index.ts': '',
      'scripts/tool.ts': '',
      'docs/glossary.md': doc('Glossary'),
      'docs/README.md': doc(
        'Docs',
        '\n- [decisions/](decisions/)\n- architecture.md\n- verification.md\n- protocol.md\n- glossary.md\n',
      ),
      'docs/architecture.md': doc('Architecture', body),
    })

  it('ignores code that has a link in it, and fenced blocks', () => {
    const dir = clean(
      [
        '',
        'Call `handlers[kind](frame)` or `table[key](value)`.',
        '',
        '```',
        'packages/core/src/gone.ts',
        'see [x](gone.md) and `packages/core/src/gone.ts`',
        '```',
        '',
        '~~~',
        '`scripts/gone.ts`',
        '~~~',
        '',
      ].join('\n'),
    )
    assert.deepEqual(check(dir), { ok: true, report: '' })
  })

  it('still reads a link after code on the same line', () => {
    const dir = clean('\nUse `a[b](c)`, then [the missing one](gone.md).\n')
    const { ok, report } = check(dir)
    assert.equal(ok, false)
    assert.match(report, /cites docs\/gone\.md, which does not exist/)
    assert.doesNotMatch(report, /a\[b\]/)
  })

  it('does not count a suffix as part of a path that exists', () => {
    const dir = clean(
      [
        '',
        '`packages/core/src/index.ts:12`, `packages/core/src/index.ts:12:5`,',
        '`packages/core/src/index.ts:12-20`, `packages/core/src/index.ts?raw`,',
        '`packages/core/src/index.ts#exports`, `./scripts/tool.ts`, [t](./glossary.md#words),',
        '[g](glossary.md?plain), [s](../scripts/tool.ts:3).',
        '',
      ].join('\n'),
    )
    assert.deepEqual(check(dir), { ok: true, report: '' })
  })

  it('still fails a missing path that has a suffix, naming it without the suffix', () => {
    const dir = clean('\n`packages/core/src/gone.ts:12:5` and `scripts/gone.ts?raw`.\n')
    const { ok, report } = check(dir)
    assert.equal(ok, false)
    assert.match(report, /cites packages\/core\/src\/gone\.ts, which does not exist/)
    assert.match(report, /cites scripts\/gone\.ts, which does not exist/)
  })

  it("reads the web app's own folders from apps/web/src", () => {
    const dir = repo({
      'apps/web/src/ui/window/window.tsx': '',
      'apps/web/src/app/browser-env.ts': '',
      'apps/web/src/platform/clock/clock.ts': '',
      'apps/web/src/shell/stage.ts': '',
      'docs/architecture.md': doc(
        'Architecture',
        '\n`ui/window/window.tsx`, `app/browser-env.ts`, `platform/clock/clock.ts`, `shell/stage.ts`, `ui/`.\n',
      ),
    })
    assert.deepEqual(check(dir), { ok: true, report: '' })
  })

  it('fails a web app path that is not where it says', () => {
    const dir = repo({
      'apps/web/src/ui/window/window.tsx': '',
      'docs/architecture.md': doc('Architecture', '\n`ui/window.tsx` draws a frame.\n'),
    })
    const { ok, report } = check(dir)
    assert.equal(ok, false)
    assert.match(report, /cites ui\/window\.tsx, which does not exist/)
  })
})

describe('check-docs: the rules for every doc', () => {
  it('fails a change outside docs/ with no change in docs/', () => {
    const dir = repo({})
    write(dir, 'apps/web/src/new.ts', 'export const x = 1\n')
    const { ok, report } = check(dir)
    assert.equal(ok, false)
    assert.match(report, /Files changed outside docs\/ with no change in docs\//)
    assert.match(report, /apps\/web\/src\/new\.ts/)
  })

  it('passes a change outside docs/ that comes with one inside docs/', () => {
    const dir = repo({})
    write(dir, 'apps/web/src/new.ts', 'export const x = 1\n')
    write(dir, 'docs/protocol.md', doc('Protocol', '\nChanged.\n'))
    assert.deepEqual(check(dir), { ok: true, report: '' })
  })

  it('passes a commit that says Docs: none, and fails one that does not', () => {
    const dir = repo({})
    write(dir, 'apps/web/src/new.ts', 'export const x = 1\n')
    git(dir, 'add', '-A')
    git(dir, 'commit', '-q', '-m', 'chore: add x', '-m', 'Docs: none')
    assert.deepEqual(check(dir, '--base', 'HEAD~1'), { ok: true, report: '' })
    write(dir, 'apps/web/src/newer.ts', 'export const y = 1\n')
    git(dir, 'add', '-A')
    git(dir, 'commit', '-q', '-m', 'chore: add y')
    const { ok, report } = check(dir, '--base', 'HEAD~2')
    assert.equal(ok, false)
    assert.match(report, /apps\/web\/src\/newer\.ts/)
    assert.doesNotMatch(report, /apps\/web\/src\/new\.ts/)
  })

  it('fails a doc that README.md does not list', () => {
    const dir = repo({ 'docs/orphan.md': doc('Orphan') })
    const { ok, report } = check(dir)
    assert.equal(ok, false)
    assert.match(report, /docs\/orphan\.md is not listed in docs\/README\.md/)
  })

  it('fails a doc with no one-line summary under its heading', () => {
    const dir = repo({ 'docs/protocol.md': '# Protocol\n\n- straight into a list\n' })
    const { ok, report } = check(dir)
    assert.equal(ok, false)
    assert.match(
      report,
      /docs\/protocol\.md must open with a "# Heading" and then a one-line summary/,
    )
  })

  it('fails a doc that cites a decision record, and allows the records themselves', () => {
    // Spelled in pieces so this file doesn't itself cite one.
    const cite = (n: string) => ['decision', n].join(' ')
    const dir = repo({
      ...Object.fromEntries([record('0001-first.md')]),
      ...Object.fromEntries([
        ['docs/decisions/' + '0002-second.md', doc('0002: Second', `\nSee ${cite('0001')}.\n`)],
      ]),
      'docs/protocol.md': doc('Protocol', `\nThis follows ${cite('0001')}.\n`),
    })
    const { ok, report } = check(dir)
    assert.equal(ok, false)
    assert.match(report, /docs\/protocol\.md:\d+:/)
    assert.doesNotMatch(report, /000[12]-/)
  })
})
