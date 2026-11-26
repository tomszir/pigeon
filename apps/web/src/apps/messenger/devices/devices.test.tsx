import { render, screen } from '@solidjs/testing-library'
import { describe, expect, it, vi } from 'vitest'
import type { Messenger } from '../service/service.ts'
import { JoinDevice } from './devices.tsx'

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
