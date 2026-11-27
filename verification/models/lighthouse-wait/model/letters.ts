// Mailing one friend's letters: a burst of messages goes as letters 5 seconds after the last, in
// a run that seals and puts them one letter at a time, at most so many waiting for receipts. A
// mail check asks to mail anything the friend lacks that no letter carries (`resume`), and so
// does a message written (`wrote`). The question is what happens to an ask that comes while a run
// is under way: the run decided what to mail when it started.
import type { Invariant, Model, StepInvariant } from './explore.ts'

export interface LetterRules {
  /** An ask during a run is remembered, and runs once the run ends. */
  readonly remembersAsk: boolean
  /** A run ends there; nothing starts another unless something asks. */
  readonly runsOnlyWhenAsked: boolean
}

export const LETTER_RULES: LetterRules = { remembersAsk: true, runsOnlyWhenAsked: true }

export interface LetterState {
  /** Messages written. */
  readonly written: number
  /** The highest message a letter still out, or the friend, has. */
  readonly covered: number
  /** Letters waiting for receipts. */
  readonly out: number
  readonly run: 'idle' | 'waiting' | 'mailing'
  /** What the run under way set out to mail up to, decided when it started. */
  readonly target: number
  /** An ask came during the run under way. */
  readonly asked: boolean
  /** Ghost: an ask came since the last time a letter's messages stopped counting. */
  readonly askedSince: boolean
  /** Ghost: runs started since the last ask. */
  readonly runsSinceAsk: number
  readonly budget: {
    readonly writes: number
    readonly receipts: number
    readonly expiries: number
    readonly checks: number
  }
}

/** Letters waiting for receipts per friend at most, scaled down from 50. */
export const MAX_WAITING = 2

export const lettersInit: LetterState = {
  written: 0,
  covered: 0,
  out: 0,
  run: 'idle',
  target: 0,
  asked: false,
  askedSince: true,
  runsSinceAsk: 0,
  budget: { writes: 3, receipts: 2, expiries: 1, checks: 2 },
}

type M = { -readonly [K in keyof LetterState]: LetterState[K] }

/**
 * `wrote` and `resume`: start the 5-second wait, or remember the ask during a run. A message
 * written during a run always queues another (its wait starts afresh); a mail check's `resume`
 * during a run is what can be lost.
 */
function ask(s: M, rules: LetterRules, written = false) {
  s.askedSince = true
  s.runsSinceAsk = 0
  if (s.run === 'mailing') {
    if (rules.remembersAsk || written) s.asked = true
    return
  }
  if (s.run === 'idle' && s.written > s.covered) s.run = 'waiting'
}

function endRun(s: M, rules: LetterRules) {
  s.run = 'idle'
  const again = s.asked || !rules.runsOnlyWhenAsked
  s.asked = false
  if (again && s.written > s.covered) s.run = 'waiting'
}

export function letterSteps(
  state: LetterState,
  rules: LetterRules = LETTER_RULES,
): (readonly [string, LetterState])[] {
  const out: (readonly [string, LetterState])[] = []
  const take = (label: string, act: (s: M) => void) => {
    const s: M = { ...state, budget: { ...state.budget } }
    act(s)
    out.push([label, s])
  }
  const b = state.budget
  if (b.writes > 0)
    take('a message is written', (s) => {
      s.written += 1
      s.budget = { ...s.budget, writes: s.budget.writes - 1 }
      ask(s, rules, true)
    })
  if (state.run === 'waiting')
    take('the 5 seconds pass and a run starts', (s) => {
      s.run = 'mailing'
      s.target = s.written
      s.runsSinceAsk += 1
    })
  if (state.run === 'mailing')
    take(
      state.out >= MAX_WAITING || state.covered >= state.target
        ? 'the run ends'
        : 'the run puts a letter',
      (s) => {
        if (s.out >= MAX_WAITING || s.covered >= s.target) endRun(s, rules)
        else {
          s.covered += 1
          s.out += 1
        }
      },
    )
  if (b.writes > 0)
    take("a message goes straight to the friend, who leaves before it's seen to arrive", (s) => {
      s.written += 1
      s.budget = { ...s.budget, writes: s.budget.writes - 1 }
      // Their leaving asks to resume: the message is theirs only once they stayed a moment.
      ask(s, rules)
    })
  if (b.receipts > 0 && state.out > 0)
    // Receipts come in a mail check, which asks to resume once it's done.
    take('a mail check brings a receipt and asks to resume', (s) => {
      s.out -= 1
      s.budget = { ...s.budget, receipts: s.budget.receipts - 1 }
      ask(s, rules)
    })
  if (b.expiries > 0 && state.covered > 0)
    take('a letter expires unreceipted, so its messages count as not carried', (s) => {
      s.covered -= 1
      if (s.out > 0) s.out -= 1
      s.askedSince = false
      s.budget = { ...s.budget, expiries: s.budget.expiries - 1 }
    })
  if (b.checks > 0)
    take('a mail check asks to resume', (s) => {
      s.budget = { ...s.budget, checks: s.budget.checks - 1 }
      ask(s, rules)
    })
  return out
}

const nothingHeld: Invariant<LetterState> = {
  id: 'R1 nothing held after a run',
  check: (s) =>
    s.run === 'idle' && s.askedSince && s.written > s.covered && s.out < MAX_WAITING
      ? `message ${s.covered + 1} of ${s.written} waits though it was asked for and letters may go`
      : undefined,
}

const boundedRuns: StepInvariant<LetterState> = {
  id: 'R2 one run per ask',
  check: (_, label, after) =>
    label.includes('a run starts') && after.runsSinceAsk > 2
      ? `${after.runsSinceAsk} runs started on one ask`
      : undefined,
}

export function lettersModel(rules: LetterRules = LETTER_RULES): Model<LetterState> {
  return {
    name: 'letters to one friend',
    init: lettersInit,
    steps: (s) => letterSteps(s, rules),
    safety: [nothingHeld],
    stepChecks: [boundedRuns],
    flags: (s) => [
      ...(s.asked ? ['asked during a run'] : []),
      ...(s.out >= MAX_WAITING ? ['at the cap'] : []),
      ...(s.run === 'mailing' && s.covered < s.target ? ['mid-run'] : []),
    ],
  }
}
