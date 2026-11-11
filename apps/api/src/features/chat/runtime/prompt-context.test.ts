import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { agentDefinitionSchema } from '@localixai/agent/agents'
import { autoMemoryDir } from '../../memory/auto-memory'
import { composeCapabilities } from '../../capabilities/resolve'
import { emptyLoadedPlugins } from '../../plugins/loader-contract'
import { emptyLoadedMiniApps } from '../../mini-apps/loader-contract'
import type { AgentsService } from '../../agents/service-contract'
import { requireRunAgent } from './run/require-run-agent'
import { runTurnLimit } from './run/turn-limit'
import { routedAgent, sessionFixture } from '../../../testing/session-fixture'
import { createSessionSnapshotCache } from './session-snapshot'
import type { FrozenSessionContext } from './agent-runner-types'
import { prepareRunContext, type PromptContextDeps } from './prompt-context'
import type { PersistedMessage } from '../contracts'
import type { SessionPromptSnapshotRepository } from '../session-prompt-snapshot-repository'

function snapshotStore(): SessionPromptSnapshotRepository {
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
      agent: routedAgent({ agentId, name: 'worker' }),
    })
    let version = 1
    const calls: unknown[] = []
    // The working folder doubles as the home, so its Claude Code memory folder is the test's own.
    const memoryDir = autoMemoryDir({ cwd, homeDir: cwd })!
    await mkdir(memoryDir, { recursive: true })
    const deps = {
      claudeHome: cwd,
      projectsRepo: { getProject: async () => ({ workingDir: cwd, settings: null }) },
      pluginRepo: {},
      contextSnapshots: createSessionSnapshotCache<FrozenSessionContext>(),
      promptSnapshots: snapshotStore(),
      runScopes: {
        resolve: async () => [emptyLoadedPlugins(), emptyLoadedMiniApps()],
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
            name: 'worker',
            description: '',
            instructions: `instructions-${version}`,
            maxTurns: version === 1 ? 12 : 3,
          }),
          capabilities: composeCapabilities(
            version === 2 ? [{ action: 'tool:Write', resource: '*', effect: 'deny' }] : [],
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
      globalAgentSettings: null,
    }
    const prepare = async () => {
      await writeFile(join(memoryDir, 'MEMORY.md'), `memory-${version}`)
      const agent = await requireRunAgent(resolveRunAgent, 'user', agentId, 'chat', 'project')
      const context = await prepareRunContext(deps, { ...params, agentId, agent })
      const prompt = await context.promptContext(undefined, new AbortController().signal)
      return { ...context, ...prompt }
    }
    const first = await prepare()
    expect(first.agent.instructions).toBe('instructions-1')
    expect(runTurnLimit(first.agent)).toBe(12)
    expect(first.disabledTools).not.toContain('Write')
    expect(first.frozenContext.memoryContext).toBe('memory-1')

    version = 2
    const next = await prepare()
    expect(next.agent.instructions).toBe('instructions-2')
    expect(runTurnLimit(next.agent)).toBe(3)
    expect(next.disabledTools).toContain('Write')
    expect(next.frozenContext.memoryContext).toBe('memory-1')
    expect(calls).toEqual(Array.from({ length: 2 }, () => ['user', agentId, 'chat', 'project']))
    deps.contextSnapshots = createSessionSnapshotCache<FrozenSessionContext>()
    expect((await prepare()).frozenContext).toEqual(next.frozenContext)

    // A checkpoint (or `/clear`) starts a new view epoch, and the prefix is rewritten anyway,
    // so that is when memory refreshes.
    params.viewEpoch = 'checkpoint-host'
    expect((await prepare()).frozenContext.memoryContext).toBe('memory-2')

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
 * Every kind used to be projected against a PLACEHOLDER roster — the built-in tool names —
 * because the rules were composed before discovery had run. So a rule on a mini app's tool was
 * stored, listed as off in Settings, and then applied to nothing. The Settings screen and the turn disagreed, which is the one
 * failure this subsystem exists to prevent.
 */
test('a denied mini app tool, mini app and plugin are absent from the turn', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'localix-run-rosters-'))
  try {
    const agentId = 'native:project:worker'
    const session = sessionFixture({
      projectId: 'project',
      agent: routedAgent({ agentId, name: 'worker' }),
    })
    const deps = {
      memoryRepo: { listWithUsage: async () => ({ notes: [], usage: null }) },
      projectsRepo: { getProject: async () => ({ workingDir: cwd, settings: null }) },
      pluginRepo: {},
      contextSnapshots: createSessionSnapshotCache<FrozenSessionContext>(),
      promptSnapshots: snapshotStore(),
      runScopes: {
        resolve: async () => [
          {
            ...emptyLoadedPlugins(),
            loaded: [
              {
                name: 'first-fixture',
                scope: 'global',
                description: '',
                skills: ['write-memo'],
                mcpServers: [],
              },
              {
                name: 'second-fixture',
                scope: 'global',
                description: '',
                skills: ['read-chart'],
                mcpServers: [],
              },
            ],
          },
          {
            ...emptyLoadedMiniApps(),
            tools: [{ name: 'first_convert' }, { name: 'second_quote' }, { name: 'third_plot' }],
            loaded: [
              { name: 'converter', scope: 'global', description: '', toolNames: ['first_convert'] },
              {
                name: 'quotes',
                scope: 'global',
                description: '',
                toolNames: ['second_quote', 'third_plot'],
              },
            ],
          },
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
          name: 'worker',
          description: '',
          instructions: 'x',
        }),
        capabilities: composeCapabilities([
          { action: 'tool:second_quote', resource: '*', effect: 'deny' },
          { action: 'plugin:first-fixture', resource: '*', effect: 'deny' },
          { action: 'mini-app:converter', resource: '*', effect: 'deny' },
        ]),
      },
    })

    const agent = await requireRunAgent(resolveRunAgent, 'user', agentId, 'chat', 'project')
    const context = await prepareRunContext(deps, {
      userId: 'user',
      session,
      agentId,
      historyMessages: [],
      viewEpoch: '',
      globalAgentSettings: null,
      agent,
    })

    // The tool rule reaches the deny-list the registry subtracts with.
    expect(context.disabledTools).toContain('second_quote')
    // The denied MINI APP takes its tools with it; the one nobody ruled on keeps its own.
    expect(context.loadedMiniApps.tools.map((tool) => tool.name)).toEqual([
      'second_quote',
      'third_plot',
    ])
    // The denied PLUGIN is not announced; the one nobody ruled on is (its skills: `run-skills.ts`).
    expect(context.loadedPlugins.loaded.map((plugin) => plugin.name)).toEqual(['second-fixture'])
    expect(context.disabledTools).not.toContain('third_plot')
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})

/**
 * A turn in a project whose folder was moved or deleted fails up front with the folder's own
 * words, instead of starting tools in a path that is not there.
 */
test('a turn in a project whose folder is gone fails with workspace_folder_missing', async () => {
  const home = await mkdtemp(join(tmpdir(), 'localix-run-gone-'))
  const gone = join(home, 'claude-plugin-kit')
  try {
    const agentId = 'native:project:worker'
    const deps = {
      claudeHome: home,
      projectsRepo: { getProject: async () => ({ workingDir: gone, settings: null }) },
      pluginRepo: {},
      contextSnapshots: createSessionSnapshotCache<FrozenSessionContext>(),
      promptSnapshots: snapshotStore(),
      runScopes: { resolve: async () => [emptyLoadedPlugins(), emptyLoadedMiniApps()] },
      now: () => '2026-01-01T00:00:00Z',
    } as unknown as PromptContextDeps
    const definition = agentDefinitionSchema.parse({
      id: agentId,
      name: 'worker',
      description: '',
      instructions: 'x',
    })
    const prepared = prepareRunContext(deps, {
      userId: 'user',
      session: sessionFixture({
        projectId: 'project',
        agent: routedAgent({ agentId, name: 'worker' }),
      }),
      historyMessages: [],
      viewEpoch: '',
      globalAgentSettings: null,
      agentId,
      agent: { approval: 'policy', definition, capabilities: composeCapabilities([]) },
    })
    await expect(prepared).rejects.toMatchObject({
      status: 409,
      code: 'workspace_folder_missing',
      detail: gone,
    })
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
