// The maze screen saver's world, as pure functions: a perfect maze on a tile grid and a walker
// that keeps its left hand on the wall. Randomness comes in from the caller.

/** true is wall. Cells sit on odd tiles; the tiles between them are walls or open passages. */
export type Tiles = readonly (readonly boolean[])[]

export interface Maze {
  readonly tiles: Tiles
  readonly start: Cell
  readonly exit: Cell
}

export interface Cell {
  readonly x: number
  readonly y: number
}

/** 0 east, 1 south, 2 west, 3 north: a quarter turn per step, clockwise on screen. */
export type Heading = 0 | 1 | 2 | 3

export const STEP: Readonly<Record<Heading, Cell>> = {
  0: { x: 1, y: 0 },
  1: { x: 0, y: 1 },
  2: { x: -1, y: 0 },
  3: { x: 0, y: -1 },
}

/** A maze of `width` × `height` cells by depth-first carving, every cell reachable from every other. */
export function makeMaze(width: number, height: number, random: () => number): Maze {
  const tiles = Array.from({ length: height * 2 + 1 }, () =>
    Array.from({ length: width * 2 + 1 }, () => true),
  )
  const seen = new Set<string>()
  const stack: Cell[] = [{ x: 0, y: 0 }]
  seen.add('0,0')
  const open = (cell: Cell) => {
    const row = tiles[cell.y * 2 + 1]
    if (row !== undefined) row[cell.x * 2 + 1] = false
  }
  open({ x: 0, y: 0 })
  while (stack.length > 0) {
    const here = stack[stack.length - 1] as Cell
    const next = ([0, 1, 2, 3] as const)
      .map((heading) => ({ x: here.x + STEP[heading].x, y: here.y + STEP[heading].y }))
      .filter((cell) => cell.x >= 0 && cell.y >= 0 && cell.x < width && cell.y < height)
      .filter((cell) => !seen.has(`${cell.x},${cell.y}`))
    if (next.length === 0) {
      stack.pop()
      continue
    }
    const pick = next[Math.floor(random() * next.length)] as Cell
    const between = tiles[here.y + pick.y + 1]
    if (between !== undefined) between[here.x + pick.x + 1] = false
    open(pick)
    seen.add(`${pick.x},${pick.y}`)
    stack.push(pick)
  }
  return { tiles, start: { x: 1, y: 1 }, exit: { x: width * 2 - 1, y: height * 2 - 1 } }
}

export const isWall = (tiles: Tiles, x: number, y: number): boolean =>
  tiles[Math.floor(y)]?.[Math.floor(x)] ?? true

export interface Walker {
  readonly at: Cell
  readonly heading: Heading
}

export type Move = { readonly kind: 'forward' } | { readonly kind: 'turn'; readonly by: 1 | -1 }

/**
 * The next move for a walker keeping its left hand on the wall: turn left if it can go left,
 * else go on if it can, else turn right. Walking a perfect maze this way visits it all and finds
 * the exit.
 */
export function nextMove(tiles: Tiles, walker: Walker, turnedLast: boolean): Move {
  const open = (heading: Heading) => {
    const step = STEP[heading]
    return !isWall(tiles, walker.at.x + step.x, walker.at.y + step.y)
  }
  const left = ((walker.heading + 3) % 4) as Heading
  // Just turned left: go forward before checking the left wall again, or it would spin.
  if (!turnedLast && open(left)) return { kind: 'turn', by: -1 }
  if (open(walker.heading)) return { kind: 'forward' }
  return { kind: 'turn', by: 1 }
}

export function apply(walker: Walker, move: Move): Walker {
  if (move.kind === 'forward') {
    const step = STEP[walker.heading]
    return { ...walker, at: { x: walker.at.x + step.x, y: walker.at.y + step.y } }
  }
  return { ...walker, heading: ((walker.heading + move.by + 4) % 4) as Heading }
}
