import { describe, expect, test } from 'bun:test'
import { CC_HOOK_EVENTS } from './contracts'
import { nativeLifecycleEvent } from './lifecycle-events'
import { mapPromptOutcome } from './prompt-hook'

describe('external lifecycle event translation', () => {
  test('every dispatched external event maps to a distinct native control point', () => {
    const mapped = CC_HOOK_EVENTS.map((event) => nativeLifecycleEvent(event))
    expect(new Set(mapped.map((event) => event.id)).size).toBe(CC_HOOK_EVENTS.length)
    expect(nativeLifecycleEvent('PreToolUse')).toEqual({ id: 'tool.before', gate: 'tool' })
    expect(nativeLifecycleEvent('SubagentStop')).toEqual({
      id: 'delegation.finish',
      gate: 'completion',
    })
  })

  test('external support restrictions do not redefine native event capabilities', () => {
    // A checkpoint is observed, never cancelled: it is deterministic and already durable.
    expect(nativeLifecycleEvent('PreCompact')).toEqual({
      id: 'context.checkpoint.before',
      gate: 'observe',
    })
    expect(
      mapPromptOutcome('PreCompact', { ok: false, reason: 'format does not support this handler' }),
    ).toEqual({})
    expect(mapPromptOutcome('Stop', { ok: false, reason: 'unfinished' })).toEqual({
      decision: 'block',
      reason: 'unfinished',
    })
  })

  test('each added gate event rejects with the effect of its native control point', () => {
    const no = { ok: false, reason: 'r' }
    // A task-board write is refused like a tool call; a member is sent back to work.
    expect(mapPromptOutcome('TaskCreated', no)).toEqual({
      permissionDecision: 'deny',
      permissionDecisionReason: 'r',
    })
    expect(mapPromptOutcome('TeammateIdle', no)).toEqual({ decision: 'block', reason: 'r' })
    // An expansion and a tool batch are rejected as input: the turn does not go on.
    expect(mapPromptOutcome('UserPromptExpansion', no)).toEqual({ blocked: true, blockReason: 'r' })
    expect(mapPromptOutcome('PostToolBatch', no)).toEqual({ blocked: true, blockReason: 'r' })
    // CC runs prompt hooks on these and discards the verdict.
    expect(mapPromptOutcome('PermissionRequest', no)).toEqual({})
    expect(mapPromptOutcome('PermissionDenied', no)).toEqual({})
  })
})
