import { describe, expect, test } from 'bun:test'

import { agentScopedHooks } from './agent-hooks'

// sub-agents.md, `hooks`: "run only while that subagent is active", `Stop` becomes `SubagentStop`,
// project-level ones wait for the folder's trust, and a plugin's agent has none.
const HOOKS = { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'x' }] }] }
const child = (provenance: Record<string, unknown> = {}) =>
  ({
    id: 'child',
    provenance: {
      kind: 'task-delegation',
      parentSessionId: 'p',
      agentType: 'guard',
      ...provenance,
    },
  }) as never
const agent = (over: Record<string, unknown> = {}) => ({ source: 'user', hooks: HOOKS, ...over })

describe('the hooks of a delegated agent', () => {
  test('a delegated child of a user, managed or trusted project agent runs them as a subagent', () => {
    for (const source of ['user', 'managed', 'project']) {
      expect(agentScopedHooks(child(), agent({ source }), { projectTrusted: true })).toEqual([
        { raw: HOOKS, source: 'agent', asSubagent: true, agentType: 'guard' },
      ])
    }
  })

  test('none for a plugin agent, a project agent in an untrusted folder, or no hooks', () => {
    expect(
      agentScopedHooks(child(), agent({ source: 'plugin' }), { projectTrusted: true }),
    ).toEqual([])
    expect(
      agentScopedHooks(child(), agent({ source: 'project' }), { projectTrusted: false }),
    ).toEqual([])
    expect(
      agentScopedHooks(child(), agent({ hooks: undefined }), { projectTrusted: true }),
    ).toEqual([])
    expect(agentScopedHooks(child(), undefined, { projectTrusted: true })).toEqual([])
  })

  test('none outside a delegated child, and none for a fork, which is its delegator', () => {
    const root = { id: 'r', provenance: { kind: 'root' } } as never
    expect(agentScopedHooks(root, agent(), { projectTrusted: true })).toEqual([])
    expect(
      agentScopedHooks(child({ fork: { baseMessageId: null, snapshotMessageId: 'm' } }), agent(), {
        projectTrusted: true,
      }),
    ).toEqual([])
  })
})
