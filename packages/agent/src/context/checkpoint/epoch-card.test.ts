import { describe, expect, test } from 'bun:test'

import { cardFacts, renderCard } from './epoch-card'
import type { CheckpointEntry } from './types'

const request = (
  id: string,
  text: string,
  extra: Partial<CheckpointEntry> = {},
): CheckpointEntry => ({
  message: { id, role: 'user', content: text },
  turnStart: true,
  internal: false,
  pinned: false,
  ...extra,
})

describe('epoch cards preserve corrections with their authority', () => {
  test('bounded cards retain the newest requests rather than the discarded direction', () => {
    const entries = Array.from({ length: 30 }, (_, i) => request(`u${i}`, `old direction ${i}`))
    entries.push(request('correction', 'Use the new composition and reference.'))
    const facts = cardFacts(entries)
    for (const level of [0, 1, 2] as const) {
      const card = renderCard(facts, level)
      expect(card.text).toContain('Use the new composition and reference.')
      expect(card.text).not.toContain('old direction 0')
    }
    expect(renderCard(facts, 0).text).toContain('earlier requests omitted')
  })

  test('a trusted assignment amendment survives eviction but runtime wakes remain absent', () => {
    const facts = cardFacts([
      request('runtime', 'Background process finished', { internal: true }),
      request('delegator', 'Replace the previous visual direction.', {
        internal: true,
        assignmentUpdate: true,
      }),
    ])
    for (const level of [0, 1, 2] as const) {
      const card = renderCard(facts, level)
      expect(card.text).toContain('Replace the previous visual direction.')
      expect(card.text.toLowerCase()).toContain('assignment update')
      expect(card.text).not.toContain('Background process finished')
    }
  })
})
