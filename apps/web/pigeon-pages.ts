// Pages written as typed string JSX are named `*.pigeon.tsx` (`*.pigeon.test.tsx` for their
// tests) and start with `/** @jsxImportSource @pigeon/pigeonhtml */`. Solid's plugin compiles
// every other `.tsx` file, so the name is what keeps it off them, and the pragma is what makes
// the JSX call the PigeonHTML runtime. The two have to agree, or a file is compiled by the wrong
// one of them: this plugin refuses a `.tsx` file where they don't.
import type { Plugin } from 'vite'

/** The files Solid's plugin leaves alone. An id may end in a query (`page.pigeon.tsx?foo=1`). */
export const PIGEON_PAGES = /\.pigeon\.(test\.)?tsx(?:$|\?)/

const PRAGMA = /@jsxImportSource\s+@pigeon\/pigeonhtml\b/

/** What is wrong with a `.tsx` file's name and pragma, or undefined when they agree. */
export function pageNameProblem(id: string, code: string): string | undefined {
  const path = id.split('?')[0] ?? id
  if (!path.endsWith('.tsx') || path.includes('/node_modules/')) return undefined
  const named = PIGEON_PAGES.test(id)
  const pragma = PRAGMA.test(code)
  if (named && !pragma)
    return `${path} is named like a PigeonHTML page but has no "@jsxImportSource @pigeon/pigeonhtml" pragma`
  if (pragma && !named)
    return `${path} has the PigeonHTML "@jsxImportSource" pragma but isn't named *.pigeon.tsx, so Solid would compile it`
  return undefined
}

export function pigeonPages(): Plugin {
  return {
    name: 'pigeon-pages',
    enforce: 'pre',
    transform(code, id) {
      const problem = pageNameProblem(id, code)
      if (problem !== undefined) this.error(problem)
      return null
    },
  }
}
