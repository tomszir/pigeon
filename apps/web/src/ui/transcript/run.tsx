// A run of one sender's messages, drawn as panels: yours on the right in Luna blue, theirs on
// the left in warm grey with their bird beside the last. A panel carries the time (on the last
// of each minute) and, when it has one, its mark; a note under it says what it waits for.
import { createMemo, For, type JSX, Show } from 'solid-js'
import { classes } from '../classes/classes.ts'
import type { MessageEntry } from './entries.ts'
import styles from './run.module.css'

function Mark(props: { message: MessageEntry }) {
  return (
    <Show when={props.message.mark}>
      {(mark) => (
        <span
          class={classes(styles.mark, styles[mark().state])}
          title={mark().detail ?? mark().text}
          aria-hidden="true"
        />
      )}
    </Show>
  )
}

function Panel(props: {
  message: MessageEntry
  first: boolean
  last: boolean
  /** Whether the time shows: the last of its minute, or any with a mark. */
  meta: boolean
  /** Where it comes in when a letter opens, so panels appear one after another. */
  order?: number | undefined
}) {
  const note = () => props.message.note
  return (
    <div
      class={classes(
        styles.panel,
        props.first && styles.first,
        props.last && styles.last,
        props.order !== undefined && styles.arriving,
      )}
      style={props.order === undefined ? {} : { '--order': props.order }}
    >
      <p
        class={styles.text}
        style={props.message.color === undefined ? {} : { color: props.message.color }}
      >
        {props.message.text}
        <Show when={props.message.mark && note() === undefined}>
          <span class={styles.words}> {props.message.mark?.text}.</span>
        </Show>
      </p>
      <Show when={note()}>
        {(line) => (
          <p class={classes(styles.note, line().bad && styles.bad)}>
            {line().text}
            <Show when={line().action}>
              {(action) => (
                <>
                  {' '}
                  <button type="button" class={styles.action} onClick={() => action().run()}>
                    {action().label}
                  </button>
                </>
              )}
            </Show>
          </p>
        )}
      </Show>
      <Show
        when={props.meta && (props.message.time !== undefined || props.message.mark !== undefined)}
      >
        <span class={styles.meta}>
          <Show when={props.message.time}>
            {(time) => (
              <time
                title={props.message.when}
                {...(props.message.at === undefined
                  ? {}
                  : { datetime: new Date(props.message.at).toISOString() })}
              >
                {time()}
              </time>
            )}
          </Show>
          <Mark message={props.message} />
        </span>
      </Show>
    </div>
  )
}

export function Run(props: {
  from: string
  entries: readonly MessageEntry[]
  /** The friend's bird, beside the last panel of theirs. */
  bird?: (() => JSX.Element) | undefined
  /** Set inside an opening letter: the position of this run's first panel among its panels. */
  firstOrder?: number | undefined
}) {
  const own = () => props.entries[0]?.own === true
  const lastOfMinute = (index: number) =>
    index === props.entries.length - 1 ||
    props.entries[index + 1]?.time !== props.entries[index]?.time
  // Panels are kept by message id, not by the objects a redraw hands over, so a panel keeps its
  // node (and the focus on its Try Again) while the chat changes around it.
  const ids = createMemo(() => props.entries.map((entry) => entry.id))
  const byId = createMemo(() => new Map(props.entries.map((entry) => [entry.id, entry])))
  return (
    <div class={classes(styles.run, own() && styles.mine)}>
      <Show when={!own() && props.bird}>
        {(bird) => <span class={styles.bird}>{bird()()}</span>}
      </Show>
      <div class={styles.column}>
        <p class={styles.words}>{props.from} says:</p>
        <For each={ids()}>
          {(id, index) => {
            let latest = byId().get(id) as MessageEntry
            const message = () => {
              latest = byId().get(id) ?? latest
              return latest
            }
            return (
              <Panel
                message={message()}
                first={index() === 0}
                last={index() === props.entries.length - 1}
                meta={lastOfMinute(index()) || message().mark !== undefined}
                order={props.firstOrder === undefined ? undefined : props.firstOrder + index()}
              />
            )
          }}
        </For>
      </div>
    </div>
  )
}

/** The friend writing: "Rook is writing a message...", as a faint panel of theirs. */
export function TypingPanel(props: { text: string; bird?: (() => JSX.Element) | undefined }) {
  return (
    <div class={styles.run}>
      <Show when={props.bird}>{(bird) => <span class={styles.bird}>{bird()()}</span>}</Show>
      <div class={styles.column}>
        <div class={classes(styles.panel, styles.first, styles.last, styles.typing)}>
          <p class={styles.text}>{props.text}</p>
        </div>
      </div>
    </div>
  )
}
