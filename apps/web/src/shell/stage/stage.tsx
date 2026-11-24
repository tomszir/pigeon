import { type JSX, Show } from 'solid-js'
import { CrtFilter } from './crt-filter.tsx'
import styles from './stage.module.css'
import type { Resolution } from './stage-scale.ts'

/**
 * The screen: the desktop drawn at its resolution at 1× and scaled by a whole number.
 * Pixel mode runs it through a filter that keeps one pixel of every 2×2 block, so text and bevels
 * look as they did at 1×; it is off while the CRT effect is on. The CRT effect runs the picture
 * through a live SVG filter (crt-filter.tsx) and lays the glass, a vignette and a rolling refresh
 * band over it.
 */
export function Stage(props: {
  scale: number
  screen: Resolution
  pixelMode: boolean
  crt: boolean
  children: JSX.Element
}) {
  const pixelated = () => props.pixelMode && props.scale === 2
  const frameFilter = () =>
    props.crt ? 'url(#pg-crt)' : pixelated() ? 'url(#pg-pixelate)' : 'none'
  return (
    <div
      class={styles.screen}
      style={{
        width: `${props.screen.width * props.scale}px`,
        height: `${props.screen.height * props.scale}px`,
        '--pg-scale': props.scale,
        // One scanline per screen row from 2×; at 1× every other device row, a little lighter.
        '--pg-scanline-period': `${Math.max(2, props.scale)}px`,
        '--pg-scanline-strength': props.scale >= 2 ? '24%' : '14%',
      }}
    >
      <svg class={styles.pixelFilter} aria-hidden="true" width="0" height="0">
        <filter
          id="pg-pixelate"
          x="0"
          y="0"
          width={props.screen.width * 2}
          height={props.screen.height * 2}
          filterUnits="userSpaceOnUse"
          primitiveUnits="userSpaceOnUse"
          color-interpolation-filters="sRGB"
        >
          <feFlood x="0" y="0" width="1" height="1" flood-color="#000000" flood-opacity="1" />
          <feComposite width="2" height="2" />
          <feTile result="grid" />
          <feComposite in="SourceGraphic" in2="grid" operator="in" result="dots" />
          <feOffset in="dots" dx="1" dy="0" result="o1" />
          <feOffset in="dots" dx="0" dy="1" result="o2" />
          <feOffset in="dots" dx="1" dy="1" result="o3" />
          <feMerge>
            <feMergeNode in="dots" />
            <feMergeNode in="o1" />
            <feMergeNode in="o2" />
            <feMergeNode in="o3" />
          </feMerge>
        </filter>
      </svg>
      <Show when={props.crt}>
        <CrtFilter
          id="pg-crt"
          width={props.screen.width * props.scale}
          height={props.screen.height * props.scale}
          scale={props.scale}
        />
      </Show>
      <div class={styles.frame} style={{ filter: frameFilter() }}>
        <div
          class={styles.stage}
          style={{
            width: `${props.screen.width}px`,
            height: `${props.screen.height}px`,
            transform: `scale(${props.scale})`,
          }}
        >
          {props.children}
        </div>
      </div>
      <Show when={props.crt}>
        <div class={styles.roll} aria-hidden="true" />
        <div class={styles.crtLayer} aria-hidden="true" />
      </Show>
    </div>
  )
}
