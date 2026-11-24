import { fireEvent, render, screen } from '@solidjs/testing-library'
import { describe, expect, it, vi } from 'vitest'
import { Check } from './check.tsx'

describe('Check', () => {
  it('toggles through its label', () => {
    const onChange = vi.fn()
    render(() => <Check label="&Mirror my page" checked={false} onChange={onChange} />)
    fireEvent.click(screen.getByLabelText('Mirror my page'))
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('draws radio buttons from the same component', () => {
    render(() => <Check kind="radio" name="route" label="Direct only" checked />)
    expect(screen.getByRole('radio', { name: 'Direct only' })).toHaveProperty('checked', true)
  })
})
