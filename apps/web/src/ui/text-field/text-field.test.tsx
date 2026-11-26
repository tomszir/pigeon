import { fireEvent, render, screen } from '@solidjs/testing-library'
import { createSignal } from 'solid-js'
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

  it('marks text typed in it as unsent until it is emptied, but not text it was given', () => {
    const [value, setValue] = createSignal('Rook')
    render(() => <TextField label="Name" value={value()} onInput={setValue} />)
    const input = screen.getByLabelText('Name')
    expect(input.hasAttribute('data-unsent')).toBe(false)
    fireEvent.input(input, { target: { value: 'Rookie' } })
    expect(input.hasAttribute('data-unsent')).toBe(true)
    setValue('')
    expect(input.hasAttribute('data-unsent')).toBe(false)
  })

  it('marks a multi-line field the same way, and leaves out a field that opts out', () => {
    render(() => (
      <>
        <TextField label="Message" rows={3} value="hi" />
        <TextField label="Address" value="pigeon://x" keepsDraft={false} />
      </>
    ))
    const area = screen.getByLabelText('Message')
    fireEvent.input(area, { target: { value: 'hi there' } })
    expect(area.hasAttribute('data-unsent')).toBe(true)
    const address = screen.getByLabelText('Address')
    fireEvent.input(address, { target: { value: 'pigeon://y' } })
    expect(address.hasAttribute('data-unsent')).toBe(false)
  })
})
