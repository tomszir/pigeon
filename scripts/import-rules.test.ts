// Runs on Node's own test runner (mise run check). It copies biome.json and its plugins into a
// throwaway project, writes sample files at the paths the rules are scoped to, lints them once,
// and checks which imports and exports Biome refuses. Two more tests read the real tree: every
// file under platform/ is either an interface or refused, and apps are not nested.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const biome = join(root, 'node_modules', '.bin', 'biome')

const WEB = 'apps/web/src'
/** The platform files apps/ and shell/ may import: interfaces, with no implementation in them. */
const INTERFACES = ['clock/clock.ts', 'files/files.ts', 'storage/storage.ts', 'wake/wake.ts']

type Rule = 'noRestrictedImports' | 'noBarrelFile' | 'noReExportAll' | 'plugin'

interface Sample {
  name: string
  path: string
  source: string
  /** The rule that must report the file, or undefined when it must be clean. */
  refusedBy?: Rule
}

const importing = (specifier: string): string =>
  `import { thing } from '${specifier}'\nconsole.log(thing)\n`

/** Every non-test file under platform/ in the real tree, as `folder/file.ts`. */
function platformFiles(): string[] {
  const base = join(root, WEB, 'platform')
  return readdirSync(base, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((folder) =>
      readdirSync(join(base, folder.name))
        .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
        .map((file) => `${folder.name}/${file}`),
    )
}

const samples: Sample[] = []
const refused = (
  name: string,
  path: string,
  specifier: string,
  rule: Rule = 'noRestrictedImports',
) => samples.push({ name, path, source: importing(specifier), refusedBy: rule })
const allowed = (name: string, path: string, specifier: string) =>
  samples.push({ name, path, source: importing(specifier) })

// What apps/ and shell/ may take from platform/: interfaces, and for tests the memory store.
for (const [layer, up] of [
  [`${WEB}/apps/messenger/sample`, '../../../platform'],
  [`${WEB}/shell`, '../platform'],
] as const) {
  const where = layer.endsWith('sample') ? 'apps/' : 'shell/'
  for (const file of platformFiles()) {
    if (INTERFACES.includes(file)) {
      allowed(
        `${where} takes the interface platform/${file}`,
        `${layer}/takes-${file.replace('/', '-')}`,
        `${up}/${file}`,
      )
    } else {
      const name = file.replace('/', '-')
      refused(`${where} refuses platform/${file}`, `${layer}/refuses-${name}`, `${up}/${file}`)
    }
  }
  allowed(
    `a test in ${where} may take platform/storage/memory-storage.ts`,
    `${layer}/takes-memory-storage.test.ts`,
    `${up}/storage/memory-storage.ts`,
  )
  refused(
    `a test in ${where} still refuses platform/storage/browser-storage.ts`,
    `${layer}/refuses-browser-storage.test.ts`,
    `${up}/storage/browser-storage.ts`,
  )
}

// One refusal for each row of the import rules table in docs/architecture.md, and what the row allows.
refused('packages/ refuse solid-js', 'packages/core/src/chat/solid.ts', 'solid-js')
refused(
  'packages/ refuse apps/',
  'packages/core/src/chat/up.ts',
  '../../../../apps/web/src/app/x.ts',
)
allowed('packages/ may import each other', 'packages/lighthouse/src/store/other.ts', '@pigeon/core')
refused('platform/ refuses solid-js', `${WEB}/platform/clock/solid.ts`, 'solid-js')
refused('platform/ refuses ui/', `${WEB}/platform/clock/ui.ts`, '../../ui/button/button.ts')
refused('platform/ refuses shell/', `${WEB}/platform/clock/shell.ts`, '../../shell/shell.ts')
refused('platform/ refuses apps/', `${WEB}/platform/clock/apps.ts`, '../../apps/help/page/page.ts')
allowed('platform/ may import packages/', `${WEB}/platform/clock/core.ts`, '@pigeon/core')
refused('ui/ refuses platform/', `${WEB}/ui/button/platform.ts`, '../../platform/clock/clock.ts')
refused('ui/ refuses shell/', `${WEB}/ui/button/shell.ts`, '../../shell/shell.ts')
refused('ui/ refuses apps/', `${WEB}/ui/button/apps.ts`, '../../apps/help/page/page.ts')
allowed('ui/ may import solid-js and packages/', `${WEB}/ui/button/solid.ts`, 'solid-js')
refused('shell/ refuses apps/', `${WEB}/shell/apps.ts`, '../apps/help/page/page.ts')
refused('shell/ refuses app/', `${WEB}/shell/app.ts`, '../app/programs.tsx')
allowed('shell/ may import ui/', `${WEB}/shell/ui.ts`, '../ui/button/button.ts')
refused('an app refuses shell/', `${WEB}/apps/messenger/sample/shell.ts`, '../../../shell/shell.ts')
refused('an app refuses app/', `${WEB}/apps/messenger/sample/app.ts`, '../../../app/programs.tsx')
refused(
  'an app refuses another app',
  `${WEB}/apps/messenger/sample/sibling.ts`,
  '../../help/page/page.ts',
)
allowed(
  'an app may import its own folders',
  `${WEB}/apps/messenger/sample/own.ts`,
  '../other/other.ts',
)
allowed(
  'an app may import ui/',
  `${WEB}/apps/messenger/sample/ui.ts`,
  '../../../ui/button/button.ts',
)
allowed(
  'app/ may import everything',
  `${WEB}/app/everything.ts`,
  '../platform/crypto/passphrase.ts',
)
allowed('app/ may import shell/', `${WEB}/app/shell.ts`, '../shell/shell.ts')
allowed('app/ may import apps/', `${WEB}/app/apps.ts`, '../apps/help/page/page.ts')

// Test fakes and contracts stay in tests.
const FAKE_SOURCES = [
  '@pigeon/core/testing',
  '@pigeon/lighthouse/testing',
  '../testing/testing.ts',
  '../../core/src/testing/fake-pake.ts',
  './testing',
  '../store/store-contract.ts',
]
for (const path of [
  `${WEB}/app/uses-fakes.ts`,
  `${WEB}/apps/messenger/sample/uses-fakes.ts`,
  'packages/core/src/chat/uses-fakes.ts',
  'apps/lighthouse/src/uses-fakes.ts',
]) {
  refused(`${path} refuses @pigeon/core/testing`, path, '@pigeon/core/testing', 'plugin')
}
for (const [i, source] of FAKE_SOURCES.entries()) {
  refused(
    `a non-test file refuses importing ${source}`,
    `packages/core/src/chat/fakes-${i}.ts`,
    source,
    'plugin',
  )
}
for (const [name, source] of [
  ['default and named', "import d, { x } from '@pigeon/core/testing'\nconsole.log(d, x)\n"],
  ['default and namespace', "import d, * as ns from '@pigeon/core/testing'\nconsole.log(d, ns)\n"],
  ['namespace', "import * as ns from '@pigeon/core/testing'\nconsole.log(ns)\n"],
  ['type', "import type { T } from '@pigeon/core/testing'\nexport type U = T\n"],
  ['side effect', "import '@pigeon/core/testing'\n"],
  ['dynamic', "export const load = () => import('@pigeon/core/testing')\n"],
  [
    'dynamic through a relative path',
    "export const load = () => import('../testing/testing.ts')\n",
  ],
  ['export from', "export { x } from '@pigeon/core/testing'\n"],
  ['export type from', "export type { T } from '@pigeon/core/testing'\n"],
  ['export type *', "export type * from '@pigeon/core/testing'\n"],
  ['export * as', "export * as q from '@pigeon/core/testing'\n"],
  ['export *', "export * from '@pigeon/core/testing'\n"],
] as const) {
  samples.push({
    name: `a non-test file refuses ${name} of @pigeon/core/testing`,
    path: `packages/core/src/chat/form-${name.replaceAll(' ', '-')}.ts`,
    source,
    refusedBy: 'plugin',
  })
}
for (const path of [
  'packages/core/src/chat/uses-fakes.test.ts',
  `${WEB}/apps/messenger/sample/uses-fakes.test.tsx`,
  'apps/web/e2e/pake.spec.ts',
  'packages/core/src/testing/inside.ts',
  'packages/core/src/index.ts',
]) {
  allowed(
    `${path} may import fakes`,
    path,
    path.endsWith('inside.ts') ? './other-fake.ts' : '@pigeon/core/testing',
  )
}
allowed(
  'a non-test file may import @pigeon/core',
  `${WEB}/apps/messenger/sample/uses-core.ts`,
  '@pigeon/core',
)
allowed(
  'a non-test file may import a testing library',
  `${WEB}/apps/messenger/sample/testing-library.ts`,
  '@solidjs/testing-library',
)
allowed(
  'a non-test file may import not-testing/',
  'packages/core/src/chat/near.ts',
  '../not-testing/x.ts',
)

// Barrels.
samples.push(
  {
    name: 'a package refuses export * outside its index',
    path: 'packages/pigeonhtml/src/barrel.ts',
    source: "export * from './allowlists.ts'\n",
    refusedBy: 'noReExportAll',
  },
  {
    name: 'a web app folder refuses a barrel file',
    path: `${WEB}/apps/help/sample/barrel.ts`,
    source: "export { thing } from './thing.ts'\n",
    refusedBy: 'noBarrelFile',
  },
  {
    name: "a package's index.ts may be a barrel",
    path: 'packages/core/src/index.ts',
    source: "export * from './thing.ts'\nexport { other } from './other.ts'\n",
  },
)

const dir = mkdtempSync(join(tmpdir(), 'pigeon-imports-'))
after(() => rmSync(dir, { recursive: true, force: true }))

const config = JSON.parse(readFileSync(join(root, 'biome.json'), 'utf8'))
// The copy is not a git checkout, and the real files aren't in it. Every plugin is kept.
delete config.vcs
config.files = { includes: ['**'] }
writeFileSync(join(dir, 'biome.json'), JSON.stringify(config))
cpSync(join(root, 'biome-plugins'), join(dir, 'biome-plugins'), { recursive: true })
for (const sample of samples) {
  mkdirSync(dirname(join(dir, sample.path)), { recursive: true })
  writeFileSync(join(dir, sample.path), sample.source)
}

const run = spawnSync(biome, ['lint', '--reporter=json', '--max-diagnostics=2000'], {
  cwd: dir,
  encoding: 'utf8',
})
assert.ok(run.status === 0 || run.status === 1, run.stderr)

/** The rules that report each sample, by path. */
const reported = new Map<string, Set<string>>()
for (const d of JSON.parse(run.stdout).diagnostics as {
  category: string
  location: { path: string | { file: string } }
}[]) {
  const path = typeof d.location.path === 'string' ? d.location.path : d.location.path.file
  const rule = d.category.startsWith('lint/') ? (d.category.split('/').at(-1) ?? '') : d.category
  reported.set(path, (reported.get(path) ?? new Set()).add(rule))
}

describe('import rules in biome.json', () => {
  for (const sample of samples) {
    it(sample.name, () => {
      const rules = [...(reported.get(sample.path) ?? [])].filter((rule) =>
        ['noRestrictedImports', 'noBarrelFile', 'noReExportAll', 'plugin'].includes(rule),
      )
      if (sample.refusedBy === undefined) assert.deepEqual(rules, [])
      else assert.ok(rules.includes(sample.refusedBy), `reported: ${rules.join(', ') || 'nothing'}`)
    })
  }
})

describe('the tree the import rules assume', () => {
  it('has every interface file where biome.json names it', () => {
    for (const file of INTERFACES) assert.ok(existsSync(join(root, WEB, 'platform', file)), file)
    const config = readFileSync(join(root, 'biome.json'), 'utf8')
    for (const file of INTERFACES) assert.ok(config.includes(`!**/platform/${file}`), file)
  })

  it('keeps every app file one folder deep, as apps/<app>/<component>/<file>', () => {
    // The rule against importing a sibling app counts `../` steps from that depth, so a deeper
    // file could reach another app without being refused.
    const base = join(root, WEB, 'apps')
    const files = (readdirSync(base, { recursive: true }) as string[]).filter((path) =>
      /\.[a-z]+$/.test(path),
    )
    assert.deepEqual(
      files.filter((path) => path.split('/').length > 3),
      [],
    )
    assert.deepEqual(
      files.filter((path) => path.split('/').length < 3),
      [],
    )
  })
})
