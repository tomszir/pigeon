// Starts the Lighthouse the way its Docker image does, with plain Node stripping the types, so
// code that only runs under a bundler or Vitest's own TypeScript handling fails here instead
// of crash-looping a released image.
import { type ChildProcess, spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test } from 'vitest'

let dir: string | undefined
let running: ChildProcess | undefined

afterEach(() => {
  // A Lighthouse that didn't stop on SIGTERM is killed, so a failed run leaves nothing behind.
  if (running !== undefined && running.exitCode === null) running.kill('SIGKILL')
  running = undefined
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  dir = undefined
})

test('starts under plain Node and says its address', async () => {
  dir = mkdtempSync(join(tmpdir(), 'lighthouse-start-'))
  const config = join(dir, 'lighthouse.json')
  writeFileSync(
    config,
    JSON.stringify({
      name: 'Test Lighthouse',
      url: 'wss://lighthouse.test/',
      host: '127.0.0.1',
      port: 0,
    }),
  )
  const child = spawn(
    process.execPath,
    ['--disable-warning=ExperimentalWarning', 'src/main.ts', '--config', config],
    { cwd: new URL('..', import.meta.url), stdio: ['ignore', 'pipe', 'pipe'] },
  )
  running = child
  const exited = new Promise<void>((resolve) => child.on('exit', () => resolve()))
  let out = ''
  let err = ''
  child.stdout.on('data', (chunk: Buffer) => {
    out += chunk.toString()
  })
  child.stderr.on('data', (chunk: Buffer) => {
    err += chunk.toString()
  })
  const started = await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), 15_000)
    child.stdout.on('data', () => {
      if (out.includes('is listening on')) {
        clearTimeout(timer)
        resolve(true)
      }
    })
    void exited.then(() => {
      clearTimeout(timer)
      resolve(false)
    })
  })
  if (child.exitCode === null) child.kill('SIGTERM')
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 3_000))])
  expect(err.includes('Error') ? err : '').toBe('')
  expect(started).toBe(true)
  expect(out).toContain('pigeon://lighthouse/')
}, 20_000)
