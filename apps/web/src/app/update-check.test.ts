import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CHECK_EVERY_MS, FOCUS_GAP_MS, parseVersionFile, watchForUpdates } from './update-check.ts'

/** A fetch that answers with each body in turn (the last one again after that). */
const fakeFetch = (...bodies: (unknown | Error)[]) => {
  let served = 0
  const calls: [string, RequestInit | undefined][] = []
  const fetcher = (async (url: string, init?: RequestInit) => {
    calls.push([url, init])
    const body = bodies[Math.min(served, bodies.length - 1)]
    served += 1
    if (body instanceof Error) throw body
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status: body === 404 ? 404 : 200,
    })
  }) as unknown as typeof fetch
  return { fetcher, calls }
}

const focusTab = () => window.dispatchEvent(new Event('focus'))

describe('parseVersionFile', () => {
  it('reads a version and refuses anything else', () => {
    expect(parseVersionFile({ version: '0.8.3' })).toBe('0.8.3')
    expect(parseVersionFile({ version: '0.8.3-beta' })).toBeUndefined()
    expect(parseVersionFile({ version: 8 })).toBeUndefined()
    expect(parseVersionFile({})).toBeUndefined()
    expect(parseVersionFile(null)).toBeUndefined()
    expect(parseVersionFile('0.8.3')).toBeUndefined()
  })
})

describe('watchForUpdates', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  const watch = (current: string, ...bodies: (unknown | Error)[]) => {
    const { fetcher, calls } = fakeFetch(...bodies)
    const onNewer = vi.fn()
    const stop = watchForUpdates({ current, fetch: fetcher, onNewer })
    return { onNewer, calls, stop }
  }

  it('says so once when a newer version is out, however often it looks again', async () => {
    const { onNewer, stop } = watch('0.8.2', { version: '0.8.3' })
    await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS)
    expect(onNewer).toHaveBeenCalledExactlyOnceWith('0.8.3')
    await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS * 3)
    focusTab()
    await vi.advanceTimersByTimeAsync(0)
    expect(onNewer).toHaveBeenCalledOnce()
    stop()
  })

  it('says nothing for the same version or an older one', async () => {
    const same = watch('0.8.2', { version: '0.8.2' })
    const older = watch('0.8.2', { version: '0.8.1' })
    await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS * 2)
    expect(same.calls.length).toBeGreaterThan(0)
    expect(older.calls.length).toBeGreaterThan(0)
    expect(same.onNewer).not.toHaveBeenCalled()
    expect(older.onNewer).not.toHaveBeenCalled()
    same.stop()
    older.stop()
  })

  it('says so again for a version later still', async () => {
    const { onNewer, stop } = watch('0.8.2', { version: '0.8.3' }, { version: '0.8.4' })
    await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS)
    await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS)
    expect(onNewer.mock.calls).toEqual([['0.8.3'], ['0.8.4']])
    stop()
  })

  it('checks when the tab is focused again after a while, not every time', async () => {
    const { onNewer, calls, stop } = watch('0.8.2', { version: '0.8.3' })
    focusTab()
    await vi.advanceTimersByTimeAsync(0)
    expect(calls).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(FOCUS_GAP_MS)
    focusTab()
    await vi.advanceTimersByTimeAsync(0)
    expect(calls).toHaveLength(1)
    expect(onNewer).toHaveBeenCalledWith('0.8.3')
    focusTab()
    await vi.advanceTimersByTimeAsync(0)
    expect(calls).toHaveLength(1)
    stop()
  })

  it('asks the site itself, with nothing cached and nothing sent along', async () => {
    const { calls, stop } = watch('0.8.2', { version: '0.8.2' })
    await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS)
    expect(calls[0]).toEqual([
      '/version.json',
      { cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' },
    ])
    stop()
  })

  it('tries again later after a failure or a file that isn’t one', async () => {
    const { onNewer, calls, stop } = watch('0.8.2', new Error('offline'), '<!doctype html>', 404, {
      version: '0.8.3',
    })
    for (let i = 0; i < 4; i += 1) await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS)
    expect(calls).toHaveLength(4)
    expect(onNewer).toHaveBeenCalledExactlyOnceWith('0.8.3')
    stop()
  })

  it('stops looking when told to', async () => {
    const { calls, stop } = watch('0.8.2', { version: '0.8.3' })
    stop()
    await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS * 2)
    expect(calls).toHaveLength(0)
  })
})
