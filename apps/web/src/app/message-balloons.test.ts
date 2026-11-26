import type { PeerId } from '@pigeon/core'
import { describe, expect, it } from 'vitest'
import type { Notice } from '../shell/shell/types.ts'
import {
  createMessageBalloons,
  type HeldMessage,
  MESSAGE_BALLOON_GAP_MS,
  summarizeMessages,
} from './message-balloons.ts'

const from = (name: string, text = 'hi'): HeldMessage => ({
  friend: { id: `id-${name}` as PeerId, name },
  text,
})

describe('summarizeMessages', () => {
  it('names one friend and counts their messages', () => {
    expect(summarizeMessages([from('Mika'), from('Mika'), from('Mika')])).toEqual({
      title: 'Mika',
      body: '3 new messages. Click to read.',
      fromOne: true,
    })
  })

  it('names two friends with "and", each once', () => {
    expect(summarizeMessages([from('Mika'), from('Ren'), from('Mika')])).toEqual({
      title: 'Mika and Ren',
      body: '3 new messages. Click to read.',
      fromOne: false,
    })
  })

  it('names the first two of three or more and counts the rest', () => {
    const waiting = [from('Mika'), from('Ren'), from('Jo'), from('Ana'), from('Jo')]
    expect(summarizeMessages(waiting).title).toBe('Mika, Ren and 2 more')
    expect(summarizeMessages(waiting.slice(0, 3)).title).toBe('Mika, Ren and 1 more')
  })
})

const setup = () => {
  const clock = { at: 1_000_000 }
  const notices: Notice[] = []
  const timers: { run: () => void; at: number; cancelled: boolean }[] = []
  const opened: string[] = []
  const balloons = createMessageBalloons({
    api: { notify: (notice) => notices.push(notice) },
    messenger: () => undefined,
    now: () => clock.at,
    schedule: (run, ms) => {
      const timer = { run, at: clock.at + ms, cancelled: false }
      timers.push(timer)
      return () => {
        timer.cancelled = true
      }
    },
    openFriendConversation: (id) => opened.push(id),
    openMessenger: () => opened.push('messenger'),
  })
  /** Moves the clock on and runs the timers that fell due, in order. */
  const advance = (ms: number) => {
    clock.at += ms
    for (const timer of timers) {
      if (!timer.cancelled && timer.at <= clock.at) {
        timer.cancelled = true
        timer.run()
      }
    }
  }
  return { balloons, notices, timers, opened, advance }
}

describe('createMessageBalloons', () => {
  it('raises the first message at once, on the next tick of the timer', () => {
    const { balloons, notices, timers, advance } = setup()
    balloons.hold(from('Mika').friend, 'hello')
    expect(notices).toHaveLength(0)
    expect(timers[0]?.at).toBe(1_000_000)
    advance(0)
    expect(notices).toHaveLength(1)
    expect(notices[0]).toMatchObject({ title: 'Mika says:', body: 'hello' })
  })

  it('folds what comes within the gap into one balloon', () => {
    const { balloons, notices, advance } = setup()
    balloons.hold(from('Mika').friend, 'one')
    advance(0)
    balloons.hold(from('Mika').friend, 'two')
    balloons.hold(from('Ren').friend, 'three')
    advance(MESSAGE_BALLOON_GAP_MS - 1)
    expect(notices).toHaveLength(1)
    advance(1)
    expect(notices).toHaveLength(2)
    expect(notices[1]).toMatchObject({
      title: 'Mika and Ren',
      body: '2 new messages. Click to read.',
    })
  })

  it('waits only for what is left of the gap, then not at all', () => {
    const { balloons, notices, timers, advance } = setup()
    balloons.hold(from('Mika').friend, 'one')
    advance(0)
    advance(4_000)
    balloons.hold(from('Mika').friend, 'two')
    expect(timers[1]?.at).toBe(1_000_000 + MESSAGE_BALLOON_GAP_MS)
    advance(MESSAGE_BALLOON_GAP_MS)
    expect(notices).toHaveLength(2)
    advance(MESSAGE_BALLOON_GAP_MS * 3)
    balloons.hold(from('Mika').friend, 'three')
    expect(timers[2]?.at).toBe(
      1_000_000 + 4_000 + MESSAGE_BALLOON_GAP_MS + MESSAGE_BALLOON_GAP_MS * 3,
    )
  })

  it('opens the one friend’s chat from a folded balloon, and the Messenger for several', () => {
    const { balloons, notices, opened, advance } = setup()
    balloons.hold(from('Mika').friend, 'one')
    balloons.hold(from('Mika').friend, 'two')
    advance(0)
    notices[0]?.onClick?.()
    balloons.hold(from('Mika').friend, 'a')
    balloons.hold(from('Ren').friend, 'b')
    advance(MESSAGE_BALLOON_GAP_MS)
    notices[1]?.onClick?.()
    expect(opened).toEqual(['id-Mika', 'messenger'])
  })

  it('drops the balloon still waiting when it is disposed', () => {
    const { balloons, notices, advance } = setup()
    balloons.hold(from('Mika').friend, 'one')
    balloons.dispose()
    advance(MESSAGE_BALLOON_GAP_MS)
    expect(notices).toHaveLength(0)
  })

  it('shows a balloon about a friend with the Messenger’s icon until their bird is known', () => {
    const { balloons, notices } = setup()
    balloons.notifyFrom({ id: 'x' as PeerId }, { title: 'Mika removed you', body: 'ok' })
    expect(notices).toHaveLength(1)
    expect(notices[0]).toMatchObject({ title: 'Mika removed you', body: 'ok' })
    expect(notices[0]?.icon).toBeDefined()
  })
})
