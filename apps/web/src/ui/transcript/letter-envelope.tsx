// Messages that came by letter while you were away, folded into a pixel-art envelope on a panel
// from the sender. Opening it plays the envelope's few stepped frames, folds the panel away and
// lets the messages in as ordinary panels, under one small etched line saying how they came.
// They are in the page the whole time, only folded, so a screen reader reads them with no click.
import { createMemo, createUniqueId, For, type JSX, untrack } from 'solid-js'
import { classes } from '../classes/classes.ts'
import { blockKey, groupTranscript, type SectionEntry } from './entries.ts'
import styles from './letter-envelope.module.css'
import { Run } from './run.tsx'

export function LetterEnvelope(props: {
  section: SectionEntry
  /** Whether it's open: kept by the transcript, so a new message doesn't close it. */
  open: boolean
  onOpen: () => void
  bird?: (() => JSX.Element) | undefined
}) {
  let body: HTMLElement | undefined
  const bodyId = createUniqueId()
  // One that is drawn open, because the chat drew its entries again, doesn't play the opening again.
  const settled = untrack(() => props.open)
  const playing = () => props.open && !settled

  // The runs inside, kept by their first message so a redraw doesn't remount them.
  const runs = createMemo(() => {
    let order = 0
    return groupTranscript(props.section.entries).flatMap((block) => {
      if (block.kind !== 'messages') return []
      const first = order
      order += block.entries.length
      return [{ key: blockKey(block), block, first }]
    })
  })
  const runKeys = createMemo(() => runs().map((run) => run.key))
  const runOf = (key: string) => runs().find((run) => run.key === key)
  const open = () => {
    props.onOpen()
    // The sealed panel folds away, so focus goes to the first message instead.
    queueMicrotask(() => body?.focus({ preventScroll: true }))
  }

  return (
    <div class={classes(styles.letter, props.open && (settled ? styles.opened : styles.opening))}>
      <div class={styles.sealed} aria-hidden={props.open ? 'true' : undefined}>
        <div class={styles.row}>
          {props.bird?.()}
          <button
            type="button"
            class={styles.seal}
            aria-expanded={props.open}
            aria-controls={bodyId}
            aria-label={`Open the letter from ${props.section.from}, ${props.section.label}`}
            disabled={props.open}
            onClick={open}
          >
            <span class={styles.envelope} aria-hidden="true" />
            <span class={styles.words}>
              <b>{props.section.title}</b>
              <span>{props.section.how}</span>
              <span class={styles.hint}>Click to open</span>
            </span>
          </button>
        </div>
      </div>
      <div class={styles.fold}>
        <section
          id={bodyId}
          ref={body}
          tabindex="-1"
          aria-label={props.section.label}
          class={styles.inside}
        >
          <p class={styles.line}>
            <span class={styles.mail} aria-hidden="true" />
            {props.section.label}
          </p>
          <For each={runKeys()}>
            {(key) => (
              <Run
                from={runOf(key)?.block.from ?? ''}
                entries={runOf(key)?.block.entries ?? []}
                bird={props.bird}
                firstOrder={playing() ? runOf(key)?.first : undefined}
              />
            )}
          </For>
        </section>
      </div>
    </div>
  )
}
