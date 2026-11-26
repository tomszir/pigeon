// A conversation's transcript. Consecutive messages from one sender sit under one "says:" label.
import { createEffect, createUniqueId, For, type JSX, Match, on, Show, Switch } from 'solid-js'
import { classes } from '../classes/classes.ts'
import { ScrollArea } from '../scroll-area/scroll-area.tsx'
import { MessageWay } from './message-way.tsx'
import styles from './transcript.module.css'

export type TranscriptEntry =
  | {
      readonly kind: 'message'
      readonly id: string
      readonly from: string
      readonly own: boolean
      readonly text: string
      /** The sender's chosen font colour. */
      readonly color?: string
      /**
       * That it came by letter: a small envelope after the message opens "Came by letter,
       * through Loft".
       */
      readonly route?: {
        readonly kind: 'letter'
        readonly text: string
        /** The Lighthouse that brought it. */
        readonly through: string
      }
      /**
       * How a message of yours is getting there: an icon after it, with its words on hover and
       * click, and under it when it needs attention or is the newest.
       */
      readonly way?: MessageWay
    }
  | {
      /** `typing` is the live "is writing a message..." line, drawn last. */
      readonly kind: 'buzz' | 'letter' | 'system' | 'error' | 'typing'
      readonly id: string
      readonly text: string
    }
  | { readonly kind: 'custom'; readonly id: string; readonly content: () => JSX.Element }
  | {
      /**
       * Messages that came together, under a heading of their own: "While you were away · 3
       * messages by letter, through Loft".
       */
      readonly kind: 'section'
      readonly id: string
      readonly heading: string
      readonly entries: readonly Extract<TranscriptEntry, { kind: 'message' }>[]
    }

type MessageEntry = Extract<TranscriptEntry, { kind: 'message' }>
type SectionEntry = Extract<TranscriptEntry, { kind: 'section' }>

export type TranscriptBlock =
  | { readonly kind: 'messages'; readonly from: string; readonly entries: readonly MessageEntry[] }
  | { readonly kind: 'section'; readonly entry: SectionEntry }
  | {
      readonly kind: 'single'
      readonly entry: Exclude<TranscriptEntry, MessageEntry | SectionEntry>
    }

/** Groups runs of messages from the same sender. */
export function groupTranscript(entries: readonly TranscriptEntry[]): TranscriptBlock[] {
  const blocks: TranscriptBlock[] = []
  for (const entry of entries) {
    if (entry.kind === 'section') {
      blocks.push({ kind: 'section', entry })
      continue
    }
    if (entry.kind !== 'message') {
      blocks.push({ kind: 'single', entry })
      continue
    }
    const last = blocks[blocks.length - 1]
    if (last?.kind === 'messages' && last.from === entry.from) {
      blocks[blocks.length - 1] = { ...last, entries: [...last.entries, entry] }
    } else {
      blocks.push({ kind: 'messages', from: entry.from, entries: [entry] })
    }
  }
  return blocks
}

/** One message with its notes; a letter's envelope or the way of one of yours follows it. */
function Message(props: { message: MessageEntry }) {
  return (
    <div class={styles.row}>
      <p
        class={classes(styles.text, props.message.own && styles.own)}
        style={props.message.color === undefined ? {} : { color: props.message.color }}
      >
        {props.message.text}
        <Show when={props.message.route}>
          {(route) => <MessageWay way={{ state: 'letter', text: route().text, spelled: false }} />}
        </Show>
        <Show when={props.message.way}>{(way) => <MessageWay way={way()} />}</Show>
      </p>
      <Show when={props.message.way?.spelled ? props.message.way : undefined}>
        {(way) => (
          <p
            class={classes(
              styles.route,
              way().state === 'has' ? styles.routeDone : styles.routeWaiting,
            )}
          >
            {way().text}
            <Show when={way().action}>
              {(action) => (
                <>
                  {' '}
                  <button type="button" class={styles.routeAction} onClick={() => action().run()}>
                    {action().label}
                  </button>
                </>
              )}
            </Show>
          </p>
        )}
      </Show>
    </div>
  )
}

export function Transcript(props: { label: string; entries: readonly TranscriptEntry[] }) {
  let scroller: HTMLElement | undefined
  createEffect(
    on(
      () => props.entries.length,
      () => scroller?.scrollTo?.({ top: scroller.scrollHeight }),
    ),
  )

  return (
    <ScrollArea
      class={styles.transcript}
      label={props.label}
      ref={(element) => {
        scroller = element
      }}
    >
      <div role="log" aria-live="polite" class={styles.log} data-selectable>
        <For each={groupTranscript(props.entries)}>
          {(block) => (
            <Switch>
              <Match when={block.kind === 'messages' ? block : undefined}>
                {(run) => (
                  <div>
                    <p class={styles.says}>{run().from} says:</p>
                    <For each={run().entries}>{(message) => <Message message={message} />}</For>
                  </div>
                )}
              </Match>
              <Match when={block.kind === 'section' ? block.entry : undefined}>
                {(section) => {
                  const headingId = createUniqueId()
                  return (
                    <section aria-labelledby={headingId} class={styles.section}>
                      <p id={headingId} class={styles.sectionHeading}>
                        {section().heading}
                      </p>
                      <For each={groupTranscript(section().entries)}>
                        {(run) =>
                          run.kind === 'messages' && (
                            <div>
                              <p class={styles.says}>{run.from} says:</p>
                              <For each={run.entries}>
                                {(message) => <Message message={message} />}
                              </For>
                            </div>
                          )
                        }
                      </For>
                    </section>
                  )
                }}
              </Match>
              <Match when={block.kind === 'single' ? block.entry : undefined}>
                {(entry) => {
                  const current = entry()
                  return current.kind === 'custom' ? (
                    current.content()
                  ) : (
                    <p class={classes(styles.notice, styles[current.kind])}>
                      {current.kind === 'letter' ? '◆ ' : ''}
                      {current.text}
                    </p>
                  )
                }}
              </Match>
            </Switch>
          )}
        </For>
      </div>
    </ScrollArea>
  )
}
