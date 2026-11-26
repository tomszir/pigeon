import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IDLE_AFTER_MS, watchUnsavedWork } from './unsaved-work.ts'

const type = (field: HTMLInputElement | HTMLTextAreaElement, text: string) => {
  field.value = text
  field.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('watchUnsavedWork', () => {
  const open = new Set<string>()
  let work: ReturnType<typeof watchUnsavedWork>
  let inFlight = false
  beforeEach(() => {
    vi.useFakeTimers()
    open.clear()
    inFlight = false
    document.body.innerHTML = ''
    work = watchUnsavedWork({ isOpen: (id) => open.has(id), inFlight: () => inFlight })
  })
  afterEach(() => {
    work.stop()
    vi.useRealTimers()
  })

  it('is not busy with a bare desktop', () => {
    expect(work.isBusy()).toBe(false)
  })

  it('is busy while a pairing, link or recovery window is open', () => {
    for (const id of ['add-friend', 'link-device', 'join-device', 'make-recovery-key']) {
      open.add(id)
      expect(work.isBusy()).toBe(true)
      open.delete(id)
    }
    open.add('about')
    expect(work.isBusy()).toBe(false)
  })

  it('is busy while a message is typed and not sent, even out of focus', () => {
    const box = document.body.appendChild(document.createElement('textarea'))
    type(box, 'hello Mika, are you')
    expect(work.isBusy()).toBe(true)
    // Sent: the box is emptied.
    box.value = ''
    expect(work.isBusy()).toBe(false)
  })

  it('is no longer busy once the box is gone', () => {
    const box = document.body.appendChild(document.createElement('textarea'))
    type(box, 'draft')
    box.remove()
    expect(work.isBusy()).toBe(false)
  })

  it('is busy for a one-line field only while it has focus', () => {
    const line = document.body.appendChild(document.createElement('input'))
    line.type = 'text'
    line.focus()
    type(line, 'a name')
    expect(work.isBusy()).toBe(true)
    line.blur()
    expect(work.isBusy()).toBe(false)
  })

  it('is busy for an unfocused one-line field its own form marked as unsent', () => {
    const line = document.body.appendChild(document.createElement('input'))
    line.type = 'text'
    line.setAttribute('data-unsent', '')
    expect(work.isBusy()).toBe(true)
    // The form emptied it, or the dialog closed.
    line.removeAttribute('data-unsent')
    expect(work.isBusy()).toBe(false)
  })

  it('does not count text the app put in a field itself', () => {
    const line = document.body.appendChild(document.createElement('input'))
    line.value = 'pigeon://explorer/start'
    line.focus()
    expect(work.isBusy()).toBe(false)
    const box = document.body.appendChild(document.createElement('textarea'))
    box.value = 'a filled-in box'
    expect(work.isBusy()).toBe(false)
  })

  it('is busy while the Messenger has work in flight', () => {
    inFlight = true
    expect(work.isBusy()).toBe(true)
    inFlight = false
    expect(work.isBusy()).toBe(false)
  })

  it('is quiet after a while without a click or key, and not right after one', () => {
    expect(work.isQuiet()).toBe(false)
    vi.advanceTimersByTime(IDLE_AFTER_MS)
    expect(work.isQuiet()).toBe(true)
    document.dispatchEvent(new Event('keydown', { bubbles: true }))
    expect(work.isQuiet()).toBe(false)
    vi.advanceTimersByTime(IDLE_AFTER_MS)
    expect(work.isQuiet()).toBe(true)
  })

  it('is quiet while the tab is hidden', () => {
    expect(work.isQuiet()).toBe(false)
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    expect(work.isQuiet()).toBe(true)
    Reflect.deleteProperty(document, 'visibilityState')
  })
})
