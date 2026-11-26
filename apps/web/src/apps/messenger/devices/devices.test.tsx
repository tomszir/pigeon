import { fireEvent, render, screen } from '@solidjs/testing-library'
import { createSignal } from 'solid-js'
import { describe, expect, it, vi } from 'vitest'
import type { Messenger } from '../service/service.ts'
import { JoinDevice, MyDevices } from './devices.tsx'

describe('JoinDevice', () => {
  it('asks before linking to a Pigeon whose link opened it', async () => {
    const joinIdentity = vi.fn(() => new Promise<never>(() => undefined))
    const messenger = { joinIdentity, leavingTells: () => false } as unknown as Messenger
    const target = {
      via: 'link',
      secret: 'abcdefghijklmnopqrstuvwxya',
      fingerprint: '7f3a91c204bed817',
    } as const
    render(() => (
      <JoinDevice
        messenger={messenger}
        incoming={target}
        sleep={() => new Promise(() => undefined)}
        onLinked={() => undefined}
        onLeave={() => undefined}
        onClose={() => undefined}
      />
    ))
    expect(screen.getByText(/Link only if it came from your own other device/)).toBeTruthy()
    expect(joinIdentity).not.toHaveBeenCalled()

    screen.getByRole('button', { name: 'Link' }).click()
    expect(joinIdentity).toHaveBeenCalledWith(target, expect.any(Promise))
  })
  it('goes ahead without asking when Link was chosen before leaving the old Pigeon', () => {
    const joinIdentity = vi.fn(() => new Promise<never>(() => undefined))
    const messenger = { joinIdentity, leavingTells: () => false } as unknown as Messenger
    const target = { via: 'code', nameplate: 'k7rt', secret: 'vp2bxq' } as const
    render(() => (
      <JoinDevice
        messenger={messenger}
        incoming={target}
        confirmed
        sleep={() => new Promise(() => undefined)}
        onLinked={() => undefined}
        onLeave={() => undefined}
        onClose={() => undefined}
      />
    ))
    expect(joinIdentity).toHaveBeenCalledWith(target, expect.any(Promise))
  })
})

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
