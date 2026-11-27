// The chat-history model: a device that learns of a friend through your shared log gets the
// whole chat once mail settles, each message once and in one order; each planted defect is caught.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { CHAT, CHAT_DEFECTS, CHAT_LIVE, chatModel } from './chat.ts'
import { explore, summary } from './explore.ts'
import { MAX_STATES } from './limits.ts'

describe('chat history, under the design', () => {
  for (const cfg of [CHAT, CHAT_LIVE])
    it(`${cfg.name}: every invariant holds`, () => {
      const result = explore(chatModel(cfg), { maxStates: MAX_STATES })
      console.log(summary(result))
      assert.deepEqual(result.violations, [])
      assert.equal(result.truncated, false)
      for (const flag of [
        'settled:A has the friend',
        'settled:A shows messages',
        'history page in the mail',
      ])
        assert.ok(result.reached.includes(flag), `never reached ${flag}`)
    })
})

describe('chat history, planted defects', () => {
  for (const defect of CHAT_DEFECTS)
    it(`${defect.name} is caught by ${defect.caughtBy}`, () => {
      const cfg = {
        ...CHAT,
        name: `${CHAT.name} [defect: ${defect.name}]`,
        rules: { ...CHAT.rules, [defect.rule]: false },
      }
      const result = explore(chatModel(cfg), { maxStates: MAX_STATES, stopAt: defect.caughtBy })
      const caught = result.violations.find((v) => v.id === defect.caughtBy)
      console.log(`${summary(result)}\n  ${caught?.message} after ${caught?.path.join(' > ')}`)
      assert.ok(caught)
    })
})
