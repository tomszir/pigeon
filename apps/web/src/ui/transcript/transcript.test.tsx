import { fireEvent, render, screen } from '@solidjs/testing-library'
import { createSignal } from 'solid-js'
import { describe, expect, it, vi } from 'vitest'
import {
  groupTranscript,
  type MessageEntry,
  type SectionEntry,
  type TranscriptEntry,
} from './entries.ts'
import { Transcript } from './transcript.tsx'

const message = (id: string, extra: Partial<MessageEntry> = {}): MessageEntry => ({
  kind: 'message',
  id,
  from: 'Mika',
  own: false,
  text: `message ${id}`,
  ...extra,
})

describe('Transcript', () => {
  const entries: TranscriptEntry[] = [
    message('1', { text: 'wait, no server??' }),
    message('2', { text: 'prove it' }),
    { kind: 'buzz', id: '3', text: 'You have just sent a buzz!' },
    message('4', { from: 'Rook', own: true, text: 'nope' }),
  ]

  it('groups consecutive messages from one sender into a run', () => {
    const blocks = groupTranscript(entries)
    expect(blocks.map((block) => block.kind)).toEqual(['messages', 'single', 'messages'])
    expect(blocks[0]?.kind === 'messages' && blocks[0].entries.length).toBe(2)
  })

  it('keeps a friend who has your name apart from you, by who sent it', () => {
    const blocks = groupTranscript([
      message('1', { from: 'Rook', own: true }),
      message('2', { from: 'Rook', own: false }),
      message('3', { from: 'Rook', own: false, author: 'other-device' }),
      message('4', { from: 'Rook', own: false, author: 'other-device' }),
    ])
    expect(blocks.map((block) => block.kind === 'messages' && block.entries.length)).toEqual([
      1, 1, 2,
    ])
  })

  it('draws the friend’s messages as theirs when they are named like you', () => {
    render(() => (
      <Transcript
        label="Conversation"
        entries={[
          message('1', { from: 'Rook', own: true, text: 'mine' }),
          message('2', { from: 'Rook', own: false, text: 'theirs' }),
        ]}
      />
    ))
    const panel = (text: string) => screen.getByText(text).closest('[class*="_panel_"]')
    expect(panel('mine')?.closest('[class*="_run_"]')?.className).toMatch(/_mine_/)
    expect(panel('theirs')?.closest('[class*="_run_"]')?.className).not.toMatch(/_mine_/)
  })

  it('ends a run after ten quiet minutes, and at a day line', () => {
    const minute = 60_000
    const gap = (afterMinutes: number) =>
      groupTranscript([message('a', { at: 0 }), message('b', { at: afterMinutes * minute })]).length
    expect(gap(10)).toBe(1)
    expect(gap(11)).toBe(2)
    const day: TranscriptEntry = { kind: 'day', id: 'd', text: 'Today' }
    expect(groupTranscript([message('a'), day, message('b')])).toHaveLength(3)
  })

  it('is a polite live log, with the sender named once for a run, for screen readers', () => {
    render(() => <Transcript label="Conversation" entries={entries} />)
    const log = screen.getByRole('log')
    expect(log.getAttribute('aria-live')).toBe('polite')
    // The page selects nothing by default; the chat stays copyable.
    expect(log.hasAttribute('data-selectable')).toBe(true)
    expect(screen.getAllByText(/says:$/).map((label) => label.textContent)).toEqual([
      'Mika says:',
      'Rook says:',
    ])
  })

  it('draws day lines and the lines around the messages as text', () => {
    render(() => (
      <Transcript
        label="Conversation"
        entries={[
          { kind: 'day', id: 'd', text: 'Yesterday' },
          { kind: 'system', id: 's', text: 'Mika came online at 6:38 PM.' },
        ]}
      />
    ))
    expect(screen.getByText('Yesterday')).toBeTruthy()
    expect(screen.getByText('Mika came online at 6:38 PM.')).toBeTruthy()
  })

  it('draws the friend’s bird beside their runs, and not beside yours', () => {
    render(() => (
      <Transcript label="Conversation" entries={entries} bird={() => <i data-testid="bird" />} />
    ))
    expect(screen.getAllByTestId('bird')).toHaveLength(1)
  })
})

describe('the panels of a message', () => {
  it('shows the time on the last panel of each minute, and on any with a mark', () => {
    render(() => (
      <Transcript
        label="Conversation"
        entries={[
          message('1', { own: true, from: 'Rook', time: '9:58 PM', when: 'full 1' }),
          message('2', { own: true, from: 'Rook', time: '9:58 PM', when: 'full 2' }),
          message('3', {
            own: true,
            from: 'Rook',
            time: '9:59 PM',
            when: 'full 3',
            mark: { state: 'received', text: 'Received' },
          }),
        ]}
      />
    ))
    const times = screen.getAllByText(/PM$/)
    expect(times.map((time) => time.getAttribute('title'))).toEqual(['full 2', 'full 3'])
  })

  it('says a mark in words to screen readers, once, and keeps it as a drawing for the eyes', () => {
    render(() => (
      <Transcript
        label="Conversation"
        entries={[
          message('1', {
            own: true,
            from: 'Rook',
            time: '9:58 PM',
            mark: { state: 'mailed', text: 'Mailed', detail: "Left at Loft for when Mika's back" },
          }),
        ]}
      />
    ))
    expect(screen.getByText('message 1').textContent).toBe('message 1 Mailed.')
    const drawn = document.querySelector('[title="Left at Loft for when Mika\'s back"]')
    expect(drawn?.getAttribute('aria-hidden')).toBe('true')
  })

  it('has no mark where it was given none, even on the newest panel', () => {
    render(() => (
      <Transcript
        label="Conversation"
        entries={[message('1', { own: true, from: 'Rook', time: '9:58 PM' })]}
      />
    ))
    expect(document.querySelectorAll('[aria-hidden="true"]')).toHaveLength(0)
    expect(screen.getByText('message 1').textContent).toBe('message 1')
  })

  it('puts a note under the panel, with Try Again calling what it was given', async () => {
    const run = vi.fn()
    render(() => (
      <Transcript
        label="Conversation"
        entries={[
          message('1', {
            own: true,
            from: 'Rook',
            mark: { state: 'failed', text: 'Not mailed yet' },
            note: {
              text: 'Not mailed yet. Pigeon tries again at the next mail check.',
              bad: true,
              action: { label: 'Try Again', run },
            },
          }),
        ]}
      />
    ))
    expect(screen.getByText(/^Not mailed yet\. Pigeon tries again/)).toBeTruthy()
    // The note says it, so the mark doesn't say it a second time to a screen reader.
    expect(screen.getByText('message 1').textContent).toBe('message 1')
    await fireEvent.click(screen.getByRole('button', { name: 'Try Again' }))
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('says what a message waits for without a button or a mark', () => {
    render(() => (
      <Transcript
        label="Conversation"
        entries={[
          message('1', {
            own: true,
            from: 'Rook',
            note: { text: 'Waiting for Mika to be online', bad: false },
          }),
        ]}
      />
    ))
    expect(screen.getByText('Waiting for Mika to be online')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })
})

describe('the envelope', () => {
  const section: SectionEntry = {
    kind: 'section',
    id: 'letters-1',
    from: 'Mika',
    title: 'Mika left 2 messages while you were away',
    how: 'By letter, through Loft',
    label: '2 messages by letter, through Loft',
    entries: [message('1'), message('2')],
  }
  // Once open, the sealed panel is folded away and hidden from screen readers.
  const envelope = () =>
    screen.getByRole('button', {
      name: 'Open the letter from Mika, 2 messages by letter, through Loft',
      hidden: true,
    })
  const letter = () => document.querySelector('[class*="_letter_"]')

  it('folds what came by letter into one panel, named for who left it and how', () => {
    render(() => <Transcript label="Conversation" entries={[section]} />)
    expect(envelope().getAttribute('aria-expanded')).toBe('false')
    expect(screen.getByText('Mika left 2 messages while you were away')).toBeTruthy()
    expect(screen.getByText('By letter, through Loft')).toBeTruthy()
    // The messages are in the page the whole time, only folded: a screen reader reads them.
    expect(screen.getByText('message 1')).toBeTruthy()
    expect(screen.getByText('message 2')).toBeTruthy()
    expect(screen.getAllByText(/says:$/)).toHaveLength(1)
  })

  it('opens into ordinary panels under one etched line, and sends focus to the first message', async () => {
    render(() => <Transcript label="Conversation" entries={[section]} />)
    await fireEvent.click(envelope())
    expect(envelope().getAttribute('aria-expanded')).toBe('true')
    const opened = screen.getByRole('region', { name: '2 messages by letter, through Loft' })
    expect(opened.textContent).toContain('2 messages by letter, through Loft')
    await Promise.resolve()
    expect(document.activeElement).toBe(opened)
  })

  it('stays open when an earlier message joins its section', async () => {
    const [entries, setEntries] = createSignal<readonly TranscriptEntry[]>([section])
    render(() => <Transcript label="Conversation" entries={entries()} />)
    await fireEvent.click(envelope())
    setEntries([
      {
        ...section,
        id: 'letters-0',
        entries: [message('0'), ...section.entries],
      },
    ])
    expect(envelope().getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('message 0')).toBeTruthy()
  })

  it('shows a letter that comes in while the window is open already open', () => {
    const [entries, setEntries] = createSignal<readonly TranscriptEntry[]>([message('0')])
    render(() => <Transcript label="Conversation" entries={entries()} />)
    setEntries([message('0'), section])
    expect(envelope().getAttribute('aria-expanded')).toBe('true')
    // It was not there when the window opened: no envelope to open, and nothing to play.
    expect(letter()?.className).toMatch(/opened/)
  })

  it('keeps a section sealed that was there when the window opened, until it is opened', () => {
    const [entries, setEntries] = createSignal<readonly TranscriptEntry[]>([section])
    render(() => <Transcript label="Conversation" entries={entries()} />)
    setEntries([{ ...section, entries: [...section.entries, message('3')] }])
    expect(envelope().getAttribute('aria-expanded')).toBe('false')
  })

  it('keeps the node and the keyboard focus on Try Again when the transcript is drawn again', async () => {
    const run = vi.fn()
    const own = (extra: Partial<MessageEntry> = {}) =>
      message('1', {
        own: true,
        from: 'Rook',
        mark: { state: 'failed', text: 'Not mailed yet' },
        note: { text: 'Not mailed yet.', bad: true, action: { label: 'Try Again', run } },
        ...extra,
      })
    const [entries, setEntries] = createSignal<readonly TranscriptEntry[]>([own()])
    render(() => <Transcript label="Conversation" entries={entries()} />)
    const button = screen.getByRole('button', { name: 'Try Again' })
    button.focus()
    expect(document.activeElement).toBe(button)
    // Every redraw hands over new objects, and a later message in the same run.
    setEntries([own(), message('2', { own: true, from: 'Rook', text: 'and more' })])
    expect(screen.getByRole('button', { name: 'Try Again' })).toBe(button)
    expect(document.activeElement).toBe(button)
    expect(screen.getByText('and more')).toBeTruthy()
  })

  it('keeps an opened letter’s node, so its focus and opening are not cut, when drawn again', async () => {
    const [entries, setEntries] = createSignal<readonly TranscriptEntry[]>([section])
    render(() => <Transcript label="Conversation" entries={entries()} />)
    await fireEvent.click(envelope())
    await Promise.resolve()
    const group = screen.getByRole('region', { name: '2 messages by letter, through Loft' })
    const first = screen.getByText('message 1')
    expect(document.activeElement).toBe(group)
    setEntries([{ ...section, entries: [...section.entries, message('3')] }])
    expect(screen.getByRole('region', { name: '2 messages by letter, through Loft' })).toBe(group)
    expect(screen.getByText('message 1')).toBe(first)
    expect(document.activeElement).toBe(group)
  })

  it('stays open when a new message draws the transcript again, without opening again', async () => {
    const [entries, setEntries] = createSignal<readonly TranscriptEntry[]>([section])
    render(() => <Transcript label="Conversation" entries={entries()} />)
    await fireEvent.click(envelope())
    const node = letter()
    expect(node?.className).toMatch(/opening/)
    setEntries([{ ...section, entries: [...section.entries, message('3')] }])
    expect(envelope().getAttribute('aria-expanded')).toBe('true')
    // The same node: nothing remounted, so its opening plays on and isn't started again.
    expect(letter()).toBe(node)
    expect(screen.getByText('message 3')).toBeTruthy()
  })
})
