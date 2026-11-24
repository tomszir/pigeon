import { fireEvent, render, screen } from '@solidjs/testing-library'
import { createSignal } from 'solid-js'
import { describe, expect, it } from 'vitest'
import { Select } from './select.tsx'

const options = [
  { value: 'online', label: 'Online' },
  { value: 'away', label: 'Away' },
  { value: 'busy', label: 'Busy' },
]

/** A Select wired to its own state, as a real caller would. */
function renderSelect(initial = 'away') {
  const [value, setValue] = createSignal(initial)
  render(() => <Select label="&Status:" options={options} value={value()} onChange={setValue} />)
  return { value, box: screen.getByRole('combobox', { name: 'Status:' }) }
}

describe('Select', () => {
  it('shows the chosen option and draws its list inside the page, not as a native popup', () => {
    const { box } = renderSelect()
    expect(box.textContent).toBe('Away')
    expect(document.querySelector('select')).toBeNull()
    fireEvent.click(box)
    expect(box.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Online',
      'Away',
      'Busy',
    ])
  })

  it('picks an option with a click and closes', () => {
    const { box, value } = renderSelect()
    fireEvent.click(box)
    fireEvent.click(screen.getByRole('option', { name: 'Busy' }))
    expect(value()).toBe('busy')
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('changes the choice with the arrows while closed, as the era’s list boxes did', () => {
    const { box, value } = renderSelect()
    fireEvent.keyDown(box, { key: 'ArrowDown' })
    expect(value()).toBe('busy')
    fireEvent.keyDown(box, { key: 'ArrowUp' })
    fireEvent.keyDown(box, { key: 'ArrowUp' })
    expect(value()).toBe('online')
  })

  it('opens on Alt+Down, moves the highlight, and picks on Enter', () => {
    const { box, value } = renderSelect('online')
    fireEvent.keyDown(box, { key: 'ArrowDown', altKey: true })
    expect(box.getAttribute('aria-expanded')).toBe('true')
    fireEvent.keyDown(box, { key: 'ArrowDown' })
    expect(value()).toBe('online')
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(value()).toBe('away')
    expect(box.getAttribute('aria-expanded')).toBe('false')
  })

  it('closes on Escape without changing anything', () => {
    const { box, value } = renderSelect()
    fireEvent.click(box)
    fireEvent.keyDown(box, { key: 'ArrowDown' })
    fireEvent.keyDown(box, { key: 'Escape' })
    expect(value()).toBe('away')
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('jumps to an option by its first letter', () => {
    const { box, value } = renderSelect()
    fireEvent.keyDown(box, { key: 'b' })
    expect(value()).toBe('busy')
  })

  it('closes when the pointer goes down elsewhere', () => {
    const { box } = renderSelect()
    fireEvent.click(box)
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('listbox')).toBeNull()
  })
})
