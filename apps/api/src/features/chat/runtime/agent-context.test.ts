import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { agentDefinitionSchema } from '@localixai/agent/agents'
import { composeCapabilities } from '../../capabilities/resolve'
import { emptyLoadedPlugins } from '../../plugins/loader-contract'
import { sessionFixture, routedParticipants } from '../../../testing/session-fixture'
import { createSessionSnapshotCache } from './session-snapshot'
import type { FrozenSessionContext } from './frozen-session-context'
import { prepareRunContext, type PromptContextDeps } from './prompt-context'
import type { MemoryScope } from '../../memory/scope-policy'

test('per-agent skills and memory selection reach ordinary and delegated turns without leaking', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'localix-agent-context-'))
  try {
    const reads: string[][] = []
    const snapshots = new Map<string, FrozenSessionContext>()
    const externalMemoryReads: string[] = []
    const loadedPlugins = {
      ...emptyLoadedPlugins(),
      memory: {
        pluginName: 'fixture-memory',
        provider: {
          loadContext: async () => {
            externalMemoryReads.push('recall')
            return { context: 'External unscoped notes.' }
          },
        },
      },
    }
    const skills = ['shared', 'alpha', 'beta', 'blocked'].map((name) => ({
      name,
      description: '',
      content: `instructions for ${name}`,
      scope: 'project',
      path: '',
      dir: cwd,
    }))
    const deps = {
      memoryRepo: {
        listWithUsage: async (_u: string, scopes: string[]) => {
          reads.push(scopes)
          return {
            notes: scopes.map((scope) => ({ key: scope || 'global', value: scope || 'global' })),
            usage: { chars: scopes.length, limit: 100, pct: scopes.length },
          }
        },
      },
      projectsRepo: { getProject: async () => ({ workingDir: cwd, settings: null }) },
      pluginRepo: {},
      contextSnapshots: createSessionSnapshotCache<FrozenSessionContext>(),
      laneSnapshots: {
        get: async (_u: string, address: unknown) => snapshots.get(JSON.stringify(address)),
        set: async (
          _u: string,
          address: unknown,
          _boundary: string,
          value: FrozenSessionContext,
        ) => {
          snapshots.set(JSON.stringify(address), structuredClone(value))
        },
      },
      runScopes: { resolve: async () => [skills, loadedPlugins, []] },
      now: () => '2026-01-01T00:00:00Z',
    } as unknown as PromptContextDeps
    for (const sessionKind of ['chat', 'subagent'] as const) {
      const session = sessionFixture({
        projectId: 'p',
        sessionKind,
        pinnedSkills: ['shared'],
        agents: routedParticipants({ agentId: 'native:project:alpha', handle: 'alpha' }),
      })
      const prepare = (name: string, scope?: MemoryScope) => {
        const agentId = `native:project:${name}`
        session.agents = routedParticipants({ agentId, handle: name })
        return prepareRunContext(deps, {
          userId: 'u',
          session,
          speakerAgentId: agentId,
          historyMessages: [],
          viewEpoch: '',
          globalAgentSettings: null,
          agent: {
            approval: 'policy',
            definition: agentDefinitionSchema.parse({
              id: agentId,
              handle: name,
              description: '',
              instructions: 'Follow the task.',
              context: {
                preloadSkills: [name, 'shared', 'blocked'],
                memory: scope ? { scope } : undefined,
              },
            }),
            capabilities: composeCapabilities([
              { action: 'skill:blocked', resource: '*', effect: 'deny' },
            ]),
          },
        })
      }
      const alpha = await prepare('alpha', 'global')
      expect(alpha.pinnedSkills.map((skill) => skill.name)).toEqual(['shared', 'alpha'])
      expect(reads.at(-1)).toEqual([''])
      expect(alpha.frozenContext.memoryContext).toBe('global: global')
      const beta = await prepare('beta', 'project')
      expect(beta.pinnedSkills.map((skill) => skill.name)).toEqual(['shared', 'beta'])
      expect(beta.frozenContext.memoryContext).toBe('p: p')
      const changed = await prepare('alpha', 'session')
      expect(reads.at(-1)).toEqual([`session:${session.id}`])
      expect(changed.frozenContext.memoryContext).toBe(
        `session:${session.id}: session:${session.id}`,
      )
      expect(changed.frozenContext.memoryUsage?.chars).toBe(1)
      deps.contextSnapshots = createSessionSnapshotCache<FrozenSessionContext>()
      expect((await prepare('alpha', 'session')).frozenContext).toEqual(changed.frozenContext)
      if (sessionKind === 'chat') {
        expect(externalMemoryReads).toEqual([])
        expect((await prepare('alpha')).frozenContext.memoryContext).toBe(
          'External unscoped notes.',
        )
        expect(externalMemoryReads).toEqual(['recall'])
        expect((await prepare('alpha', 'session')).frozenContext.memoryContext).toBe(
          changed.frozenContext.memoryContext,
        )
        expect(externalMemoryReads).toEqual(['recall'])
      }
    }
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})
