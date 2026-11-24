// The Pocket asleep (decision 0019): the backlight down to a third over the wallpaper, a big clock
// and the date, and a line about anything new. A tap or any key wakes it.
import { createSignal, onCleanup, onMount, Show } from 'solid-js'
import wallpaper from '../../wallpapers/hills-800x600.jpg'
import styles from './pocket-standby.module.css'

export function PocketStandby(props: {
  now: () => Date
  /** "1 new from Mika", or nothing. */
  news?: string | undefined
  onWake: () => void
}) {
  const [time, setTime] = createSignal(props.now())
  const timer = setInterval(() => setTime(props.now()), 15_000)
  onCleanup(() => clearInterval(timer))
  onMount(() => {
    const wake = () => props.onWake()
    document.addEventListener('keydown', wake, { once: true })
    onCleanup(() => document.removeEventListener('keydown', wake))
  })

  const clock = () => time().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  const date = () =>
    time().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })

  return (
    <button
      type="button"
      class={styles.standby}
      aria-label="The Pocket is asleep. Tap to wake it."
      onClick={() => props.onWake()}
    >
      <span class={styles.wallpaper} style={{ 'background-image': `url("${wallpaper}")` }} />
      <span class={styles.face}>
        <span class={styles.clock}>{clock()}</span>
        <span class={styles.date}>{date()}</span>
        <Show when={props.news}>{(news) => <span class={styles.news}>{news()}</span>}</Show>
      </span>
      <span class={styles.hint}>Tap to wake</span>
    </button>
  )
}
