import { describe, expect, test } from 'bun:test'

import { createGateRefusalTracker } from '@localixai/agent/agents'

import { withRefusalBreaker } from './permission-gate-breaker'

const ctx = { toolCallId: 'c1', toolName: 'Bash', input: {} }

describe('counting what the gate refuses', () => {
  test('an untagged refusal counts as automatic', async () => {
    // The default is structural: a human is consulted in exactly one place in the gate, and
    // that place tags itself. A block site added later must be counted, not exempt.
    const tracker = createGateRefusalTracker({ consecutiveMax: 2 })
    const gate = withRefusalBreaker(
      async () => ({ block: true, blockedMessage: 'Not permitted here.' }),
      tracker,
    )

    expect((await gate(ctx))?.blockedMessage).toBe('Not permitted here.')
    const second = await gate(ctx)
    expect(tracker.tripped()).toBeDefined()
    // The reason is appended to the message the model already gets: ending the run silently
    // would leave a transcript whose last word is a routine refusal.
    expect(second?.blockedMessage).toContain('Not permitted here.')
    expect(second?.blockedMessage).toContain('it is ending instead of retrying')
    // The person reads that the run stopped, not the model's account of itself.
    expect(second?.personMessage).toBe('Stopped after 2 refused tool calls')
  })

  test('a human decline does not trip the breaker', async () => {
    const tracker = createGateRefusalTracker({ consecutiveMax: 2 })
    const gate = withRefusalBreaker(
      async () => ({ block: true, refusal: 'human' as const, blockedMessage: 'User declined.' }),
      tracker,
    )

    for (let i = 0; i < 5; i += 1) await gate(ctx)
    expect(tracker.tripped()).toBeUndefined()
  })

  test("a plain allow — the gate's `undefined` — clears the chain", async () => {
    const tracker = createGateRefusalTracker({ consecutiveMax: 2 })
    let blocked = true
    const gate = withRefusalBreaker(
      async () => (blocked ? { block: true, blockedMessage: 'no' } : undefined),
      tracker,
    )

    await gate(ctx)
    blocked = false
    expect(await gate(ctx)).toBeUndefined()
    blocked = true
    await gate(ctx)
    expect(tracker.tripped()).toBeUndefined()
  })

  test('an allow verdict carrying a note is still an allow', async () => {
    // `note`/`provenance` verdicts are allows with attribution, not blocks — reading them as
    // refusals would trip the breaker on a run the user is approving.
    const tracker = createGateRefusalTracker({ consecutiveMax: 2 })
    const gate = withRefusalBreaker(
      async () => ({ note: '[approved]', provenance: { decision: 'user-approved' as const } }),
      tracker,
    )

    await gate(ctx)
    await gate(ctx)
    await gate(ctx)
    expect(tracker.tripped()).toBeUndefined()
  })
})
