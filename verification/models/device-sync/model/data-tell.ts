// Telling the friend: as replacement rounds do, a device whose pair secret for a friendship
// changed sends that friendship's proposals to the friend's devices too, so a friend the proposer
// never wrote to still hears of it.
import { viewOf } from './data-fold.ts'
import { newLetter } from './data-mail.ts'
import { countsOn, winner } from './data-secrets.ts'
import { type DataConfig, type DataState, type Dev, propKey } from './data-state.ts'

/** The secret device `d` is on for each friendship live there. */
export function winners(
  cfg: DataConfig,
  state: DataState,
  d: Dev,
): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {}
  for (const [inc, fr] of Object.entries(viewOf(state, cfg.rules, d).live)) {
    const key = propKey(cfg.rules, fr, inc)
    out[inc] = winner(cfg.rules, state.devs[d]?.props[key] ?? [], countsOn(state, d))?.id
  }
  return out
}

/** Sends the friend the proposals of each friendship whose secret changed on `d` since `before`. */
export function tellFriends(
  cfg: DataConfig,
  state: DataState,
  d: Dev,
  before: Record<string, string | undefined>,
): void {
  const dev = state.devs[d]
  if (!dev || !cfg.rules.tellFriend) return
  const after = winners(cfg, state, d)
  for (const [inc, fr] of Object.entries(viewOf(state, cfg.rules, d).live)) {
    if (after[inc] === before[inc] || before[inc] === undefined) continue
    const key = propKey(cfg.rules, fr, inc)
    newLetter(cfg, state, 'rekey-friend', d, [fr], [], { [key]: dev.props[key] ?? [] }, false)
  }
}
