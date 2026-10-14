import { describe, expect, test } from 'bun:test'

import {
  composeCapabilities,
  NO_ROSTERS,
  projectCapabilities,
  resolveCapabilities,
  skillOverridesOf,
} from './resolve'
import type { Rule } from './rule'
import type { CapabilityRuleRepository } from './rule-repository'

const deny = (action: string): Rule => ({ action, resource: '*', effect: 'deny' })

/** A repository backed by a plain map — the resolver's job is WHOSE rules it asks for. */
function fakeRepo(rows: Record<string, Rule[]>) {
  const asked: string[] = []
  const repo: CapabilityRuleRepository = {
    read: async (_u, agentId) => {
      asked.push(agentId)
      return rows[agentId] ?? []
    },
    readMany: async (_u, agentIds) =>
      new Map(agentIds.map((agentId) => [agentId, rows[agentId] ?? []])),
  }
  return { repo, asked }
}

describe('what the resolver reads', () => {
  test('one agent, one read — there is no chain to assemble', async () => {
    const { repo, asked } = fakeRepo({})
    await resolveCapabilities(repo, { userId: 'u1', agentId: 'reviewer' })
    expect(asked).toEqual(['reviewer'])
  })

  test("one agent's rules never reach another", async () => {
    // The id IS the key, which is the property that makes a shared table safe.
    const { repo } = fakeRepo({ reviewer: [deny('tool:write')] })
    const reviewer = await resolveCapabilities(repo, { userId: 'u1', agentId: 'reviewer' })
    const writer = await resolveCapabilities(repo, { userId: 'u1', agentId: 'writer' })
    expect(reviewer.allows('tool', 'write')).toBe(false)
    expect(writer.allows('tool', 'write')).toBe(true)
  })

  test('the deciding rule comes back with the verdict', async () => {
    const { repo } = fakeRepo({ reviewer: [deny('tool:write')] })
    const resolved = await resolveCapabilities(repo, { userId: 'u1', agentId: 'reviewer' })
    expect(resolved.verdict('tool', 'write').rule?.action).toBe('tool:write')
    expect(resolved.verdict('tool', 'read').rule).toBeUndefined()
  })

  test('an agent nobody wrote rules for may use everything', async () => {
    // One fallback for every kind: silence means allowed. What a dropped-in plugin defaults
    // to is the artifact's own trust class, not a per-kind default no rule could reach.
    const { repo } = fakeRepo({})
    const resolved = await resolveCapabilities(repo, { userId: 'u1', agentId: 'reviewer' })
    expect(resolved.allows('tool', 'bash')).toBe(true)
    expect(resolved.allows('plugin', 'acme')).toBe(true)
  })
})

describe('projecting onto rosters', () => {
  test('answers for every kind, and only about names in the roster', () => {
    const resolved = composeCapabilities([
      deny('tool:bash'),
      deny('skill:deploy'),
      deny('plugin:acme'),
      deny('mcp:github'),
    ])
    const projection = projectCapabilities(resolved, {
      ...NO_ROSTERS,
      tool: ['bash', 'read'],
      skill: ['deploy', 'review'],
      plugin: ['acme', 'globex'],
      mcp: ['github', 'linear'],
    })

    expect(projection.denied.tool).toEqual(['bash'])
    expect(projection.denied.skill).toEqual(['deploy'])
    expect(projection.denied.plugin).toEqual(['acme'])
    expect(projection.denied.mcp).toEqual(['github'])
    expect(skillOverridesOf(projection.denied.skill)).toEqual({ deploy: 'off' })
  })

  /**
   * The bug the roster type exists to make visible: a kind handed nothing reports nothing
   * denied, however many rules the list holds for it.
   */
  test('an empty roster hides every rule of its kind', () => {
    const resolved = composeCapabilities([deny('skill:deploy')])

    expect(projectCapabilities(resolved, NO_ROSTERS).denied.skill).toEqual([])
    expect(
      projectCapabilities(resolved, { ...NO_ROSTERS, skill: ['deploy'] }).denied.skill,
    ).toEqual(['deploy'])
  })

  test('a tool with a later argument exception stays registered', () => {
    // Removing it would take the live gate's chance to judge each call — and the exception
    // the user wrote is exactly the case they wanted judged.
    const resolved = composeCapabilities([
      deny('tool:bash'),
      { action: 'tool:bash', resource: 'git *', effect: 'allow' },
    ])
    expect(projectCapabilities(resolved, { ...NO_ROSTERS, tool: ['bash'] }).denied.tool).toEqual([])
  })

  test('a confirmation about a resource CLASS is not such an exception', () => {
    // A class asks about the manner of a call, so it presupposes a permitted call rather than
    // permitting one. Reading it as an exception is what made every shipped preset toothless:
    // each ends with `tool:* outside-workspace ask` and `tool:bash dangerous ask`, so a closed
    // allowlist removed nothing at all and refused the calls one by one instead.
    const resolved = composeCapabilities([
      deny('tool:*'),
      { action: 'tool:read', resource: '*', effect: 'allow' },
      { action: 'tool:*', resource: 'outside-workspace', effect: 'ask' },
      { action: 'tool:bash', resource: 'dangerous', effect: 'ask' },
    ])
    expect(
      projectCapabilities(resolved, { ...NO_ROSTERS, tool: ['read', 'write', 'bash'] }).denied.tool,
    ).toEqual(['write', 'bash'])
  })

  test('the permission projection keeps the stored order', () => {
    // Order is the semantics: the gate applies the same last-match rule to this list that
    // `verdictIn` applies to the stored one, so a reordered projection is a different policy.
    const resolved = composeCapabilities([
      { action: 'tool:bash', resource: '*', effect: 'allow' },
      { action: 'tool:bash', resource: 'rm *', effect: 'deny' },
    ])
    expect(
      projectCapabilities(resolved, NO_ROSTERS).permissions.map((rule) => rule.pattern),
    ).toEqual(['*', 'rm *'])
  })
})
