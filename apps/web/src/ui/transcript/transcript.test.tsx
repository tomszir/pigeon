import { render, screen } from '@solidjs/testing-library'
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
})
