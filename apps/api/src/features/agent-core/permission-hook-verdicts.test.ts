import { describe, expect, test } from 'bun:test'
import type { AgentTool } from '@localixai/agent/agents'

import { createPermissionGate, type PermissionRule, type ToolFacts } from './permission-engine'

const tool = { name: 'bash', mutates: true, effect: 'external' } as AgentTool & ToolFacts
const bash = (action: PermissionRule['action'], extra: Partial<PermissionRule> = {}) => [
  { permission: 'bash', pattern: '*', action, ...extra },
]
const call = { toolCallId: 'tc1', toolName: 'bash', input: { command: 'rm -rf build' } }

describe('a refusal made without asking anyone goes past the PermissionDenied review', () => {
  const reviewed: string[] = []
  const review = async (c: { toolCallId: string }, reason: string) => {
    reviewed.push(`${c.toolCallId}: ${reason}`)
    return '[you may retry]'
  }

  test("a permission mode's own denial carries the review's note", async () => {
    reviewed.length = 0
    const gate = createPermissionGate({
      rules: bash('deny', {
        message: 'Plan mode is read-only.',
        personMessage: 'Plan mode is read-only',
      }),
      toolsByName: new Map([['bash', tool]]),
      reviewAutomaticDenial: review,
    })
    expect((await gate(call))?.blockedMessage).toBe('Plan mode is read-only.\n[you may retry]')
    expect(reviewed).toEqual(['tc1: Plan mode is read-only.'])
  })

  test('an ask on a run nobody can answer is reviewed too', async () => {
    reviewed.length = 0
    const gate = createPermissionGate({
      rules: bash('ask'),
      toolsByName: new Map([['bash', tool]]),
      reviewAutomaticDenial: review,
    })
    expect((await gate(call))?.blockedMessage).toContain('[you may retry]')
    expect(reviewed).toHaveLength(1)
  })

  test("the user's own deny rule is their decision: not reviewed", async () => {
    reviewed.length = 0
    const gate = createPermissionGate({
      rules: bash('deny', { message: 'No.' }),
      toolsByName: new Map([['bash', tool]]),
      reviewAutomaticDenial: review,
    })
    expect((await gate(call))?.blockedMessage).toBe('No.')
    expect(reviewed).toEqual([])
  })
})

describe('a card a PermissionRequest hook answered', () => {
  const gateAnswering = (outcome: { approved: boolean; message?: string }) =>
    createPermissionGate({
      rules: bash('ask'),
      toolsByName: new Map([['bash', tool]]),
      requestConfirm: async (_card, raw) => {
        // The hook judges the call itself: the raw input travels beside the card, not on it.
        expect(raw?.input).toEqual(call.input)
        return { ...outcome, via: 'hook' }
      },
    })

  test('an allow lets the call through, attributed to the hook', async () => {
    expect(await gateAnswering({ approved: true })(call)).toEqual({
      note: '[Approved by a permission hook.]',
      provenance: { decision: 'rule-allow', detail: 'permission hook' },
    })
  })

  test("a deny is the hook's words, not the person's", async () => {
    const verdict = await gateAnswering({ approved: false, message: 'not on main' })(call)
    expect(verdict).toMatchObject({ block: true, blockedMessage: 'not on main' })
    expect(verdict?.refusal).toBeUndefined()
  })
})
