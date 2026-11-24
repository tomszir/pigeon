import { fireEvent, render, screen } from '@solidjs/testing-library'
import { describe, expect, it, vi } from 'vitest'
import { Tabs } from './tabs.tsx'

const tabs = [
  { id: 'general', label: 'General', content: () => <p>General settings</p> },
  { id: 'network', label: 'Network', content: () => <p>Network settings</p> },
  { id: 'mirrors', label: 'Mirrors', content: () => <p>Mirror settings</p> },
]

describe('Tabs', () => {
  it('shows the first tab and switches on click', () => {
    const onSelect = vi.fn()
    render(() => <Tabs label="Settings" tabs={tabs} onSelect={onSelect} />)
    expect(screen.getByRole('tabpanel').textContent).toBe('General settings')
    fireEvent.click(screen.getByRole('tab', { name: 'Network' }))
    expect(screen.getByRole('tab', { name: 'Network' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tabpanel').textContent).toBe('Network settings')
    expect(onSelect).toHaveBeenCalledWith('network')
  })

  it.each([
    ['ArrowRight', 'general', 'network'],
    ['ArrowLeft', 'general', 'mirrors'],
    ['End', 'general', 'mirrors'],
    ['Home', 'mirrors', 'general'],
  ])('%s moves from %s to %s', (key, from, to) => {
    render(() => <Tabs label="Settings" tabs={tabs} initial={from} />)
    const start = screen.getByRole('tab', { selected: true })
    fireEvent.keyDown(start, { key })
    const selected = screen.getByRole('tab', { selected: true })
    expect(selected.id.endsWith(to)).toBe(true)
    expect(document.activeElement).toBe(selected)
    expect(selected.tabIndex).toBe(0)
  })
})
