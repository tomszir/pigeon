// A bounded breadth-first explorer. From a model's first state it takes every enabled step, keeps
// each state it hasn't seen (by a hash of its one spelling), and checks every invariant on it. A
// model can also say how it settles: every letter delivered, every device run until nothing
// changes. The settled state is checked against the invariants that only hold once mail has
// settled, such as every device on the list agreeing. Breadth first, so the first violation
// found for an invariant comes with a shortest list of steps.
import { createHash } from 'node:crypto'
import { canon } from './canon.ts'

export interface Invariant<S> {
  readonly id: string
  /** Undefined when it holds, otherwise what is wrong. */
  readonly check: (state: S) => string | undefined
}

export interface StepInvariant<S> {
  readonly id: string
  readonly check: (before: S, label: string, after: S) => string | undefined
}

export interface Model<S> {
  readonly name: string
  readonly init: S
  readonly steps: (state: S) => readonly (readonly [string, S])[]
  /** Checked on every state reached, and on every settled state. */
  readonly safety: readonly Invariant<S>[]
  /** Checked on every step taken. */
  readonly stepChecks?: readonly StepInvariant<S>[]
  /** Delivers everything and runs every device until nothing changes. */
  readonly settle?: (state: S) => S
  /** Checked on the settled state of every state reached. */
  readonly settled?: readonly Invariant<S>[]
  /** What a state shows happened, so a run can't pass by never reaching the interesting part. */
  readonly flags?: (state: S) => readonly string[]
}

export interface Violation {
  readonly id: string
  readonly message: string
  /** The steps from the first state, and `settle` when it broke only once mail settled. */
  readonly path: readonly string[]
}

export interface Result {
  readonly model: string
  readonly states: number
  readonly steps: number
  readonly depth: number
  readonly truncated: boolean
  readonly ms: number
  /** The first (shortest) violation of each invariant broken. */
  readonly violations: readonly Violation[]
  readonly reached: readonly string[]
}

export interface Options {
  readonly maxStates?: number
  /** Stop as soon as any invariant is broken. */
  readonly stopAtFirst?: boolean
  /** Stop as soon as this invariant is broken. */
  readonly stopAt?: string
}

const hash = (state: unknown) => createHash('sha1').update(canon(state)).digest('base64')

export function explore<S>(model: Model<S>, options: Options = {}): Result {
  const started = Date.now()
  const maxStates = options.maxStates ?? 200_000
  const parent = new Map<string, readonly [string, string] | null>()
  const violations = new Map<string, Violation>()
  const reached = new Set<string>()
  let steps = 0
  let depth = 0
  let truncated = false

  const pathTo = (key: string): string[] => {
    const path: string[] = []
    let at = parent.get(key)
    while (at) {
      path.unshift(at[1])
      at = parent.get(at[0])
    }
    return path
  }
  const report = (id: string, message: string, path: () => string[]) => {
    if (!violations.has(id)) violations.set(id, { id, message, path: path() })
  }
  const checkState = (state: S, key: string) => {
    for (const inv of model.safety) {
      const wrong = inv.check(state)
      if (wrong) report(inv.id, wrong, () => pathTo(key))
    }
    for (const flag of model.flags?.(state) ?? []) reached.add(flag)
    if (!model.settle) return
    const settled = model.settle(state)
    for (const inv of [...model.safety, ...(model.settled ?? [])]) {
      const wrong = inv.check(settled)
      if (wrong) report(inv.id, wrong, () => [...pathTo(key), 'settle'])
    }
    for (const flag of model.flags?.(settled) ?? []) reached.add(`settled:${flag}`)
  }

  const first = hash(model.init)
  parent.set(first, null)
  checkState(model.init, first)
  let frontier: (readonly [string, S])[] = [[first, model.init]]
  const done = () =>
    (options.stopAtFirst === true && violations.size > 0) ||
    (options.stopAt !== undefined && violations.has(options.stopAt))
  while (frontier.length > 0 && !done()) {
    const next: (readonly [string, S])[] = []
    for (const [key, state] of frontier) {
      for (const [label, after] of model.steps(state)) {
        steps++
        for (const inv of model.stepChecks ?? []) {
          const wrong = inv.check(state, label, after)
          if (wrong) report(inv.id, wrong, () => [...pathTo(key), label])
        }
        const afterKey = hash(after)
        if (parent.has(afterKey)) continue
        if (parent.size >= maxStates) {
          truncated = true
          continue
        }
        parent.set(afterKey, [key, label])
        checkState(after, afterKey)
        next.push([afterKey, after])
        if (done()) break
      }
      if (done()) break
    }
    if (next.length > 0) depth++
    frontier = next
  }
  return {
    model: model.name,
    states: parent.size,
    steps,
    depth,
    truncated,
    ms: Date.now() - started,
    violations: [...violations.values()],
    reached: [...reached].sort(),
  }
}

/** One line per result, for the command line and test logs. */
export function summary(result: Result): string {
  const broken = result.violations.map((v) => v.id).join(', ') || 'none'
  return `${result.model}: ${result.states} states, ${result.steps} steps, depth ${result.depth}${
    result.truncated ? ' (truncated)' : ''
  }, ${result.ms} ms; broken: ${broken}`
}

export interface WalkOptions {
  readonly walks: number
  readonly maxLength: number
  readonly seed: number
}

/** A small seeded generator (mulberry32), so a walk that breaks something can be run again. */
function random(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Seeded random walks from the first state, each until no step is left or `maxLength` steps,
 * checking every invariant on the way and the settled ones at the end: deeper histories than the
 * breadth-first search reaches, though not all of them.
 */
export function walk<S>(model: Model<S>, options: WalkOptions): Result {
  const started = Date.now()
  const next = random(options.seed)
  const violations = new Map<string, Violation>()
  const reached = new Set<string>()
  const seen = new Set<string>()
  let steps = 0
  let depth = 0
  const report = (id: string, message: string, path: readonly string[]) => {
    if (!violations.has(id)) violations.set(id, { id, message, path: [...path] })
  }
  for (let w = 0; w < options.walks; w++) {
    let state = model.init
    const path: string[] = []
    for (let i = 0; i < options.maxLength; i++) {
      const choices = model.steps(state)
      if (choices.length === 0) break
      const choice = choices[Math.floor(next() * choices.length)]
      if (!choice) break
      const [label, after] = choice
      steps++
      for (const inv of model.stepChecks ?? []) {
        const wrong = inv.check(state, label, after)
        if (wrong) report(inv.id, wrong, [...path, label])
      }
      path.push(label)
      state = after
      seen.add(hash(state))
      for (const inv of model.safety) {
        const wrong = inv.check(state)
        if (wrong) report(inv.id, wrong, path)
      }
      for (const flag of model.flags?.(state) ?? []) reached.add(flag)
    }
    depth = Math.max(depth, path.length)
    if (!model.settle) continue
    const settled = model.settle(state)
    for (const inv of [...model.safety, ...(model.settled ?? [])]) {
      const wrong = inv.check(settled)
      if (wrong) report(inv.id, wrong, [...path, 'settle'])
    }
    for (const flag of model.flags?.(settled) ?? []) reached.add(`settled:${flag}`)
  }
  return {
    model: `${model.name} (random walks)`,
    states: seen.size,
    steps,
    depth,
    truncated: true,
    ms: Date.now() - started,
    violations: [...violations.values()],
    reached: [...reached].sort(),
  }
}
