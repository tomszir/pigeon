import { fireEvent, render, screen } from '@solidjs/testing-library'
import { describe, expect, it, vi } from 'vitest'
import { Button } from './button.tsx'

describe('Button', () => {
  it('underlines the access key and exposes it for Alt+letter', () => {
    render(() => <Button label="Se&al letter" />)
    const button = screen.getByRole('button', { name: 'Seal letter' })
    expect(button.querySelector('u')?.textContent).toBe('a')
    expect(button.dataset['accessKey']).toBe('a')
  })

  it('calls onClick when enabled and not when disabled', () => {
    const onClick = vi.fn()
    const { unmount } = render(() => <Button label="OK" onClick={onClick} />)
    fireEvent.click(screen.getByRole('button', { name: 'OK' }))
    expect(onClick).toHaveBeenCalledTimes(1)
    unmount()

    render(() => <Button label="OK" onClick={onClick} disabled />)
    fireEvent.click(screen.getByRole('button', { name: 'OK' }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('marks the default button', () => {
    render(() => <Button label="&Send" isDefault />)
    expect(screen.getByRole('button').hasAttribute('data-default')).toBe(true)
  })
})
