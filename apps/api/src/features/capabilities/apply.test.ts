import { describe, expect, test } from 'bun:test'
import { DEFAULT_AGENT_ID } from '@localixai/agent/agents'

import {
  createCapabilityApplyService,
  kindOfAction,
  namesOf,
  type CapabilityReactions,
} from './apply'
import type { AvailabilityWriter } from './availability'
import type { CapabilitySnapshot } from '../../contracts/capability-snapshot'
import type { RuleChange } from './rule-changes'
import type { CapabilitySnapshotService } from './snapshot'

const change = (action: string, effect: RuleChange['effect'], resource = '*'): RuleChange => ({
  action,
  resource,
  effect,
})

/** Records what reached the store — the point of this service is WHAT it writes, and once. */
function recordingWriter() {
  const writes: Array<{ scope: string; changes: readonly RuleChange[] }> = []
  const availability: AvailabilityWriter = {
    set: async () => {},
    clear: async () => {},
    apply: async (_userId: string, agentId: string, changes: readonly RuleChange[]) => {
      writes.push({ scope: agentId, changes })
    },
  }
  return { writes, availability }
}

function snapshots(seen: unknown[] = []): CapabilitySnapshotService {
  return {
    getSnapshot: async (input) => {
      seen.push(input)
      return {
        revision: 7,
        scope: { projectId: input.projectId ?? '', agentId: input.agentId ?? null },
      } as unknown as CapabilitySnapshot
    },
  }
}

const service = (reactions: CapabilityReactions = {}, seen: unknown[] = []) => {
  const { writes, availability } = recordingWriter()
  return {
    writes,
    seen,
    svc: createCapabilityApplyService({
      availability,
      snapshots: snapshots(seen),
      reactions,
      awaitSettle: async () => {},
    }),
  }
}

describe('one write path for every capability kind', () => {
  test('writes every kind in ONE transaction and answers with the fresh snapshot', async () => {
    const seen: unknown[] = []
    const { writes, svc } = service({}, seen)

    const snapshot = await svc.apply('u1', {
      projectId: 'PRJ-1',
      changes: [
        change('tool:bash', 'deny'),
        change('skill:deploy', 'deny'),
        change('mcp:github', 'allow'),
        change('plugin:first-fixture', 'default'),
      ],
    })

    // One write, not one per kind: a request spanning kinds used to be four transactions
    // with another client's request free to land between them.
    expect(writes).toHaveLength(1)
    // No agent named: the write lands on the one that always exists, which is also the one
    // a listing or a boot-time load would have asked. Nothing resolves to "nobody".
    expect(writes[0]!.scope).toBe(DEFAULT_AGENT_ID)
    expect(writes[0]!.changes.map((c) => `${c.action}=${c.effect}`)).toEqual([
      'tool:bash=deny',
      'skill:deploy=deny',
      'mcp:github=allow',
      'plugin:first-fixture=default',
    ])
    expect(snapshot.revision).toBe(7)
    // The snapshot is read back for the same pair the write used: the project decides what is
    // LISTED, the agent decides what the rules say about it.
    expect(seen).toEqual([{ userId: 'u1', projectId: 'PRJ-1', agentId: DEFAULT_AGENT_ID }])
  })

  test('an agent scope is the scope written', async () => {
    const { writes, svc } = service()

    await svc.apply('u1', {
      projectId: 'PRJ-1',
      agentId: 'builtin:qa',
      changes: [change('tool:bash', 'deny')],
    })

    expect(writes[0]!.scope).toBe('builtin:qa')
  })

  test('a kind expands its own consequences into the same write', async () => {
    const { writes, svc } = service({
      plugin: {
        expand: async (_u, _scope, changes) =>
          namesOf(changes, 'plugin', (effect) => effect === 'allow').map((name) =>
            change(`plugin:${name}-dep`, 'allow'),
          ),
      },
    })

    await svc.apply('u1', { changes: [change('plugin:first-fixture', 'allow')] })

    expect(writes).toHaveLength(1)
    expect(writes[0]!.changes.map((c) => c.action)).toEqual([
      'plugin:first-fixture',
      'plugin:first-fixture-dep',
    ])
  })

  test('a refusal writes nothing at all', async () => {
    const { writes, svc } = service({
      agent: {
        validate: async () => {
          throw new Error('this agent cannot be switched off')
        },
      },
    })

    await expect(
      svc.apply('u1', {
        changes: [change('tool:bash', 'deny'), change('agent:builtin:localix', 'deny')],
      }),
    ).rejects.toThrow('cannot be switched off')
    expect(writes).toEqual([])
  })

  test('only a kind that re-wires live hosts is waited for', async () => {
    const settled: number[] = []
    const build = (reactions: CapabilityReactions) => {
      const { availability } = recordingWriter()
      return createCapabilityApplyService({
        availability,
        snapshots: snapshots(),
        reactions,
        awaitSettle: async (ms) => {
          settled.push(ms)
        },
      })
    }

    await build({ mcp: {} }).apply('u1', { changes: [change('mcp:github', 'deny')] })
    expect(settled).toEqual([])

    await build({ plugin: { settles: true } }).apply('u1', {
      changes: [change('plugin:first-fixture', 'deny')],
    })
    expect(settled).toHaveLength(1)
  })

  test('reactions run after the write, once per kind', async () => {
    const order: string[] = []
    const { svc } = service({
      plugin: {
        after: async (_u, _scope, changes) => {
          order.push(`plugin:${namesOf(changes, 'plugin').join(',')}`)
        },
      },
    })

    await svc.apply('u1', {
      changes: [change('plugin:first-fixture', 'deny'), change('plugin:second-fixture', 'deny')],
    })

    expect(order).toEqual(['plugin:first-fixture,second-fixture'])
  })
})

describe('reading a capability action', () => {
  test('names its kind, and answers null for one this installation has no prefix for', () => {
    expect(kindOfAction('tool:bash')).toBe('tool')
    expect(kindOfAction('mcp:github/create_pr')).toBe('mcp')
    expect(kindOfAction('invocation:chat')).toBeNull()
  })

  /**
   * A rule about one tool's arguments is not a statement about the tool being there, so a
   * reaction must not treat it as one — re-wiring a host over an edit to a command pattern.
   */
  test('only changes about the capability itself name it', () => {
    const changes = [change('tool:bash', 'ask', 'git *'), change('tool:read', 'deny')]

    expect(namesOf(changes, 'tool')).toEqual(['read'])
  })
})
