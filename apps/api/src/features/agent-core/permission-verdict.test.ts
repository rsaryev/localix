import { describe, expect, test } from 'bun:test'
import os from 'node:os'
import path from 'node:path'
import type { AgentTool } from '@localixai/agent/agents'

import { createPermissionGate, type PermissionRule } from './permission-engine'
import { verdictOf, type CallVerdict } from './permission-verdict'

/**
 * A host reviews the gate's verdict before the gate acts on it (Claude Code mods' `tool.check`),
 * and asks it for a call nobody makes (`$.tool.check`). The defect this pins is a review that the
 * gate ignored, or a query that asked a person.
 */
const ROOT = path.join(os.homedir(), 'proj')
const bash = { name: 'bash', classify: () => ({ effect: 'external' }) } as unknown as AgentTool
const rules: PermissionRule[] = [{ permission: 'bash', pattern: '*', action: 'deny' }]
const options = { rules, toolsByName: new Map([['bash', bash]]), root: ROOT }
const call = { toolCallId: 'c', toolName: 'bash', input: { command: 'ls' } }

describe('a reviewed verdict', () => {
  test('a review that allows a denied call lets it run', async () => {
    const seen: CallVerdict[] = []
    const gate = createPermissionGate({
      ...options,
      reviewVerdict: async (_call, verdict) => (seen.push(verdict), { decision: 'allow' }),
    })
    expect(await gate(call)).toBeUndefined()
    expect(seen).toEqual([{ decision: 'deny', rule: 'bash(*)' }])
  })

  test('a review that asks puts the call to a person, its reason on the card', async () => {
    const asked: unknown[] = []
    const gate = createPermissionGate({
      rules: [],
      toolsByName: options.toolsByName,
      root: ROOT,
      reviewVerdict: async () => ({ decision: 'ask', reason: 'A mod wants you to look.' }),
      requestConfirm: async (args) => (asked.push(args.message), false),
    })
    expect(await gate(call)).toMatchObject({ block: true, refusal: 'human' })
    expect(asked).toEqual(['A mod wants you to look.'])
  })

  test('a review that keeps the verdict leaves the rule’s refusal as it was', async () => {
    const gate = createPermissionGate({ ...options, reviewVerdict: async (_c, v) => v })
    expect(await gate(call)).toMatchObject({ block: true, blockedMessage: expect.any(String) })
  })

  test('a query answers the verdict and asks nobody', () => {
    expect(verdictOf(options)('bash', { command: 'ls' })).toEqual({
      decision: 'deny',
      rule: 'bash(*)',
    })
    expect(verdictOf({ ...options, rules: [] })('bash', { command: 'ls' })).toEqual({
      decision: 'allow',
    })
  })
})
