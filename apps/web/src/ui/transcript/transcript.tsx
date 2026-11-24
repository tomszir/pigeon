// A conversation's transcript. Consecutive messages from one sender sit under one "says:" label.
import { createEffect, For, type JSX, Match, on, Switch } from 'solid-js'
import { classes } from '../classes/classes.ts'
import { ScrollArea } from '../scroll-area/scroll-area.tsx'
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
    }
  | {
      readonly kind: 'buzz' | 'letter' | 'system' | 'error'
      readonly id: string
      readonly text: string
    }
  | { readonly kind: 'custom'; readonly id: string; readonly content: () => JSX.Element }

type MessageEntry = Extract<TranscriptEntry, { kind: 'message' }>

export type TranscriptBlock =
  | { readonly kind: 'messages'; readonly from: string; readonly entries: readonly MessageEntry[] }
  | { readonly kind: 'single'; readonly entry: Exclude<TranscriptEntry, MessageEntry> }

/** Groups runs of messages from the same sender. */
export function groupTranscript(entries: readonly TranscriptEntry[]): TranscriptBlock[] {
  const blocks: TranscriptBlock[] = []
  for (const entry of entries) {
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
      <div role="log" aria-live="polite" class={styles.log}>
        <For each={groupTranscript(props.entries)}>
          {(block) => (
            <Switch>
              <Match when={block.kind === 'messages' ? block : undefined}>
                {(run) => (
                  <div>
                    <p class={styles.says}>{run().from} says:</p>
                    <For each={run().entries}>
                      {(message) => (
                        <p
                          class={classes(styles.text, message.own && styles.own)}
                          style={message.color === undefined ? {} : { color: message.color }}
                        >
                          {message.text}
                        </p>
                      )}
                    </For>
                  </div>
                )}
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
