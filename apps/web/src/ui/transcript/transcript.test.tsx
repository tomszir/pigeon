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
