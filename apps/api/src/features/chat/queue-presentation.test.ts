import { describe, expect, test } from 'bun:test'
import { queueDeliveryLabel, queueItemCapabilities } from './queue-presentation'

describe('queue presentation policy', () => {
  test('distinguishes steering delivery from a queued turn', () => {
    expect(queueDeliveryLabel('next-tool')).toBe('Next tool')
    expect(queueDeliveryLabel('next-turn')).toBe('Next turn')
    // Not-yet-acknowledged optimistic composer rows carry no server-derived hint.
    expect(queueDeliveryLabel(undefined)).toBe('Next turn')
  })

  test('trusted wakes cannot be reinterpreted as operator-authored input', () => {
    expect(queueItemCapabilities('wake')).toEqual({
      canReturnToComposer: false,
      canPromote: false,
      promoteLabel: 'Send now',
    })
  })

  test('a queued user turn can be edited back or sent now', () => {
    expect(queueItemCapabilities('user')).toMatchObject({
      canReturnToComposer: true,
      canPromote: true,
      promoteLabel: 'Send now',
    })
  })
})
