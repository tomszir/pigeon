// How far the tests explore. A plain run takes under a minute; with PIGEON_HEAVY=1 the random
// traces and walks run ten times as many.
export const HEAVY: boolean = process.env['PIGEON_HEAVY'] === '1'

/** The most states an exploration keeps. */
export const MAX_STATES: number = HEAVY ? 2_000_000 : 200_000

/** Random traces per check, and random walks per scenario. */
export const TRACES: number = HEAVY ? 2000 : 200
export const WALKS: number = HEAVY ? 3000 : 300
export const WALK_LENGTH = 40
