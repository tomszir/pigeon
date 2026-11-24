import { fireEvent, render, screen } from '@solidjs/testing-library'
import { describe, expect, it, vi } from 'vitest'
import { ContactList } from './contact-list.tsx'

describe('ContactList', () => {
  const groups = [
    {
      id: 'online',
      label: 'Online',
      contacts: [
        { id: 'mika', name: 'Mika', presence: 'online' as const },
        { id: 'ola', name: 'Ola', presence: 'away' as const, note: '(Away)' },
      ],
    },
  ]

  it('counts each group, collapses it, and opens a contact on double click', () => {
    const onOpen = vi.fn()
    render(() => <ContactList label="Friends" groups={groups} onOpen={onOpen} />)
    const heading = screen.getByRole('button', { name: /Online \(2\)/ })
    fireEvent.dblClick(screen.getByRole('button', { name: /Mika/ }))
    expect(onOpen).toHaveBeenCalledWith('mika')
    fireEvent.click(heading)
    expect(screen.queryByRole('button', { name: /Mika/ })).toBeNull()
  })

  it('opens on one tap of a finger, and only selects on a mouse click', () => {
    const onOpen = vi.fn()
    const onSelect = vi.fn()
    render(() => (
      <ContactList label="Friends" groups={groups} onOpen={onOpen} onSelect={onSelect} />
    ))
    const mika = screen.getByRole('button', { name: /Mika/ })
    fireEvent.pointerDown(mika, { pointerType: 'mouse' })
    fireEvent.click(mika)
    expect(onSelect).toHaveBeenCalledWith('mika')
    expect(onOpen).not.toHaveBeenCalled()
    fireEvent.pointerDown(mika, { pointerType: 'touch' })
    fireEvent.click(mika)
    expect(onOpen).toHaveBeenCalledWith('mika')
  })

  it('says so when there is nobody', () => {
    render(() => <ContactList label="Friends" groups={[]} empty="No friends yet." />)
    expect(screen.getByText('No friends yet.')).toBeTruthy()
  })
})
