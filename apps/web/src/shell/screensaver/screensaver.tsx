// The desktop's screen saver while Pigeon is turned off: pigeons flying across a night sky, on the
// monitor's screen (CRT and all). A click or any key wakes Pigeon as it was.
import { For, onCleanup, onMount } from 'solid-js'
import { brand } from '../../ui/icons/icons.ts'
import styles from './screensaver.module.css'

/** The flock: height on screen (%), seconds to cross, head start (s), size (px). */
export const FLOCK = [
  { top: 16, seconds: 15, start: 0, size: 48 },
  { top: 38, seconds: 21, start: 7, size: 32 },
  { top: 58, seconds: 12, start: 3, size: 48 },
  { top: 27, seconds: 26, start: 16, size: 24 },
  { top: 72, seconds: 17, start: 10, size: 32 },
] as const

/** Stars as (left %, top %, twinkle delay s), fixed so the sky looks the same each time. */
const STARS = [
  [6, 8, 0],
  [14, 22, 1.2],
  [23, 6, 2.1],
  [31, 30, 0.6],
  [42, 12, 1.8],
  [51, 26, 2.7],
  [60, 7, 0.3],
  [68, 19, 1.5],
  [77, 33, 2.4],
  [85, 10, 0.9],
  [93, 24, 2],
  [10, 44, 1.1],
  [37, 48, 2.6],
  [64, 42, 0.4],
  [88, 50, 1.7],
] as const

export function Screensaver(props: { onWake: () => void }) {
  onMount(() => {
    const wake = () => props.onWake()
    document.addEventListener('keydown', wake, { once: true })
    onCleanup(() => document.removeEventListener('keydown', wake))
  })

  return (
    <button
      type="button"
      class={styles.screensaver}
      aria-label="Pigeon is asleep. Click or press any key to wake it."
      onClick={() => props.onWake()}
    >
      <For each={STARS}>
        {([left, top, delay]) => (
          <span
            class={styles.star}
            style={{ left: `${left}%`, top: `${top}%`, 'animation-delay': `${delay}s` }}
          />
        )}
      </For>
      <For each={FLOCK}>
        {(bird) => (
          <span
            class={styles.bird}
            style={{
              top: `${bird.top}%`,
              'animation-duration': `${bird.seconds}s`,
              'animation-delay': `-${bird.start}s`,
            }}
          >
            <img
              src={brand(bird.size >= 48 ? 'pigeon-48' : 'pigeon-32')}
              alt=""
              width={bird.size}
              height={bird.size}
            />
          </span>
        )}
      </For>
      <span class={styles.hint}>Pigeon is asleep. Click to wake.</span>
    </button>
  )
}
