import { fireEvent, render, screen } from '@solidjs/testing-library'
import { createSignal } from 'solid-js'
import { describe, expect, it, vi } from 'vitest'
import type { Messenger } from '../service/service.ts'
import { MyDevices } from './my-devices.tsx'

describe('MyDevices', () => {
  it('asks you to check your list once the secret your devices meet with was replaced', async () => {
    const [check, setCheck] = createSignal(true)
    const devicesChecked = vi.fn(async () => setCheck(false))
    const messenger = {
      isFirstDevice: () => true,
      deviceStatus: () => 'active',
      twin: () => false,
      waitingForList: () => false,
      checkDevices: check,
      devicesChecked,
      devices: () => [
        {
          id: 'a',
          name: 'Laptop',
          here: true,
          first: true,
          writer: true,
          fingerprint: '3f9a 21c0',
        },
      ],
    } as unknown as Messenger
    render(() => (
      <MyDevices
        messenger={messenger}
        onLinkDevice={() => undefined}
        onStartOver={() => undefined}
        onClose={() => undefined}
      />
    ))
    expect(screen.getByText(/check that every device below is yours/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /They're All Mine/ }))
    expect(devicesChecked).toHaveBeenCalled()
    expect(screen.queryByText(/check that every device below is yours/)).toBeNull()
  })
})
