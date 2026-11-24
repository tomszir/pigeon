// The maze screen saver: a walk through a freshly made maze, keeping a hand on the left wall, drawn
// by casting one ray per column into a small 320×240 canvas scaled up in big pixels. Brick walls,
// some carrying the Pigeon emblem, a tiled ceiling and floor. It starts a new maze at each exit.
import { onCleanup, onMount } from 'solid-js'
import { brand } from '../../ui/icons/icons.ts'
import {
  apply,
  isWall,
  type Maze,
  type Move,
  makeMaze,
  nextMove,
  STEP,
  type Walker,
} from './maze.ts'
import styles from './maze-saver.module.css'

const WIDTH = 320
const HEIGHT = 240
const CELLS = 9
/** Seconds for one tile forward, and for a quarter turn. */
const FORWARD_S = 0.45
const TURN_S = 0.5
/** Tan of half the field of view, about 66°. */
const FOV = 0.66

interface Pose {
  readonly x: number
  readonly y: number
  readonly angle: number
}

const headingAngle = (heading: Walker['heading']) => (heading * Math.PI) / 2

/** Whether the wall tile at (x, y) carries an emblem: about one in eleven, fixed per tile. */
const emblem = (x: number, y: number) => ((x * 73856093) ^ (y * 19349663)) % 11 === 0

export function MazeSaver(props: { onWake: () => void; still: boolean }) {
  let canvas: HTMLCanvasElement | undefined

  onMount(() => {
    const wake = () => props.onWake()
    document.addEventListener('keydown', wake, { once: true })
    onCleanup(() => document.removeEventListener('keydown', wake))

    // A CPU-backed canvas: a GPU one can be composited past the CRT's SVG filter and skip it.
    const context = canvas?.getContext?.('2d', { willReadFrequently: true })
    if (context === null || context === undefined) return
    const picture = new Image()
    picture.src = brand('pigeon-48')

    let maze: Maze = makeMaze(CELLS, CELLS, Math.random)
    let walker: Walker = { at: maze.start, heading: 0 }
    let move: Move = nextMove(maze.tiles, walker, false)
    let turnedLeft = false
    let progress = 0
    let last = performance.now()

    const pose = (): Pose => {
      const angle = headingAngle(walker.heading)
      if (move.kind === 'forward') {
        const step = STEP[walker.heading]
        return {
          x: walker.at.x + 0.5 + step.x * progress,
          y: walker.at.y + 0.5 + step.y * progress,
          angle,
        }
      }
      // Ease the turn so it starts and stops softly.
      const eased = (1 - Math.cos(progress * Math.PI)) / 2
      return {
        x: walker.at.x + 0.5,
        y: walker.at.y + 0.5,
        angle: angle + (move.by * eased * Math.PI) / 2,
      }
    }

    const buffer = context.createImageData(WIDTH, HEIGHT)
    const put = (index: number, r: number, g: number, b: number) => {
      buffer.data[index] = r
      buffer.data[index + 1] = g
      buffer.data[index + 2] = b
      buffer.data[index + 3] = 255
    }

    /** Ceiling tiles and floor tiles, cast row by row and darkening into the distance. */
    const drawPlanes = (
      x: number,
      y: number,
      dirX: number,
      dirY: number,
      planeX: number,
      planeY: number,
    ) => {
      const leftX = dirX - planeX
      const leftY = dirY - planeY
      for (let row = HEIGHT / 2 + 1; row < HEIGHT; row++) {
        const rowDistance = HEIGHT / 2 / (row - HEIGHT / 2)
        const light = Math.max(0.12, 1 - rowDistance / 8)
        /** 1 up close, 0 beyond 3.5 tiles, where tiles would alias into lines. */
        const detail = Math.max(0, Math.min(1, (3.5 - rowDistance) / 1.5))
        const stepX = (rowDistance * 2 * planeX) / WIDTH
        const stepY = (rowDistance * 2 * planeY) / WIDTH
        let worldX = x + rowDistance * leftX
        let worldY = y + rowDistance * leftY
        const floorRow = row * WIDTH * 4
        const ceilingRow = (HEIGHT - row - 1) * WIDTH * 4
        for (let column = 0; column < WIDTH; column++) {
          const fx = worldX - Math.floor(worldX)
          const fy = worldY - Math.floor(worldY)
          // Three ceiling and floor tiles to each maze tile, so no grout runs down the middle of the view. Far off they'd be smaller
          // than a pixel and shimmer, so the pattern fades into its average colour.
          const tx = (fx * 3) % 1
          const ty = (fy * 3) % 1
          const grout = detail > 0 && (tx < 0.06 || ty < 0.06)
          const checker = (Math.floor(worldX * 3) + Math.floor(worldY * 3)) % 2 === 0
          const ceiling = (grout ? 96 : 188) * detail + 178 * (1 - detail)
          put(
            ceilingRow + column * 4,
            ceiling * light,
            ceiling * light * 0.99,
            ceiling * light * 0.94,
          )
          const floor = (grout ? 40 : checker ? 110 : 88) * detail + 92 * (1 - detail)
          put(floorRow + column * 4, floor * light, floor * light * 0.89, floor * light * 0.71)
          worldX += stepX
          worldY += stepY
        }
      }
      context.putImageData(buffer, 0, 0)
    }

    /** Bricks: rows staggered by half a brick, each brick a slightly different red. */
    // Odd, so no joint falls at eye level, where it would be one flat line across every wall.
    const BRICK_ROWS = 5
    const drawBricks = (
      column: number,
      top: number,
      height: number,
      u: number,
      mapX: number,
      mapY: number,
      light: number,
    ) => {
      // Far walls are too small for mortar to read; drawn anyway it flickers, so they go plain.
      if (height < 48) {
        context.fillStyle = `rgb(${Math.round(150 * light)} ${Math.round(70 * light)} ${Math.round(52 * light)})`
        context.fillRect(column, Math.round(top), 1, Math.round(height))
        return
      }
      const rowHeight = height / BRICK_ROWS
      for (let brickRow = 0; brickRow < BRICK_ROWS; brickRow++) {
        const rowTop = top + brickRow * rowHeight
        const along = u * 2 + (brickRow % 2) * 0.5
        const brick = Math.floor(along)
        const mortar = along - brick < 0.06
        const tint = (((mapX * 31 + mapY * 17 + brickRow * 7 + brick * 13) % 5) - 2) * 7
        const r = mortar ? 176 : 150 + tint
        const g = mortar ? 164 : 62 + tint / 2
        const b = mortar ? 140 : 44
        context.fillStyle = `rgb(${Math.round(r * light)} ${Math.round(g * light)} ${Math.round(b * light)})`
        context.fillRect(column, Math.round(rowTop), 1, Math.round(rowHeight) + 1)
        const joint = Math.max(1, Math.round(rowHeight * 0.12))
        context.fillStyle = `rgb(${Math.round(176 * light)} ${Math.round(164 * light)} ${Math.round(140 * light)})`
        context.fillRect(column, Math.round(rowTop), 1, joint)
      }
    }

    const draw = ({ x, y, angle }: Pose) => {
      const dirX = Math.cos(angle)
      const dirY = Math.sin(angle)
      const planeX = -dirY * FOV
      const planeY = dirX * FOV
      drawPlanes(x, y, dirX, dirY, planeX, planeY)
      for (let column = 0; column < WIDTH; column++) {
        const camera = (2 * column) / WIDTH - 1
        const rayX = dirX + planeX * camera
        const rayY = dirY + planeY * camera
        let mapX = Math.floor(x)
        let mapY = Math.floor(y)
        const deltaX = Math.abs(1 / rayX)
        const deltaY = Math.abs(1 / rayY)
        const stepX = rayX < 0 ? -1 : 1
        const stepY = rayY < 0 ? -1 : 1
        let sideX = (rayX < 0 ? x - mapX : mapX + 1 - x) * deltaX
        let sideY = (rayY < 0 ? y - mapY : mapY + 1 - y) * deltaY
        let side = 0
        for (let guard = 0; guard < 64 && !isWall(maze.tiles, mapX, mapY); guard++) {
          if (sideX < sideY) {
            sideX += deltaX
            mapX += stepX
            side = 0
          } else {
            sideY += deltaY
            mapY += stepY
            side = 1
          }
        }
        const distance = Math.max(0.05, side === 0 ? sideX - deltaX : sideY - deltaY)
        const height = Math.min(HEIGHT * 4, HEIGHT / distance)
        const top = (HEIGHT - height) / 2
        // Where along the wall the ray landed, 0 to 1, for the bricks and the emblem.
        const along = side === 0 ? y + distance * rayY : x + distance * rayX
        const u = along - Math.floor(along)
        const light = Math.max(0.16, 1 - distance / 9) * (side === 1 ? 0.8 : 1)
        drawBricks(column, top, height, u, mapX, mapY, light)
        if (emblem(mapX, mapY) && picture.complete && u > 0.25 && u < 0.75) {
          const size = height * 0.4
          context.globalAlpha = light
          context.drawImage(
            picture,
            Math.floor((u - 0.25) * 2 * 48),
            0,
            1,
            48,
            column,
            top + height * 0.3,
            1,
            size,
          )
          context.globalAlpha = 1
        }
      }
    }

    const frame = (now: number) => {
      const seconds = Math.min(0.1, (now - last) / 1000)
      last = now
      progress += seconds / (move.kind === 'forward' ? FORWARD_S : TURN_S)
      while (progress >= 1) {
        progress -= 1
        walker = apply(walker, move)
        turnedLeft = move.kind === 'turn' && move.by === -1
        if (walker.at.x === maze.exit.x && walker.at.y === maze.exit.y) {
          maze = makeMaze(CELLS, CELLS, Math.random)
          walker = { at: maze.start, heading: 0 }
          turnedLeft = false
        }
        move = nextMove(maze.tiles, walker, turnedLeft)
      }
      draw(pose())
      handle = requestAnimationFrame(frame)
    }

    let handle = 0
    if (props.still) {
      // Less motion: one view down a corridor, no walking.
      picture.onload = () => draw(pose())
      draw(pose())
    } else {
      handle = requestAnimationFrame(frame)
    }
    onCleanup(() => cancelAnimationFrame(handle))
  })

  return (
    <button
      type="button"
      class={styles.mazeSaver}
      aria-label="Pigeon is asleep. Click or press any key to wake it."
      onClick={() => props.onWake()}
    >
      <canvas ref={canvas} class={styles.canvas} width={WIDTH} height={HEIGHT} />
    </button>
  )
}
