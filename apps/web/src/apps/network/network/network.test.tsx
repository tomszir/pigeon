import type { LighthouseAddress, LighthouseSoftware } from '@pigeon/core'
import { fireEvent, render, screen } from '@solidjs/testing-library'
import { createSignal } from 'solid-js'
import { describe, expect, it, vi } from 'vitest'
import { LayoutContext } from '../../../ui/layout/layout.ts'
import { Network, type NetworkMessenger } from './network.tsx'

const key = (c: string) => `${c.repeat(51)}a`
const worker: LighthouseAddress = {
  id: key('a'),
  name: 'Pigeon Lighthouse',
  url: 'wss://lh.example/',
}
const node: LighthouseAddress = {
  id: key('b'),
  name: 'Pigeon Lighthouse Node',
  url: 'wss://node.example/',
}
const software: LighthouseSoftware = { name: 'pigeon-lighthouse', version: '0.8.0' }

function fakeMessenger(start: readonly LighthouseAddress[], answering: (id: string) => boolean) {
  const [list, setList] = createSignal(start)
  const messenger: NetworkMessenger = {
    lighthouses: list,
    setLighthouses: async (next) => {
      setList(next)
    },
    checkLighthouse: async (address) =>
      answering(address.id) ? { ok: true, value: software } : { ok: false, error: 'timeout' },
    fingerprintOf: async () => '7f3a91c204bed817',
    onlineCount: () => 1,
    friends: () => [{}, {}],
    relays: () => ({ reachable: 4, total: 5 }),
  }
  return { messenger, list }
}

function show(
  messenger: NetworkMessenger | undefined,
  options: {
    relayOnly?: boolean | undefined
    phone?: boolean
    official?: readonly LighthouseAddress[]
  } = {},
) {
  const onRelayOnly = vi.fn()
  render(() => (
    <LayoutContext.Provider value={options.phone === true ? 'phone' : 'desktop'}>
      <Network
        messenger={messenger}
        official={options.official ?? []}
        relayOnly={'relayOnly' in options ? options.relayOnly : false}
        onRelayOnly={onRelayOnly}
        onClose={() => undefined}
      />
    </LayoutContext.Provider>
  ))
  return { onRelayOnly }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('Network', () => {
  it('has the relay setting on its Connection tab', () => {
    const { onRelayOnly } = show(undefined)
    fireEvent.click(screen.getByRole('tab', { name: 'Connection' }))
    fireEvent.click(screen.getByLabelText(/Always go through the relay/))
    expect(onRelayOnly).toHaveBeenCalledWith(true)
  })

  it('shows everything at once on the Pocket, and waits for the Messenger', () => {
    show(undefined, { phone: true, relayOnly: undefined })
    const check = screen.getByLabelText(/Always go through the relay/) as HTMLInputElement
    expect(check.disabled).toBe(true)
    expect(
      screen.getByText('Lighthouses are shown once Pigeon Messenger has started.'),
    ).toBeTruthy()
  })

  it('lists each Lighthouse with whether it answers and what it says it runs', async () => {
    show(fakeMessenger([worker, node], (id) => id === worker.id).messenger)
    await flush()
    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(rows[0]?.textContent).toContain('Pigeon Lighthouse')
    expect(rows[0]?.textContent).toContain('lh.example · 7f3a 91c2 04be d817')
    expect(rows[0]?.textContent).toContain('Says it runs pigeon-lighthouse 0.8.0.')
    expect(rows[1]?.textContent).toContain('Not answering. Mail is still left at the others.')
  })

  it('says what’s connected right now, on the Connection tab', async () => {
    show(fakeMessenger([worker, node], (id) => id === worker.id).messenger)
    await flush()
    fireEvent.click(screen.getByRole('tab', { name: 'Connection' }))
    const facts = screen.getByRole('group', { name: 'Right now' }).textContent ?? ''
    expect(facts).toContain('Relays: 4 of 5 reachable')
    expect(facts).toContain('Friends connected: 1 of 2')
    expect(facts).toContain('Lighthouses answering: 1 of 2')
  })

  it('fits a finger on the Pocket: remove keys, and what a Lighthouse sees in place', async () => {
    const { messenger, list } = fakeMessenger([worker, node], () => true)
    show(messenger, { phone: true })
    await flush()
    expect(screen.getAllByRole('listitem')[0]?.textContent).toContain('Answering')
    fireEvent.click(screen.getByRole('button', { name: `Remove ${node.name}` }))
    await flush()
    expect(list()).toEqual([worker])
    const about = screen.getByRole('button', { name: 'What a Lighthouse sees' })
    expect(screen.queryByText(/It can’t open your mail/)).toBeNull()
    fireEvent.click(about)
    expect(screen.getByText(/It can’t open your mail/)).toBeTruthy()
  })

  it('adds a Lighthouse only once it answers as its address says', async () => {
    const { messenger, list } = fakeMessenger([worker], (id) => id !== key('c'))
    show(messenger)
    const field = screen.getByLabelText('Address:')
    fireEvent.input(field, { target: { value: 'not an address' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    await flush()
    expect(screen.getByRole('alert').textContent).toContain('isn’t a Lighthouse’s address')

    fireEvent.input(field, {
      target: {
        value: `pigeon://lighthouse/${key('c')}?url=wss%3A%2F%2Fdown.example%2F&name=Down`,
      },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    await flush()
    expect(screen.getByRole('alert').textContent).toContain('Down didn’t answer')
    expect(list()).toHaveLength(1)

    fireEvent.input(field, {
      target: {
        value: `pigeon://lighthouse/${key('b')}?url=wss%3A%2F%2Fnode.example%2F&name=Node`,
      },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    await flush()
    expect(list().map((address) => address.id)).toEqual([worker.id, key('b')])
  })

  it('keeps at least one Lighthouse, so friends have somewhere to leave mail', async () => {
    const { messenger, list } = fakeMessenger([worker, node], () => true)
    show(messenger)
    const removes = screen.getAllByRole('button', { name: 'Remove' })
    fireEvent.click(removes[1] as HTMLElement)
    await flush()
    expect(list()).toEqual([worker])
    expect((screen.getByRole('button', { name: 'Remove' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
  })

  it('labels the official Lighthouses, which are turned off and on, never removed', async () => {
    const { messenger, list } = fakeMessenger([worker, node], () => true)
    show(messenger, { official: [worker] })
    await flush()
    const rows = () => screen.getAllByRole('listitem')
    expect(rows()[0]?.textContent).toContain('Official')
    expect(rows()[1]?.textContent).not.toContain('Official')
    expect(screen.getAllByRole('button', { name: 'Remove' })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Disable' }))
    await flush()
    // Off, but still listed, to turn back on with one click.
    expect(list()).toEqual([node])
    expect(rows()).toHaveLength(2)
    expect(rows()[1]?.textContent).toContain('Turned off')
    fireEvent.click(screen.getByRole('button', { name: 'Enable' }))
    await flush()
    expect(list()).toEqual([node, worker])
  })

  it('keeps the last one on: an official one can’t be turned off when it’s all there is', async () => {
    show(fakeMessenger([worker], () => true).messenger, { official: [worker] })
    await flush()
    expect((screen.getByRole('button', { name: 'Disable' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
  })
})
