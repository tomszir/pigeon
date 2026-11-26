import { fireEvent, render, screen } from '@solidjs/testing-library'
import { describe, expect, it } from 'vitest'
import { groupTranscript, Transcript, type TranscriptEntry } from './transcript.tsx'

describe('Transcript', () => {
  const entries: TranscriptEntry[] = [
    { kind: 'message', id: '1', from: 'Mika', own: false, text: 'wait, no server??' },
    { kind: 'message', id: '2', from: 'Mika', own: false, text: 'prove it' },
    { kind: 'buzz', id: '3', text: 'You have just sent a buzz!' },
    { kind: 'message', id: '4', from: 'Rook', own: true, text: 'nope' },
  ]

  it('groups consecutive messages from one sender', () => {
    const blocks = groupTranscript(entries)
    expect(blocks.map((block) => block.kind)).toEqual(['messages', 'single', 'messages'])
    expect(blocks[0]?.kind === 'messages' && blocks[0].entries.length).toBe(2)
  })

  it('is a polite live log with one label per run', () => {
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

  describe('the way of a message of yours', () => {
    const own = (id: string, state: 'has' | 'waiting', spelled: boolean): TranscriptEntry => ({
      kind: 'message',
      id,
      from: 'Rook',
      own: true,
      text: `message ${id}`,
      way: { state, text: `words ${id}`, spelled },
    })

    it('says an icon-only way to screen readers once, and shows it on click', async () => {
      render(() => <Transcript label="Conversation" entries={[own('a', 'has', false)]} />)
      // The button is named by its words, which nothing else on the page repeats until it opens.
      const way = screen.getByRole('button', { name: 'words a' })
      expect(screen.getAllByText('words a')).toHaveLength(1)
      await fireEvent.click(way)
      expect(screen.getAllByText('words a')).toHaveLength(2)
      await fireEvent.keyDown(way, { key: 'Escape' })
      expect(screen.getAllByText('words a')).toHaveLength(1)
    })

    it('closes the pinned words on a press elsewhere', async () => {
      render(() => <Transcript label="Conversation" entries={[own('a', 'has', false)]} />)
      await fireEvent.click(screen.getByRole('button', { name: 'words a' }))
      expect(screen.getAllByText('words a')).toHaveLength(2)
      await fireEvent.pointerDown(document.body)
      expect(screen.getAllByText('words a')).toHaveLength(1)
    })

    it('spells a way out in words under the message, with a decorative icon', () => {
      render(() => <Transcript label="Conversation" entries={[own('a', 'waiting', true)]} />)
      expect(screen.getAllByText('words a')).toHaveLength(1)
      expect(screen.queryByRole('button')).toBeNull()
    })
  })
})

describe('Transcript letters', () => {
  const heading = 'While you were away · 2 messages by letter, through Loft'
  const letter = (id: string): Extract<TranscriptEntry, { kind: 'message' }> => ({
    kind: 'message',
    id,
    from: 'Mika',
    own: false,
    text: `message ${id}`,
    route: { kind: 'letter', text: 'Came by letter, through Loft', through: 'Loft' },
  })
  const section: TranscriptEntry = {
    kind: 'section',
    id: 's',
    heading,
    entries: [letter('1'), letter('2')],
  }
  const envelopes = () => screen.getAllByRole('button', { name: 'Came by letter, through Loft' })

  it('puts messages that came together in one named section, with the sender said once', () => {
    render(() => <Transcript label="Conversation" entries={[section]} />)
    expect(screen.getByRole('region', { name: heading })).toBeTruthy()
    expect(screen.getAllByText(/says:$/)).toHaveLength(1)
    // Nothing visible under each message: an envelope for each, named by its words.
    expect(envelopes()).toHaveLength(2)
    expect(document.querySelectorAll('p[class*="route"]')).toHaveLength(0)
  })

  it('opens an envelope’s words on a click or tap, and closes them with Escape', () => {
    render(() => <Transcript label="Conversation" entries={[section]} />)
    const [first] = envelopes()
    if (first === undefined) throw new Error('no envelope')
    const shown = () => document.querySelectorAll('[aria-hidden="true"]:not([class*="icon"])')
    expect(shown()).toHaveLength(0)
    fireEvent.click(first)
    expect(shown()).toHaveLength(1)
    expect(shown()[0]?.textContent).toBe('Came by letter, through Loft')
    fireEvent.keyDown(first, { key: 'Escape' })
    expect(shown()).toHaveLength(0)
  })

  it('gives a lone message with a letter route its envelope, and no section', () => {
    render(() => <Transcript label="Conversation" entries={[letter('1')]} />)
    expect(screen.queryByRole('region', { name: heading })).toBeNull()
    expect(envelopes()).toHaveLength(1)
  })
})
