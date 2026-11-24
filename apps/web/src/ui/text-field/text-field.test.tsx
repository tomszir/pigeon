import { fireEvent, render, screen } from '@solidjs/testing-library'
import { describe, expect, it, vi } from 'vitest'
import { TextField } from './text-field.tsx'

describe('TextField', () => {
  it('ties its label to the input and reports what is typed', () => {
    const onInput = vi.fn()
    render(() => <TextField label="&Nickname:" value="Rook" onInput={onInput} />)
    const input = screen.getByLabelText('Nickname:')
    expect((input as HTMLInputElement).value).toBe('Rook')
    fireEvent.input(input, { target: { value: 'Rookie' } })
    expect(onInput).toHaveBeenCalledWith('Rookie')
  })

  it('submits a multi-line field on Enter but not on Shift+Enter', () => {
    const onSubmit = vi.fn()
    render(() => <TextField label="Message" labelHidden rows={4} value="" onSubmit={onSubmit} />)
    const area = screen.getByLabelText('Message')
    expect(area.tagName).toBe('TEXTAREA')
    fireEvent.keyDown(area, { key: 'Enter', shiftKey: true })
    expect(onSubmit).not.toHaveBeenCalled()
    fireEvent.keyDown(area, { key: 'Enter' })
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })
})
