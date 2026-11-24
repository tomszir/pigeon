import { Button } from '../../ui/button/button.tsx'
import { brand } from '../../ui/icons/icons.ts'
import styles from './closed-screen.module.css'

/** What's left after Close Pigeon. */
export function ClosedScreen(props: { onReopen: () => void }) {
  return (
    <div class={styles.closed}>
      <img src={brand('pigeon-128')} alt="" width="128" height="128" />
      <p>Pigeon has closed. You can close this tab now.</p>
      <Button label="&Open Pigeon again" onClick={props.onReopen} />
    </div>
  )
}
