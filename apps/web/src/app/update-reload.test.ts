import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IDLE_AFTER_MS, watchUnsavedWork } from './unsaved-work.ts'
import { createPendingReload, onNewerVersion, RETRY_EVERY_MS } from './update-reload.ts'

const setup = (state: { busy?: boolean; quiet?: boolean; attempted?: string } = {}) => {
  const flags = { busy: state.busy ?? false, quiet: state.quiet ?? true }
  const remembered: { value: string | undefined } = { value: state.attempted }
  const reload = vi.fn()
  const pending = createPendingReload({
    current: '0.8.2',
    isBusy: () => flags.busy,
    isQuiet: () => flags.quiet,
    reload,
    attempted: {
      get: () => remembered.value,
      set: (version) => {
        remembered.value = version
      },
    },
  })
  return { flags, remembered, reload, pending }
}

describe('createPendingReload', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('reloads at once when nothing is going on and the tab is quiet', () => {
    const { pending, reload, remembered } = setup()
    pending.want('0.8.3')
    expect(reload).toHaveBeenCalledOnce()
    expect(remembered.value).toBe('0.8.3')
  })

  it('waits while something would be lost, then reloads once it is safe', async () => {
    const { pending, reload, flags } = setup({ busy: true })
    pending.want('0.8.3')
    await vi.advanceTimersByTimeAsync(RETRY_EVERY_MS * 5)
    expect(reload).not.toHaveBeenCalled()
    flags.busy = false
    await vi.advanceTimersByTimeAsync(RETRY_EVERY_MS)
    expect(reload).toHaveBeenCalledOnce()
  })

  it('waits while someone is at the keyboard, and goes when the tab is hidden', async () => {
    const { pending, reload, flags } = setup({ quiet: false })
    pending.want('0.8.3')
    await vi.advanceTimersByTimeAsync(RETRY_EVERY_MS * 3)
    expect(reload).not.toHaveBeenCalled()
    flags.quiet = true
    document.dispatchEvent(new Event('visibilitychange'))
    expect(reload).toHaveBeenCalledOnce()
  })

  it('never reloads while busy, hidden or not', () => {
    const { pending, reload, flags } = setup({ busy: true })
    pending.want('0.8.3')
    flags.quiet = true
    document.dispatchEvent(new Event('visibilitychange'))
    expect(reload).not.toHaveBeenCalled()
    pending.stop()
  })

  it('reloads once per version, however long it waited', async () => {
    const { pending, reload } = setup()
    pending.want('0.8.3')
    pending.want('0.8.3')
    await vi.advanceTimersByTimeAsync(RETRY_EVERY_MS * 3)
    expect(reload).toHaveBeenCalledOnce()
  })

  it('does not reload again when the same version is still out after a reload', () => {
    const { pending, reload } = setup({ attempted: '0.8.3' })
    pending.want('0.8.3')
    expect(reload).not.toHaveBeenCalled()
    // A version later still is a new reason.
    pending.want('0.8.4')
    expect(reload).toHaveBeenCalledOnce()
  })

  it('ignores the version it runs and older ones', () => {
    const { pending, reload } = setup()
    pending.want('0.8.2')
    pending.want('0.8.1')
    expect(reload).not.toHaveBeenCalled()
  })

  it('stays put when the attempt can’t be remembered', () => {
    const reload = vi.fn()
    const pending = createPendingReload({
      current: '0.8.2',
      isBusy: () => false,
      isQuiet: () => true,
      reload,
      attempted: {
        get: () => undefined,
        set: () => {
          throw new Error('no storage')
        },
      },
    })
    pending.want('0.8.3')
    expect(reload).not.toHaveBeenCalled()
  })

  it('goes for the later version when a second one comes out while waiting', async () => {
    const { pending, reload, flags, remembered } = setup({ busy: true })
    pending.want('0.8.3')
    pending.want('0.8.4')
    flags.busy = false
    await vi.advanceTimersByTimeAsync(RETRY_EVERY_MS)
    expect(reload).toHaveBeenCalledOnce()
    expect(remembered.value).toBe('0.8.4')
  })
})

describe('onNewerVersion', () => {
  it('has a tab that keeps its storage reload when it is safe', () => {
    const want = vi.fn()
    const offer = vi.fn()
    onNewerVersion({ persistent: true, pending: { want }, offer })('0.8.3')
    expect(want).toHaveBeenCalledWith('0.8.3')
    expect(offer).not.toHaveBeenCalled()
  })

  it('has a tab that keeps nothing offer the reload instead of doing it', () => {
    const want = vi.fn()
    const offer = vi.fn()
    onNewerVersion({ persistent: false, pending: { want }, offer })('0.8.3')
    expect(offer).toHaveBeenCalledWith('0.8.3')
    expect(want).not.toHaveBeenCalled()
  })
})

describe('an update held back by an open window', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('reloads once the window is closed and the tab has been left alone', async () => {
    const open = new Set(['add-friend'])
    const work = watchUnsavedWork({ isOpen: (id) => open.has(id) })
    const reload = vi.fn()
    const pending = createPendingReload({
      current: '0.8.2',
      isBusy: work.isBusy,
      isQuiet: work.isQuiet,
      reload,
      attempted: { get: () => undefined, set: () => undefined },
    })
    pending.want('0.8.3')
    await vi.advanceTimersByTimeAsync(IDLE_AFTER_MS * 2)
    expect(reload).not.toHaveBeenCalled()
    open.delete('add-friend')
    // Closing it counts as a touch, so the tab is quiet again 30 seconds later.
    document.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    await vi.advanceTimersByTimeAsync(IDLE_AFTER_MS + RETRY_EVERY_MS)
    expect(reload).toHaveBeenCalledOnce()
    work.stop()
  })
})
