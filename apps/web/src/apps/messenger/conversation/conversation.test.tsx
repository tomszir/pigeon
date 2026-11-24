import { render, screen } from '@solidjs/testing-library'
import { expect, it } from 'vitest'
import { Conversation } from './conversation.tsx'

const props = {
  name: 'Mika',
  fingerprint: '7f3a 91c2 04be d817',
  route: 'direct, encrypted',
  connected: true,
  entries: [{ kind: 'message', id: 'm1', from: 'Mika', own: false, text: 'hi' }] as const,
  status: '',
  canBuzz: true,
  onSend: () => undefined,
  onBuzz: () => undefined,
  onClose: () => undefined,
  onAbout: () => undefined,
}

it('writes "is writing a message..." as the transcript\'s last line, and only while typing', () => {
  const { unmount } = render(() => (
    <Conversation {...props} typing="Mika is writing a message..." />
  ))
  const log = screen.getByRole('log')
  expect(log.lastElementChild?.textContent).toBe('Mika is writing a message...')
  unmount()
  render(() => <Conversation {...props} typing="" />)
  expect(screen.getByRole('log').textContent).not.toContain('is writing')
})
