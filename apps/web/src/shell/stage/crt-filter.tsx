// The CRT effect as a live SVG filter on the screen: the browser runs it on every
// frame of the real desktop, the closest thing to a fragment shader that HTML allows.
//
//   1. curvature: a displacement map pulls the picture in towards the corners;
//   2. colour fringing: red and blue are split off and nudged a fifth of a pixel either way;
//   3. scanlines: each screen row is multiplied by a darker band at its foot, kept light enough
//      that 1px details and 11px text survive;
//   4. bloom: a blurred copy is added back, so bright areas glow and fill their scanlines.
//
// Hit-testing ignores filters, so the curvature is kept to a few screen pixels at the corners.
import { createMemo, Show } from 'solid-js'

/** Corner shift in screen pixels. Edges move about half as far, the centre not at all. */
export const CURVATURE_PX = 2

export interface CrtFilterProps {
  id: string
  /** The screen's size in device pixels: its resolution times the scale. */
  width: number
  height: number
  scale: number
}

/**
 * How far to sample from the point (u, v), both -1 to 1 from the centre: outwards by the square of
 * the distance, reaching `shift` at the corners, which draws the picture in like a curved tube.
 */
export function barrelShift(u: number, v: number, shift: number): readonly [number, number] {
  const r2 = (u * u + v * v) / 2
  return [u * r2 * shift, v * r2 * shift]
}

/**
 * A displacement map for feDisplacementMap: red and green carry the x and y shift, 0.5 meaning
 * none. The shift grows with the square of the distance from the centre, a barrel bend.
 * Returns undefined where there's no canvas (tests), and the filter goes without curvature.
 */
export function barrelMap(range: number, shift: number): string | undefined {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext?.('2d')
  if (context === null || context === undefined) return undefined
  const image = context.createImageData(size, size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [dx, dy] = barrelShift((x / (size - 1)) * 2 - 1, (y / (size - 1)) * 2 - 1, shift)
      const at = (y * size + x) * 4
      image.data[at] = Math.round((0.5 + dx / range) * 255)
      image.data[at + 1] = Math.round((0.5 + dy / range) * 255)
      image.data[at + 2] = 128
      image.data[at + 3] = 255
    }
  }
  context.putImageData(image, 0, 0)
  return canvas.toDataURL('image/png')
}

export function CrtFilter(props: CrtFilterProps) {
  const shift = () => CURVATURE_PX * props.scale
  const range = () => shift() * 4
  const map = createMemo(() => barrelMap(range(), shift()))
  // One scanline per screen row; at 1× a row is one device pixel, so every other row instead.
  const period = () => Math.max(2, props.scale)
  const band = () => Math.max(1, Math.round(props.scale / 2))
  const fringe = () => 0.2 * props.scale

  return (
    <svg aria-hidden="true" width="0" height="0" style={{ position: 'absolute' }}>
      <filter
        id={props.id}
        x="0"
        y="0"
        width={props.width}
        height={props.height}
        filterUnits="userSpaceOnUse"
        primitiveUnits="userSpaceOnUse"
        color-interpolation-filters="sRGB"
      >
        <Show when={map()} fallback={<feOffset in="SourceGraphic" dx="0" dy="0" result="bent" />}>
          {(href) => (
            <>
              <feImage
                href={href()}
                x="0"
                y="0"
                width={props.width}
                height={props.height}
                preserveAspectRatio="none"
                result="map"
              />
              <feDisplacementMap
                in="SourceGraphic"
                in2="map"
                scale={range()}
                xChannelSelector="R"
                yChannelSelector="G"
                result="bent"
              />
            </>
          )}
        </Show>

        <feColorMatrix
          in="bent"
          type="matrix"
          values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"
          result="red"
        />
        <feOffset in="red" dx={-fringe()} dy="0" result="redShifted" />
        <feColorMatrix
          in="bent"
          type="matrix"
          values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0"
          result="green"
        />
        <feColorMatrix
          in="bent"
          type="matrix"
          values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0"
          result="blue"
        />
        <feOffset in="blue" dx={fringe()} dy="0" result="blueShifted" />
        <feBlend in="redShifted" in2="green" mode="screen" result="redGreen" />
        <feBlend in="redGreen" in2="blueShifted" mode="screen" result="fringed" />

        <feFlood x="0" y="0" width="1" height={period()} flood-color="#ffffff" result="rowLight" />
        <feFlood
          x="0"
          y={period() - band()}
          width="1"
          height={band()}
          flood-color="#b4b4b4"
          result="rowDark"
        />
        <feMerge x="0" y="0" width="1" height={period()} result="row">
          <feMergeNode in="rowLight" />
          <feMergeNode in="rowDark" />
        </feMerge>
        <feTile in="row" result="rows" />
        <feBlend in="fringed" in2="rows" mode="multiply" result="scanned" />

        {/* Only the brightest parts, above about 60%, glow. */}
        <feComponentTransfer in="fringed" result="bright">
          <feFuncR type="linear" slope="2.2" intercept="-1.3" />
          <feFuncG type="linear" slope="2.2" intercept="-1.3" />
          <feFuncB type="linear" slope="2.2" intercept="-1.3" />
        </feComponentTransfer>
        <feGaussianBlur in="bright" stdDeviation={1.6 * props.scale} result="glow" />
        <feComposite
          in="scanned"
          in2="glow"
          operator="arithmetic"
          k1="0"
          k2="1.03"
          k3="0.16"
          k4="0"
        />
      </filter>
    </svg>
  )
}
