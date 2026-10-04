import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { agentDefinitionSchema } from '@localixai/agent/agents'
import { composeCapabilities } from '../../capabilities/resolve'
import type { AgentsService } from '../../agents/service-contract'
import { requireRunAgent } from './run/require-run-agent'
import { runTurnLimit } from './run/turn-limit'
import { routedParticipants, sessionFixture } from '../../../testing/session-fixture'
import { createSessionSnapshotCache } from './session-snapshot'
import type { FrozenSessionContext } from './agent-runner-types'
import { prepareRunContext, type PromptContextDeps } from './prompt-context'
import type { PersistedMessage } from '../contracts'
import type { ParticipantLaneSnapshotRepository } from '../participant-lane-snapshot-repository'

function snapshotStore(): ParticipantLaneSnapshotRepository {
  const values = new Map<string, FrozenSessionContext>()
  return {
    get: async (user, address, boundary) => values.get(JSON.stringify([user, address, boundary])),
    set: async (user, address, boundary, value) => {
      values.set(JSON.stringify([user, address, boundary]), structuredClone(value))
    },
  }
}

test('each turn resolves current native behavior and policy while retaining frozen memory', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'localix-run-context-'))
  try {
    let agentId = 'native:project:worker'
    const session = sessionFixture({
      projectId: 'project',
      agents: routedParticipants({ agentId, handle: 'worker' }),
    })
    let version = 1
    const calls: unknown[] = []
    const deps = {
      memoryRepo: {
        listWithUsage: async () => ({
          notes: [{ key: 'note', value: `memory-${version}` }],
          usage: { chars: 1, limit: 100, pct: 1 },
        }),
      },
      projectsRepo: { getProject: async () => ({ workingDir: cwd, settings: null }) },
      pluginRepo: {},
      contextSnapshots: createSessionSnapshotCache<FrozenSessionContext>(),
      laneSnapshots: snapshotStore(),
      runScopes: {
        resolve: async () => [
          [],
          {
            tools: [],
            binDirs: [],
            mcpServers: [],
            skills: [],
            hooks: [],
            ccHooks: [],
            lspServers: [],
            monitors: [],
            channels: [],
            promptSections: [],
            agents: [],
            memory: null,
            backends: [],
            loaded: [],
          },
          [],
        ],
      },
      now: () => '2026-01-01T00:00:00Z',
    } as unknown as PromptContextDeps
    const resolveRunAgent: AgentsService['resolveRunAgent'] = async (...args) => {
      calls.push(args)
      if (version === 3) return { status: 'policy_denied' }
      return {
        status: 'allowed',
        agent: {
          approval: 'policy',
          definition: agentDefinitionSchema.parse({
            id: version === 4 ? 'native:project:other' : agentId,
            handle: 'worker',
            description: '',
            instructions: `instructions-${version}`,
            limits: { maxTurns: version === 1 ? 12 : 3 },
          }),
          capabilities: composeCapabilities(
            version === 2 ? [{ action: 'tool:write', resource: '*', effect: 'deny' }] : [],
          ),
        },
      }
    }
    const params = {
      userId: 'user',
      session,
      historyMessages: [] as PersistedMessage[],
      // The conversation start, as `loadModelView` names it before any checkpoint or `/clear`.
      viewEpoch: '',
      userProfile: null,
      responseDefaults: undefined,
      globalAgentSettings: null,
    }
    const prepare = async () => {
      const agent = await requireRunAgent(resolveRunAgent, 'user', agentId, 'chat', 'project')
      return prepareRunContext(deps, { ...params, speakerAgentId: agentId, agent })
    }
    const first = await prepare()
    expect(first.agent.instructions).toBe('instructions-1')
    expect(runTurnLimit(first.agent)).toBe(12)
    expect(first.disabledTools).not.toContain('write')
    expect(first.frozenContext.memoryContext).toBe('note: memory-1')

    version = 2
    const next = await prepare()
    expect(next.agent.instructions).toBe('instructions-2')
    expect(runTurnLimit(next.agent)).toBe(3)
    expect(next.disabledTools).toContain('write')
    expect(next.frozenContext.memoryContext).toBe('note: memory-1')
    expect(calls).toEqual(Array.from({ length: 2 }, () => ['user', agentId, 'chat', 'project']))
    deps.contextSnapshots = createSessionSnapshotCache<FrozenSessionContext>()
    expect((await prepare()).frozenContext).toEqual(next.frozenContext)

    agentId = 'native:project:colleague'
    session.agents = routedParticipants({ agentId, handle: 'colleague' })
    expect((await prepare()).frozenContext.memoryContext).toBe('note: memory-2')
    // Back in the worker's lane, in the same view epoch: its frozen snapshot still holds.
    agentId = 'native:project:worker'
    session.agents = routedParticipants({ agentId, handle: 'worker' })
    expect((await prepare()).frozenContext.memoryContext).toBe('note: memory-1')
    // A checkpoint (or `/clear`) starts a new view epoch, and the prefix is rewritten anyway,
    // so that is when memory refreshes.
    params.viewEpoch = 'checkpoint-host'
    expect((await prepare()).frozenContext.memoryContext).toBe('note: memory-2')

    version = 3
    await expect(prepare()).rejects.toThrow(`Agent is unavailable: ${agentId} (policy_denied)`)
    version = 4
    await expect(prepare()).rejects.toThrow(`Agent is unavailable: ${agentId} (id_mismatch)`)
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})

/**
 * The rosters are the whole point of the projection.
 *
 * Every kind used to be projected against a PLACEHOLDER roster — the built-in tool names and
 * an empty skill list — because the rules were composed before discovery had run. So a
 * `skill:` rule was stored, listed as off in Settings, and then applied to nothing; a rule on
 * a plugin's tool was the same. The Settings screen and the turn disagreed, which is the one
 * failure this subsystem exists to prevent.
 */
test('a denied skill, plugin tool and plugin are absent from the turn', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'localix-run-rosters-'))
  try {
    const agentId = 'native:project:worker'
    const session = sessionFixture({
      projectId: 'project',
      agents: routedParticipants({ agentId, handle: 'worker' }),
    })
    const deps = {
      memoryRepo: { listWithUsage: async () => ({ notes: [], usage: null }) },
      projectsRepo: { getProject: async () => ({ workingDir: cwd, settings: null }) },
      pluginRepo: {},
      contextSnapshots: createSessionSnapshotCache<FrozenSessionContext>(),
      laneSnapshots: snapshotStore(),
      runScopes: {
        resolve: async () => [
          [
            {
              name: 'file-skill',
              description: '',
              content: '',
              scope: 'project',
              path: '',
              dir: '',
            },
          ],
          {
            tools: [{ name: 'first_convert' }, { name: 'second_quote' }],
            binDirs: [],
            mcpServers: [],
            skills: [
              {
                name: 'write-memo',
                description: '',
                content: '',
                scope: 'global',
                path: '',
                dir: '',
                pluginName: 'first-fixture',
              },
              {
                name: 'read-chart',
                description: '',
                content: '',
                scope: 'global',
                path: '',
                dir: '',
                pluginName: 'second-fixture',
              },
            ],
            hooks: [],
            ccHooks: [],
            lspServers: [],
            monitors: [],
            channels: [],
            promptSections: [],
            agents: [],
            memory: null,
            backends: [],
            loaded: [
              {
                name: 'first-fixture',
                scope: 'global',
                description: '',
                toolNames: ['first_convert'],
                skills: ['write-memo'],
                mcpServers: [],
              },
              {
                name: 'second-fixture',
                scope: 'global',
                description: '',
                toolNames: ['second_quote'],
                skills: ['read-chart'],
                mcpServers: [],
              },
            ],
          },
          [],
        ],
      },
      now: () => '2026-01-01T00:00:00Z',
    } as unknown as PromptContextDeps

    const resolveRunAgent: AgentsService['resolveRunAgent'] = async () => ({
      status: 'allowed',
      agent: {
        approval: 'policy',
        definition: agentDefinitionSchema.parse({
          id: agentId,
          handle: 'worker',
          description: '',
          instructions: 'x',
        }),
        capabilities: composeCapabilities([
          { action: 'skill:file-skill', resource: '*', effect: 'deny' },
          { action: 'tool:second_quote', resource: '*', effect: 'deny' },
          { action: 'plugin:first-fixture', resource: '*', effect: 'deny' },
        ]),
      },
    })

    const agent = await requireRunAgent(resolveRunAgent, 'user', agentId, 'chat', 'project')
    const context = await prepareRunContext(deps, {
      userId: 'user',
      session,
      speakerAgentId: agentId,
      historyMessages: [],
      viewEpoch: '',
      userProfile: null,
      responseDefaults: undefined,
      globalAgentSettings: null,
      agent,
    })

    // The skill rule reaches the roster the prompt is built from.
    expect(context.skillOverrides['file-skill']).toBe('off')
    // The plugin tool rule reaches the deny-list the registry subtracts with.
    expect(context.disabledTools).toContain('second_quote')
    // The denied PLUGIN takes its whole contribution with it, tool and skill alike…
    expect(context.loadedPlugins.tools.map((tool) => tool.name)).toEqual(['second_quote'])
    expect(context.allSkills.map((skill) => skill.name)).toEqual(['file-skill', 'read-chart'])
    // …while the plugin nobody ruled on keeps its own.
    expect(context.skillOverrides['read-chart']).toBeUndefined()
    expect(context.disabledTools).not.toContain('first_convert')
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})
