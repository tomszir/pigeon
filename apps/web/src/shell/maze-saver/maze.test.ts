import { describe, expect, it } from 'vitest'
import { apply, isWall, makeMaze, nextMove, STEP, type Walker } from './maze.ts'

/** A small fixed sequence, so mazes are the same every run. */
function seeded(seed: number) {
  let state = seed
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648
    return state / 2147483648
  }
}

describe('makeMaze', () => {
  it('walls the border and reaches every cell from the start', () => {
    const { tiles, start } = makeMaze(8, 6, seeded(7))
    expect(tiles).toHaveLength(13)
    expect(tiles[0]?.every(Boolean)).toBe(true)
    expect(tiles.every((row) => row[0] && row[row.length - 1])).toBe(true)
    const seen = new Set<string>()
    const queue = [start]
    while (queue.length > 0) {
      const here = queue.shift()
      if (here === undefined || seen.has(`${here.x},${here.y}`)) continue
      seen.add(`${here.x},${here.y}`)
      for (const step of Object.values(STEP))
        if (!isWall(tiles, here.x + step.x, here.y + step.y))
          queue.push({ x: here.x + step.x, y: here.y + step.y })
    }
    const cells = [...seen].filter((key) => {
      const [x, y] = key.split(',').map(Number) as [number, number]
      return x % 2 === 1 && y % 2 === 1
    })
    expect(cells).toHaveLength(8 * 6)
  })
})

describe('the left-hand walker', () => {
  it('finds the exit without ever walking into a wall', () => {
    const maze = makeMaze(6, 6, seeded(3))
    let walker: Walker = { at: maze.start, heading: 0 }
    let turned = false
    for (let i = 0; i < 2000; i++) {
      const move = nextMove(maze.tiles, walker, turned)
      walker = apply(walker, move)
      turned = move.kind === 'turn' && move.by === -1
      expect(isWall(maze.tiles, walker.at.x, walker.at.y)).toBe(false)
      if (walker.at.x === maze.exit.x && walker.at.y === maze.exit.y) return
    }
    throw new Error('never reached the exit')
  })
})
