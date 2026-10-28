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
    expect(verdictFor(chat(), { name: TOOL.Read, tool: tool(TOOL.Read) })).toEqual({
      state: 'live',
    })
  })

  test('shape: a `never` tool is withheld for a child even when its role declared it', () => {
    const facts = child(['read', TOOL.AskUserQuestion, TOOL.Configure])
    for (const name of [TOOL.AskUserQuestion, TOOL.Configure]) {
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
    expect(verdictFor(chat(), { name: TOOL.Jobs, missingCapability: 'jobs.available' })).toEqual({
      state: 'withheld',
      reason: { layer: 'authority', kind: 'missing', capability: 'jobs.available' },
    })
    expect(verdictFor(chat(), { name: TOOL.Jobs })).toEqual({
      state: 'withheld',
      reason: { layer: 'authority', kind: 'missing', capability: `host:${TOOL.Jobs}` },
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
    const denial = { rule: { action: 'tool:Loops', resource: '*', effect: 'deny' } }
    const facts = chat({
      disabledTools: new Set([TOOL.Loops]),
      toolDenials: new Map([[TOOL.Loops, denial]]),
    })
    expect(verdictFor(facts, { name: TOOL.Loops, tool: tool(TOOL.Loops) })).toEqual({
      state: 'withheld',
      reason: { layer: 'policy', kind: 'rule', denial },
      remedy: { remedyId: 'tool.enable', target: TOOL.Loops },
    })
    // Without a resolved denial the reason is still policy.
    expect(
      verdictFor(chat({ disabledTools: new Set([TOOL.Loops]) }), {
        name: TOOL.Loops,
        tool: tool(TOOL.Loops),
      }),
    ).toEqual({
      state: 'withheld',
      reason: { layer: 'policy', kind: 'rule', denial: null },
      remedy: { remedyId: 'tool.enable', target: TOOL.Loops },
    })
  })

  test('monotone: an upper layer decides before a lower one can offer a remedy', () => {
    // Disabled by rule AND structurally impossible → the shape reason, no remedy.
    const facts = child(['read'], { disabledTools: new Set([TOOL.AskUserQuestion]) })
    const verdict = verdictFor(facts, {
      name: TOOL.AskUserQuestion,
      tool: tool(TOOL.AskUserQuestion),
    })
    expect(verdict.state).toBe('withheld')
    expect(verdict.state === 'withheld' && verdict.reason.layer).toBe('shape')
    expect(verdict.state === 'withheld' && verdict.remedy).toBeUndefined()
    // Disabled by rule AND the host has no port → authority first, again no remedy.
    const gap = verdictFor(chat({ disabledTools: new Set([TOOL.Jobs]) }), { name: TOOL.Jobs })
    expect(gap.state === 'withheld' && gap.reason.layer).toBe('authority')
  })

  test('remediable withholds are exactly the policy rows; the rest stay private to the host', () => {
    const facts = chat({ disabledTools: new Set([TOOL.Loops]) })
    const ledger = resolveToolSurface(facts, [
      { name: TOOL.Loops, tool: tool(TOOL.Loops) },
      { name: TOOL.Jobs },
      { name: TOOL.Read, tool: tool(TOOL.Read) },
    ])
    expect(remediableWithholds(ledger).map((row) => row.name)).toEqual([TOOL.Loops])
  })

  test('economy: only a live verdict can become deferred', () => {
    const ledger = resolveToolSurface(chat({ disabledTools: new Set([TOOL.Loops]) }), [
      { name: TOOL.Loops, tool: tool(TOOL.Loops) },
      { name: TOOL.Skill, tool: tool(TOOL.Skill) },
    ])
    const deferred = markDeferred(
      ledger,
      new Map([
        [TOOL.Skill, 'core'],
        [TOOL.Loops, 'core'],
      ]),
    )
    expect(deferred.get(TOOL.Skill)).toEqual({ state: 'deferred', source: 'core' })
    expect(deferred.get(TOOL.Loops)?.state).toBe('withheld')
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

describe('a plugin agent type’s lists', () => {
  const echo = tool('mcp_p_ctl_echo', { aliases: ['mcp__plugin_p_ctl__echo'] })
  const other = tool('mcp_p_ctl_admin_drop', { aliases: ['mcp__plugin_p_ctl_admin__drop'] })
  const notDeclared = { state: 'withheld', reason: { layer: 'shape', kind: 'not-declared' } }

  test('a tools list names an MCP tool by its engine name, its CC address or its server’s *', () => {
    for (const entry of ['mcp_p_ctl_echo', 'mcp__plugin_p_ctl__echo', 'mcp__plugin_p_ctl__*'])
      expect(verdictFor(child(['read', entry]), { name: echo.name, tool: echo })).toEqual({
        state: 'live',
      })
    // A server's * ends where the server's name does, in either spelling.
    for (const entry of ['mcp__plugin_p_ctl__*', 'mcp_p_ctl_*'])
      expect(verdictFor(child([entry]), { name: other.name, tool: other })).toMatchObject(
        notDeclared,
      )
    expect(verdictFor(child(['mcp_p_ctl_*']), { name: echo.name, tool: echo })).toEqual({
      state: 'live',
    })
    expect(verdictFor(child(['read']), { name: echo.name, tool: echo })).toMatchObject(notDeclared)
  })

  test('disallowedTools switch an MCP tool off by its CC address or its server’s *', () => {
    for (const entry of ['mcp__plugin_p_ctl__echo', 'mcp_p_ctl_*'])
      expect(
        verdictFor(child(['read', 'mcp_p_ctl_echo'], { disabledTools: new Set([entry]) }), {
          name: echo.name,
          tool: echo,
        }),
      ).toMatchObject({ state: 'withheld', reason: { layer: 'policy' } })
  })

  test('without a tools list the child takes what the chat admits by default', () => {
    const facts: RunFacts = {
      profile: resolveRunProfile({ sessionKind: 'subagent' }, { inheritsConversationTools: true }),
      authority: undefined,
      disabledTools: new Set(),
    }
    const plugin = tool('lookup')
    const chatOnly = tool('canvas', {
      exposure: { chat: 'opt-in', subagent: 'opt-in', automation: 'opt-in' },
    })
    expect(verdictFor(facts, { name: echo.name, tool: echo })).toEqual({ state: 'live' })
    expect(verdictFor(facts, { name: 'lookup', tool: plugin })).toEqual({ state: 'live' })
    expect(verdictFor(facts, { name: 'canvas', tool: chatOnly })).toMatchObject(notDeclared)
    // Built-ins stay the subagent shape's: a chat-only default is not inherited.
    expect(
      verdictFor(facts, { name: TOOL.GlobalSearch, tool: tool(TOOL.GlobalSearch) }),
    ).toMatchObject(notDeclared)
    // A child that did not inherit takes none of them.
    expect(verdictFor(child(null), { name: echo.name, tool: echo })).toMatchObject(notDeclared)
  })
})
