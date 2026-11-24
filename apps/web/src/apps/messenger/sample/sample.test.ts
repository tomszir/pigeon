import { describe, expect, it } from 'vitest'
import { SAMPLE_GROUPS, sampleConversation } from './sample.ts'

describe('sampleConversation', () => {
  it('gives every sample contact a conversation, so double-clicking anyone opens one', () => {
    for (const contact of SAMPLE_GROUPS.flatMap((group) => group.contacts)) {
      expect(sampleConversation(contact.id)?.name).toBe(contact.name)
    }
  })

  it('tells you an offline friend is offline', () => {
    expect(sampleConversation('jo')?.entries[0]?.kind).toBe('system')
  })

  it('knows nobody outside the sample', () => {
    expect(sampleConversation('nobody')).toBeUndefined()
  })
})
