import { fireEvent, render, screen } from '@solidjs/testing-library'
import { describe, expect, it, vi } from 'vitest'
import { brandIcon } from '../icons/icons.ts'
import { DesktopIcon } from './desktop-icon.tsx'

describe('DesktopIcon', () => {
  function renderIcon() {
    const onSelect = vi.fn()
    const onOpen = vi.fn()
    render(() => (
      <DesktopIcon
        icon={brandIcon('pigeon-32')}
        label="Pigeon Messenger"
        selected={false}
        onSelect={onSelect}
        onOpen={onOpen}
      />
    ))
    return { onSelect, onOpen, icon: screen.getByRole('button', { name: 'Pigeon Messenger' }) }
  }

  it('selects on one click and opens on a double click', () => {
    const { onSelect, onOpen, icon } = renderIcon()
    fireEvent.click(icon)
    expect(onSelect).toHaveBeenCalled()
    expect(onOpen).not.toHaveBeenCalled()
    fireEvent.dblClick(icon)
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('opens on Enter', () => {
    const { onOpen, icon } = renderIcon()
    fireEvent.keyDown(icon, { key: 'Enter' })
    expect(onOpen).toHaveBeenCalledTimes(1)
  })
})
