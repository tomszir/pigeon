// Runs on Node's own test runner (mise run check). It copies biome.json and its plugins into a
// throwaway project, writes sample files at the paths the rules are scoped to, lints them once,
// and checks which imports and exports Biome refuses.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const biome = join(root, 'node_modules', '.bin', 'biome')

const WEB = 'apps/web/src'

interface Sample {
  name: string
  path: string
  source: string
  /** The rule that must report the file, or undefined when it must be clean. */
  refusedBy?: 'noRestrictedImports' | 'noBarrelFile' | 'noReExportAll' | 'plugin'
}

const importing = (specifier: string) =>
  `import { thing } from '${specifier}'\nconsole.log(thing)\n`
const IMPLEMENTATIONS = [
  'browser-storage.ts',
  'passphrase.ts',
  'recovery-key.ts',
  'seal-crypto.ts',
  'wasm-pake.ts',
  'wasm-argon2id.ts',
  'turn-servers.ts',
  'browser-transport.ts',
]

const samples: Sample[] = []

for (const layer of [`${WEB}/apps/messenger/sample`, `${WEB}/shell`]) {
  const up = layer.endsWith('sample') ? '../../../platform' : '../platform'
  for (const file of IMPLEMENTATIONS) {
    const folder = file.startsWith('browser-')
      ? file.replace(/^browser-/, '').replace(/\.ts$/, '')
      : 'crypto'
    samples.push({
      name: `${layer.split('/').slice(3).join('/')} refuses platform/${folder}/${file}`,
      path: `${layer}/refuses-${file}`,
      source: importing(`${up}/${folder}/${file}`),
      refusedBy: 'noRestrictedImports',
    })
  }
  for (const face of ['clock/clock', 'files/files', 'storage/storage', 'wake/wake']) {
    samples.push({
      name: `${layer.split('/').slice(3).join('/')} takes the interface platform/${face}.ts`,
      path: `${layer}/takes-${face.replace('/', '-')}.ts`,
      source: importing(`${up}/${face}.ts`),
    })
  }
}

for (const path of [
  `${WEB}/app/uses-fakes.ts`,
  `${WEB}/apps/messenger/sample/uses-fakes.ts`,
  'packages/core/src/chat/uses-fakes.ts',
  'apps/lighthouse/src/uses-fakes.ts',
]) {
  samples.push({
    name: `${path} refuses @pigeon/core/testing`,
    path,
    source: importing('@pigeon/core/testing'),
    refusedBy: 'plugin',
  })
}
samples.push(
  {
    name: 'a non-test file refuses @pigeon/lighthouse/testing',
    path: 'packages/lighthouse/src/store/uses-contract.ts',
    source: importing('@pigeon/lighthouse/testing'),
    refusedBy: 'plugin',
  },
  {
    name: 'a non-test file refuses re-exporting @pigeon/core/testing',
    path: 'packages/core/src/chat/re-exports-fakes.ts',
    source: "export { cryptoContract } from '@pigeon/core/testing'\n",
    refusedBy: 'plugin',
  },
  {
    name: 'a test file may import @pigeon/core/testing',
    path: 'packages/core/src/chat/uses-fakes.test.ts',
    source: importing('@pigeon/core/testing'),
  },
  {
    name: 'a .test.tsx file may import @pigeon/core/testing',
    path: `${WEB}/apps/messenger/sample/uses-fakes.test.tsx`,
    source: importing('@pigeon/core/testing'),
  },
  {
    name: 'a non-test file may import @pigeon/core',
    path: `${WEB}/apps/messenger/sample/uses-core.ts`,
    source: importing('@pigeon/core'),
  },
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
// The copy is not a git checkout, and the real files aren't in it.
delete config.vcs
config.files = { includes: ['**'] }
config.plugins = config.plugins.filter((p: string) => p.includes('no-test-fakes'))
writeFileSync(join(dir, 'biome.json'), JSON.stringify(config))
cpSync(join(root, 'biome-plugins'), join(dir, 'biome-plugins'), { recursive: true })
for (const sample of samples) {
  mkdirSync(dirname(join(dir, sample.path)), { recursive: true })
  writeFileSync(join(dir, sample.path), sample.source)
}

const run = spawnSync(biome, ['lint', '--reporter=json', '--max-diagnostics=500'], {
  cwd: dir,
  encoding: 'utf8',
})
assert.ok(run.status === 0 || run.status === 1, run.stderr)

/** The rule names that report each sample, by path. */
const reported = new Map<string, Set<string>>()
for (const d of JSON.parse(run.stdout).diagnostics as {
  category: string
  location: { path: string | { file: string } }
}[]) {
  const path = typeof d.location.path === 'string' ? d.location.path : d.location.path.file
  const rule = d.category.startsWith('lint/') ? d.category.split('/').at(-1) : d.category
  reported.set(path, (reported.get(path) ?? new Set()).add(rule ?? ''))
}

describe('import rules in biome.json', () => {
  for (const sample of samples) {
    it(sample.name, () => {
      const rules = [...(reported.get(sample.path) ?? [])].filter(
        (rule) => rule !== 'noUnusedImports' && rule !== 'noUnusedVariables',
      )
      if (sample.refusedBy === undefined) assert.deepEqual(rules, [])
      else assert.ok(rules.includes(sample.refusedBy), `reported: ${rules.join(', ') || 'nothing'}`)
    })
  }
})
