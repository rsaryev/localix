import { describe, expect, test } from 'bun:test'
import { BUILTIN_TOOL_CATALOG } from '../agent-core/tool-names'
import { exposureLevel, shapeDefaultTools } from '../agent-core/run-shape'
import { builtinAgentPreset, builtinAgentPresetFor } from '../capabilities/builtin-agent-presets'
import { evaluate, type Rule } from '../capabilities/rule'
import { BUILTIN_AGENTS } from './builtin'
import { BUILTIN_TEAM } from './builtin-team'

/** The hosts a role may be invoked in, per its own preset. */
const invocableHosts = (agentId: string, rules: readonly Rule[]) =>
  ['chat', 'delegation', 'automation', 'channel', 'verification'].filter(
    (host) => evaluate(rules, `invocation:${host}`, agentId, 'deny').effect === 'allow',
  )

/**
 * What a role could actually hold in one host, which is the SHAPE's candidate list narrowed
 * by the role's own rules — not the rules alone. A chat, a delegated child and an unattended
 * automation each take their shape's defaults.
 */
const carried = (shape: 'chat' | 'subagent' | 'automation', rules: readonly Rule[]) =>
  shapeDefaultTools(shape)
    .filter((name) => exposureLevel(shape, name) !== 'never')
    .filter((name) => evaluate(rules, `tool:${name}`, '*', 'allow').effect !== 'deny')

describe('shipped definitions and independent presets', () => {
  test('every allowed tool is registered', () => {
    // Every SHIPPED agent, not only the conversational team: a name the catalog does not know
    // simply denies nothing, so a typo in a worker's list is silent without this.
    for (const agent of BUILTIN_AGENTS) {
      for (const rule of builtinAgentPreset(agent.handle)) {
        if (rule.effect === 'allow' && rule.action.startsWith('tool:')) {
          expect(Object.hasOwn(BUILTIN_TOOL_CATALOG, rule.action.slice(5))).toBe(true)
        }
      }
    }
  })

  /**
   * A preset grants a tool the role can never be handed, and nothing says so.
   *
   * `verifier` was allowed `browser` "to look at the thing" and could not: it is not
   * invocable in a chat, the subagent shape carries the tool only on an explicit opt-in, and
   * the board's host roster did not list it. The allow read as a capability for a year of
   * commits while the role ran blind. An allow has to be reachable in at least ONE host the
   * role may be invoked in, or it is a claim the product does not honour.
   */
  test('every tool a shipped role is allowed is reachable in some host it runs in', () => {
    for (const agent of BUILTIN_AGENTS) {
      const rules = builtinAgentPreset(agent.handle)
      const allowed = rules
        .filter((rule) => rule.effect === 'allow' && rule.action.startsWith('tool:'))
        .map((rule) => rule.action.slice(5))
      if (allowed.length === 0) continue
      const hosts = invocableHosts(agent.id, rules)
      const reachable = new Set([
        ...(hosts.includes('chat') ? carried('chat', rules) : []),
        ...(hosts.includes('delegation') ? carried('subagent', rules) : []),
        ...(hosts.includes('automation') ? carried('automation', rules) : []),
      ])
      expect({
        agent: agent.handle,
        unreachable: allowed.filter((name) => !reachable.has(name)),
      }).toEqual({ agent: agent.handle, unreachable: [] })
    }
  })

  test('the reachability guard fails when a grant has no host that carries it', () => {
    // The positive control: `configure` is chat-only, so a role denied the chat host cannot
    // hold it however its tool list reads.
    //
    // Written out rather than read off a shipped role, because no shipped role is denied the
    // chat host any more — the three board workers that were are retired. A control that
    // borrows a fixture from the data it is controlling passes for the wrong reason the day
    // that data changes, which is what happened here.
    const rules: Rule[] = [
      { action: 'tool:*', resource: '*', effect: 'deny' },
      { action: 'tool:configure', resource: '*', effect: 'allow' },
      { action: 'invocation:*', resource: 'agent:worker', effect: 'deny' },
      { action: 'invocation:automation', resource: 'agent:worker', effect: 'allow' },
    ]
    expect(invocableHosts('agent:worker', rules)).toEqual(['automation'])
    expect(new Set(carried('automation', rules)).has('configure')).toBe(false)
  })
  test('the team is invocable in chat through policy', () => {
    for (const agent of BUILTIN_TEAM) {
      const rules = builtinAgentPreset(agent.handle)
      expect(evaluate(rules, 'invocation:chat', agent.id, 'deny').effect).toBe('allow')
      expect('type' in agent).toBe(false)
      expect('tools' in agent).toBe(false)
    }
  })

  test('the shipped hierarchy elects one lead without turning specialists into a ranking', () => {
    expect(
      Object.fromEntries(BUILTIN_TEAM.map((agent) => [agent.handle, agent.leadershipPriority])),
    ).toEqual({
      localix: 1,
      pm: 1,
      architect: 1,
      lead: 2,
      backend: 0,
      frontend: 0,
      design: 0,
      qa: 0,
      devops: 0,
    })
    expect(
      BUILTIN_TEAM.filter((agent) => agent.leadershipPriority === 2).map((agent) => agent.handle),
    ).toEqual(['lead'])
  })
  test('all colleagues keep collaboration and verification; host-changing tools follow their role', () => {
    for (const { handle } of BUILTIN_TEAM) {
      for (const tool of [
        'read',
        'search',
        'bash',
        'tool_output',
        'agents',
        'conversation_control',
        'plan',
      ]) {
        expect(
          evaluate(
            builtinAgentPreset(handle),
            `tool:${tool}`,
            '*',
            handle === 'localix' ? 'allow' : 'deny',
          ).effect,
          `${handle} cannot use ${tool}`,
        ).toBe('allow')
      }
    }
    expect(evaluate(builtinAgentPreset('pm'), 'tool:vault', '*', 'allow').effect).toBe('deny')
    expect(evaluate(builtinAgentPreset('design'), 'tool:plugin_build', '*', 'allow').effect).toBe(
      'deny',
    )
    expect(evaluate(builtinAgentPreset('devops'), 'tool:vault', '*', 'deny').effect).toBe('allow')
  })
  test('every shipped role offers its own rules back to the editor', () => {
    for (const agent of BUILTIN_AGENTS) {
      expect(builtinAgentPresetFor(agent.id)).toEqual(builtinAgentPreset(agent.handle))
    }
  })

  test('only a role we ship has a default to restore', () => {
    // An id off the wire is arbitrary text: a handle we do not ship, and a handle that is
    // not even a legal one, both have to answer "no default" rather than throw.
    for (const id of ['agent-01H', 'builtin:not-a-role', 'builtin:', 'builtin:Not A Handle!']) {
      expect(builtinAgentPresetFor(id)).toBeNull()
    }
  })

  test('the default assistant has no tool allowlist — only the confirmation guards', () => {
    // It is the agent every question falls back to, so a roster it could fall behind is a
    // worse answer than "everything installed". What it does carry is the two confirmations,
    // because those are about arguments rather than about which tools exist.
    const toolRules = builtinAgentPreset('localix').filter((rule) =>
      rule.action.startsWith('tool:'),
    )
    expect(toolRules.map((rule) => `${rule.action} ${rule.resource} ${rule.effect}`)).toEqual([
      'tool:* outside-workspace ask',
      'tool:bash dangerous ask',
    ])
  })
})
