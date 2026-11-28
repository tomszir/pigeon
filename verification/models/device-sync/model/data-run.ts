// What every step of the your-data model shares: spending a budget, the ghosts worked out after
// each step, and letters that are gone.
import { deliver } from './data-mail.ts'
import {
  type Budget,
  type DataConfig,
  type DataState,
  honest,
  knowsRemoval,
  REMOVED,
} from './data-state.ts'

export type Step = readonly [string, DataState]

export function spend(state: DataState, budget: Budget): boolean {
  const left = state.left[budget] ?? 0
  if (left <= 0) return false
  state.left[budget] = left - 1
  return true
}

/** Letters nobody has left to take, and none waiting to be put, are gone from the Lighthouse. */
export function sweep(state: DataState): void {
  state.mail = state.mail.filter((l) => l.pending.length > 0 || l.lost.length > 0 || !l.put)
}

/**
 * Works out the ghosts that depend on the whole state, and has whoever takes mail at once take
 * it: a hostile removed device reads every letter sealed to it the moment it's put (the worst
 * case), and a friend's device takes its letters (when doesn't matter to anything checked here).
 */
export function finish(cfg: DataConfig, state: DataState): DataState {
  // While a Lighthouse holds the friends' mail, only a hostile removed device reads at once.
  const readers = [...(state.friendHold ? [] : ['F', 'G']), ...(cfg.hostile ? [REMOVED] : [])]
  state.mail.forEach((l, i) => {
    if (!l.put) return
    for (const r of l.pending) if (readers.includes(r)) deliver(cfg, state, i, r)
  })
  sweep(state)
  state.allKnew =
    state.removalSt > 0 &&
    honest(state, cfg).every((d) => {
      const dev = state.devs[d]
      return dev !== undefined && knowsRemoval(dev)
    })
  return state
}
