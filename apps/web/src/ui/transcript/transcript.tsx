// A conversation's transcript, drawn as panels: runs of one sender's messages, a day line between
// days, the small etched lines of what happened around them, and a pixel envelope for what came by
// letter while you were away.
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  Match,
  on,
  Switch,
  untrack,
} from 'solid-js'
import { classes } from '../classes/classes.ts'
import { ScrollArea } from '../scroll-area/scroll-area.tsx'
import {
  blockKey,
  groupTranscript,
  type SectionEntry,
  type TranscriptBlock,
  type TranscriptEntry,
} from './entries.ts'
import { LetterEnvelope } from './letter-envelope.tsx'
import { Run, TypingPanel } from './run.tsx'
import styles from './transcript.module.css'

export function Transcript(props: {
  label: string
  entries: readonly TranscriptEntry[]
  /** The friend's bird, shown beside the last panel of each run of theirs. */
  bird?: (() => JSX.Element) | undefined
}) {
  let scroller: HTMLElement | undefined
  createEffect(
    on(
      () => props.entries.length,
      () => scroller?.scrollTo?.({ top: scroller.scrollHeight }),
    ),
  )
  // Messages that were in the chat when the window opened, and those of letters opened since.
  // Kept by message id, since a letter's section is named by its first message, which changes
  // when an earlier one joins it.
  const present = untrack(
    () =>
      new Set(
        props.entries.flatMap((entry) => {
          if (entry.kind === 'message') return [entry.id]
          return entry.kind === 'section' ? entry.entries.map((message) => message.id) : []
        }),
      ),
  )
  const sectionIds = (entry: SectionEntry) => entry.entries.map((message) => message.id)
  const [opened, setOpened] = createSignal<ReadonlySet<string>>(new Set())
  // A letter that came in while the window was open has nothing to wait for: it is shown open.
  const isOpen = (entry: SectionEntry) =>
    sectionIds(entry).some((id) => opened().has(id)) ||
    entry.entries.every((message) => !present.has(message.id))

  // Each block is kept by its key and drawn from the newest one with it, so a redraw with new
  // objects doesn't remount what is on screen: its animation, and the focus in it, carry on.
  const blocks = createMemo(() => groupTranscript(props.entries))
  const keys = createMemo(() => blocks().map(blockKey))
  const blockOf = (key: string): TranscriptBlock | undefined =>
    blocks().find((block) => blockKey(block) === key)
  const runOf = (block: TranscriptBlock | undefined) =>
    block?.kind === 'messages' ? block : undefined
  const sectionOf = (block: TranscriptBlock | undefined) =>
    block?.kind === 'section' ? block.entry : undefined
  const singleOf = (block: TranscriptBlock | undefined) =>
    block?.kind === 'single' ? block.entry : undefined

  return (
    <ScrollArea
      class={styles.transcript}
      label={props.label}
      ref={(element) => {
        scroller = element
      }}
    >
      <div role="log" aria-live="polite" class={styles.log} data-selectable>
        <For each={keys()}>
          {(key) => {
            const block = () => blockOf(key)
            return (
              <Switch>
                <Match when={runOf(block())}>
                  {(run) => <Run from={run().from} entries={run().entries} bird={props.bird} />}
                </Match>
                <Match when={sectionOf(block())}>
                  {(section) => (
                    <LetterEnvelope
                      section={section()}
                      open={isOpen(section())}
                      bird={props.bird}
                      onOpen={() => setOpened((all) => new Set([...all, ...sectionIds(section())]))}
                    />
                  )}
                </Match>
                <Match when={singleOf(block())}>
                  {(entry) => {
                    const current = entry()
                    if (current.kind === 'custom') return current.content()
                    if (current.kind === 'day')
                      return (
                        <p class={classes(styles.line, styles.day)}>
                          <span>{current.text}</span>
                        </p>
                      )
                    if (current.kind === 'typing')
                      return <TypingPanel text={current.text} bird={props.bird} />
                    return (
                      <p
                        class={classes(
                          styles.line,
                          current.kind === 'system' && styles.system,
                          current.kind === 'buzz' && styles.buzz,
                          current.kind === 'error' && styles.error,
                        )}
                      >
                        <span>{current.text}</span>
                      </p>
                    )
                  }}
                </Match>
              </Switch>
            )
          }}
        </For>
      </div>
    </ScrollArea>
  )
}
