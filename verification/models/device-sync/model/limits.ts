// How far the tests explore. A plain run is bounded so it finishes in a few minutes; with
// PIGEON_HEAVY=1 the larger scenarios are explored to the end (or much further), which takes a
// quarter of an hour or more.
export const HEAVY: boolean = process.env['PIGEON_HEAVY'] === '1'

/** The most states an exploration keeps. */
export const MAX_STATES: number = HEAVY ? 2_000_000 : 40_000

/** Random walks per scenario, and their longest. */
export const WALKS: number = HEAVY ? 3000 : 200
export const WALK_LENGTH = 60
