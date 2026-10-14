import { describe, expect, test } from 'bun:test'
import type { AgentTool } from '@localixai/agent/agents'

import { resolveRunProfile } from './run-shape'
import {
  describeWithholdReason,
  markDeferred,
  remediableWithholds,
  resolveToolSurface,
  verdictFor,
  type RunFacts,
} from './tool-ledger'
import { TOOL } from './tool-names'

const tool = (name: string, extra: Partial<AgentTool> = {}): AgentTool =>
  ({
    name,
    description: name,
    inputSchema: {} as never,
    activeVerb: name,
    execute: async () => ({ content: '' }),
    ...extra,
  }) as AgentTool

const chat = (over: Partial<RunFacts> = {}): RunFacts => ({
  profile: resolveRunProfile({ sessionKind: 'chat' }),
  authority: undefined,
  disabledTools: new Set(),
  ...over,
})
const child = (tools: string[] | null, over: Partial<RunFacts> = {}): RunFacts => ({
  profile: resolveRunProfile({ sessionKind: 'subagent' }, tools ? { tools } : null),
  authority: undefined,
  disabledTools: new Set(),
  ...over,
})

describe('the ledger — one verdict, one reason, in layer order', () => {
  test('a live tool is live', () => {
    expect(verdictFor(chat(), { name: TOOL.read, tool: tool(TOOL.read) })).toEqual({
      state: 'live',
    })
  })

  test('shape: a `never` tool is withheld for a child even when its role declared it', () => {
    const facts = child(['read', TOOL.ask, TOOL.configure])
    for (const name of [TOOL.ask, TOOL.configure]) {
      expect(verdictFor(facts, { name, tool: tool(name) })).toEqual({
        state: 'withheld',
        reason: { layer: 'shape', kind: 'never', shape: 'subagent' },
      })
    }
  })

  test("shape: a plugin tool's own `exposure` is what a child is judged by", () => {
    const ui = tool('interactive_surface', {
      exposure: { chat: 'default', subagent: 'never', automation: 'never' },
    })
    expect(
      verdictFor(child(['interactive_surface']), { name: 'interactive_surface', tool: ui }),
    ).toEqual({
      state: 'withheld',
      reason: { layer: 'shape', kind: 'never', shape: 'subagent' },
    })
    // Declared, and merely opt-in → live.
    expect(verdictFor(child(['lookup']), { name: 'lookup', tool: tool('lookup') })).toEqual({
      state: 'live',
    })
    // Not declared → not-declared, and NO remedy: a role edit is not a switch.
    expect(verdictFor(child(['read']), { name: 'lookup', tool: tool('lookup') })).toEqual({
      state: 'withheld',
      reason: { layer: 'shape', kind: 'not-declared', shape: 'subagent' },
    })
  })

  test('authority: an empty port is a row with the capability the host named', () => {
    expect(verdictFor(chat(), { name: TOOL.jobs, missingCapability: 'jobs.available' })).toEqual({
      state: 'withheld',
      reason: { layer: 'authority', kind: 'missing', capability: 'jobs.available' },
    })
    expect(verdictFor(chat(), { name: TOOL.jobs })).toEqual({
      state: 'withheld',
      reason: { layer: 'authority', kind: 'missing', capability: `host:${TOOL.jobs}` },
    })
  })

  test('authority: a descriptor requirement is judged only when the run has a surface', () => {
    const gated = tool('preview', { availability: { requiredCapabilities: ['workbench-ui'] } })
    expect(verdictFor(chat(), { name: 'preview', tool: gated })).toEqual({ state: 'live' })
    expect(verdictFor(chat({ authority: [] }), { name: 'preview', tool: gated })).toEqual({
      state: 'withheld',
      reason: { layer: 'authority', kind: 'missing', capability: 'workbench-ui' },
    })
    expect(
      verdictFor(chat({ authority: ['workbench-ui'] }), { name: 'preview', tool: gated }),
    ).toEqual({ state: 'live' })
  })

  test('policy: a rule-withheld tool carries its denial and the one remedy that lifts it', () => {
    // No scope on either side: a rule belongs to the agent taking the turn, so "where do I
    // change this" has one answer and the remedy does not have to carry it.
    const denial = { rule: { action: 'tool:loops', resource: '*', effect: 'deny' } }
    const facts = chat({
      disabledTools: new Set([TOOL.loops]),
      toolDenials: new Map([[TOOL.loops, denial]]),
    })
    expect(verdictFor(facts, { name: TOOL.loops, tool: tool(TOOL.loops) })).toEqual({
      state: 'withheld',
      reason: { layer: 'policy', kind: 'rule', denial },
      remedy: { remedyId: 'tool.enable', target: TOOL.loops },
    })
    // Without a resolved denial the reason is still policy.
    expect(
      verdictFor(chat({ disabledTools: new Set([TOOL.loops]) }), {
        name: TOOL.loops,
        tool: tool(TOOL.loops),
      }),
    ).toEqual({
      state: 'withheld',
      reason: { layer: 'policy', kind: 'rule', denial: null },
      remedy: { remedyId: 'tool.enable', target: TOOL.loops },
    })
  })

  test('the topic boundary remains live in chats even when a stale agent rule denies it', () => {
    const facts = chat({ disabledTools: new Set([TOOL.set_topic]) })
    expect(
      verdictFor(facts, {
        name: TOOL.set_topic,
        tool: tool(TOOL.set_topic),
      }),
    ).toEqual({ state: 'live' })
  })

  test('monotone: an upper layer decides before a lower one can offer a remedy', () => {
    // Disabled by rule AND structurally impossible → the shape reason, no remedy.
    const facts = child(['read'], { disabledTools: new Set([TOOL.ask]) })
    const verdict = verdictFor(facts, { name: TOOL.ask, tool: tool(TOOL.ask) })
    expect(verdict.state).toBe('withheld')
    expect(verdict.state === 'withheld' && verdict.reason.layer).toBe('shape')
    expect(verdict.state === 'withheld' && verdict.remedy).toBeUndefined()
    // Disabled by rule AND the host has no port → authority first, again no remedy.
    const gap = verdictFor(chat({ disabledTools: new Set([TOOL.jobs]) }), { name: TOOL.jobs })
    expect(gap.state === 'withheld' && gap.reason.layer).toBe('authority')
  })

  test('remediable withholds are exactly the policy rows; the rest stay private to the host', () => {
    const facts = chat({ disabledTools: new Set([TOOL.loops]) })
    const ledger = resolveToolSurface(facts, [
      { name: TOOL.loops, tool: tool(TOOL.loops) },
      { name: TOOL.jobs },
      { name: TOOL.read, tool: tool(TOOL.read) },
    ])
    expect(remediableWithholds(ledger).map((row) => row.name)).toEqual([TOOL.loops])
  })

  test('economy: only a live verdict can become deferred', () => {
    const ledger = resolveToolSurface(chat({ disabledTools: new Set([TOOL.loops]) }), [
      { name: TOOL.loops, tool: tool(TOOL.loops) },
      { name: TOOL.skill, tool: tool(TOOL.skill) },
    ])
    const deferred = markDeferred(
      ledger,
      new Map([
        [TOOL.skill, 'core'],
        [TOOL.loops, 'core'],
      ]),
    )
    expect(deferred.get(TOOL.skill)).toEqual({ state: 'deferred', source: 'core' })
    expect(deferred.get(TOOL.loops)?.state).toBe('withheld')
  })

  test('one sentence per reason, in words the model can act on', () => {
    expect(describeWithholdReason({ layer: 'shape', kind: 'never', shape: 'subagent' })).toBe(
      'not available to a sub-agent run',
    )
    // No rule syntax and no capability id: neither is anything a model can act on.
    expect(
      describeWithholdReason({
        layer: 'policy',
        kind: 'rule',
        denial: { rule: { action: 'tool:x', resource: '*', effect: 'deny' } },
      }),
    ).toBe("switched off by this agent's rules")
    const authority = describeWithholdReason({
      layer: 'authority',
      kind: 'missing',
      capability: 'config.proposals',
    })
    expect(authority).not.toContain('config.proposals')
    expect(authority).toBe('the host does not provide it in this run')
  })
})
