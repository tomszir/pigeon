// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { PIGEON_PAGES, pageNameProblem } from './pigeon-pages.ts'

const PRAGMA = '/** @jsxImportSource @pigeon/pigeonhtml */\nexport {}\n'
const SOLID = "import { createSignal } from 'solid-js'\n"

describe('PIGEON_PAGES', () => {
  it('matches the pages and their tests, with or without a query', () => {
    for (const id of [
      '/src/page.pigeon.tsx',
      '/src/page.pigeon.test.tsx',
      '/src/page.pigeon.tsx?foo=1',
      '/src/page.pigeon.test.tsx?t=17',
    ])
      expect(PIGEON_PAGES.test(id), id).toBe(true)
  })

  it('leaves everything else to Solid', () => {
    for (const id of [
      '/src/page.tsx',
      '/src/pigeon.tsx',
      '/src/page.pigeon.ts',
      '/src/a.pigeon.tsx.map',
    ])
      expect(PIGEON_PAGES.test(id), id).toBe(false)
  })
})

describe('pageNameProblem', () => {
  it('accepts a page with its name and pragma, and a component with neither', () => {
    expect(pageNameProblem('/src/page.pigeon.tsx', PRAGMA)).toBeUndefined()
    expect(pageNameProblem('/src/page.pigeon.tsx?foo=1', PRAGMA)).toBeUndefined()
    expect(pageNameProblem('/src/page.pigeon.test.tsx', PRAGMA)).toBeUndefined()
    expect(pageNameProblem('/src/window.tsx', SOLID)).toBeUndefined()
  })

  it('refuses a page without its pragma, and a pragma without the name', () => {
    expect(pageNameProblem('/src/page.pigeon.tsx', SOLID)).toMatch(/no "@jsxImportSource/)
    expect(pageNameProblem('/src/window.tsx', PRAGMA)).toMatch(/isn't named \*\.pigeon\.tsx/)
    expect(pageNameProblem('/src/window.tsx?x=1', PRAGMA)).toMatch(/isn't named/)
  })

  it('looks only at .tsx files outside node_modules', () => {
    expect(pageNameProblem('/src/runtime.ts', PRAGMA)).toBeUndefined()
    expect(pageNameProblem('/x/node_modules/lib/a.tsx', PRAGMA)).toBeUndefined()
  })
})
