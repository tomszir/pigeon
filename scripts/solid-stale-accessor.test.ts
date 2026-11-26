// Runs on Node's own test runner (mise run check). It lints small components with the Biome
// plugin in biome-plugins/solid-stale-accessor.grit, in a throwaway project that loads only
// that plugin, and checks which of them it refuses.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const plugin = join(root, 'biome-plugins', 'solid-stale-accessor.grit')
const biome = join(root, 'node_modules', '.bin', 'biome')

/** How many times the plugin reports `source`, a component using `<Show>`/`<Match>`. */
function reports(source: string): number {
  const dir = mkdtempSync(join(tmpdir(), 'pigeon-grit-'))
  try {
    writeFileSync(join(dir, 'biome.json'), JSON.stringify({ plugins: [plugin] }))
    writeFileSync(join(dir, 'component.tsx'), source)
    const run = spawnSync(biome, ['lint', `--config-path=${dir}`, 'component.tsx'], {
      cwd: dir,
      encoding: 'utf8',
    })
    assert.ok(run.status === 0 || run.status === 1, run.stderr)
    return (run.stdout + run.stderr).split('\n').filter((line) => /\bplugin\b/.test(line)).length
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const show = (callback: string) =>
  `import { Show } from 'solid-js'
declare const done: (value?: unknown) => void
export const A = (props: { item?: { id: string } }) => (
  <Show when={props.item}>{(item) => ${callback}}</Show>
)
`

const match = (callback: string) =>
  `import { Match, Switch } from 'solid-js'
declare const done: (value?: unknown) => void
export const A = (props: { item?: { id: string } }) => (
  <Switch>
    <Match when={props.item}>{(item) => ${callback}}</Match>
  </Switch>
)
`

describe('solid-stale-accessor', () => {
  for (const [name, source] of [
    [
      'a handler that changes state, then reads the accessor',
      show(`<button type="button" onClick={() => { done(); done(item().id) }}>x</button>`),
    ],
    [
      'an async handler that reads the accessor after an await',
      show(
        `<button type="button" onClick={async () => { await done(); done(item().id) }}>x</button>`,
      ),
    ],
    [
      'a function declaration that reads it late',
      show(
        `{ function close() { done(); done(item().id) } return <button type="button" onClick={close}>x</button> }`,
      ),
    ],
    [
      'a <Match> handler that reads it late',
      match(`<button type="button" onClick={() => { done(); done(item().id) }}>x</button>`),
    ],
    [
      'a handler whose first const reads something else',
      show(
        `<button type="button" onClick={() => { const other = done(); done(item().id, other) }}>x</button>`,
      ),
    ],
  ] as const) {
    it(`refuses ${name}`, () => assert.equal(reports(source), 1))
  }

  for (const [name, source] of [
    [
      'a handler that reads the accessor into a const first',
      show(
        `<button type="button" onClick={() => { const current = item(); done(); done(current.id) }}>x</button>`,
      ),
    ],
    [
      'a handler that reads it into a const after a comment',
      show(
        `<button type="button" onClick={() => {
          // Read before closing.
          const current = item()
          done()
          done(current.id)
        }}>x</button>`,
      ),
    ],
    [
      'an async handler that destructures it first',
      show(
        `<button type="button" onClick={async () => { const { id } = item(); await done(); done(id) }}>x</button>`,
      ),
    ],
    [
      'an expression handler, which reads it before calling anything',
      show(`<button type="button" onClick={() => done(item().id)}>x</button>`),
    ],
    ['reading it while rendering', show(`<span>{item().id}</span>`)],
    [
      'a <Match> handler that reads it first',
      match(
        `<button type="button" onClick={() => { const current = item(); done(current) }}>x</button>`,
      ),
    ],
  ] as const) {
    it(`allows ${name}`, () => assert.equal(reports(source), 0))
  }
})
