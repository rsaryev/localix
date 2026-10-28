import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { agentDefinitionSchema } from '@localixai/agent/agents'
import { composeCapabilities } from '../../capabilities/resolve'
import { emptyLoadedPlugins } from '../../plugins/loader-contract'
import { emptyLoadedMiniApps } from '../../mini-apps/loader-contract'
import { sessionFixture, routedAgent } from '../../../testing/session-fixture'
import { createSessionSnapshotCache } from './session-snapshot'
import type { FrozenSessionContext } from './frozen-session-context'
import { prepareRunContext, type PromptContextDeps } from './prompt-context'
import { claudeProjectKey } from '../../memory/auto-memory'

test('per-agent skills and the repository memory reach ordinary and delegated turns without leaking', async () => {
  const cwd = await realpath(await mkdtemp(join(tmpdir(), 'localix-agent-context-')))
  const home = join(cwd, 'home')
  const memoryDir = join(home, '.claude', 'projects', claudeProjectKey(cwd), 'memory')
  await mkdir(memoryDir, { recursive: true })
  await writeFile(join(memoryDir, 'MEMORY.md'), '- [Role](role.md) — QA lead\n')
  try {
    let providerOn = false
    const snapshots = new Map<string, FrozenSessionContext>()
    const externalMemoryReads: string[] = []
    const memoryProvider = {
      app: 'fixture-memory',
      provider: {
        loadContext: async () => {
          externalMemoryReads.push('recall')
          return { context: 'External unscoped notes.' }
        },
      },
    }
    const loadedMiniApps = {
      ...emptyLoadedMiniApps(),
      get memory() {
        return providerOn ? memoryProvider : null
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
      claudeHome: home,
      projectsRepo: { getProject: async () => ({ workingDir: cwd, settings: null }) },
      pluginRepo: {},
      contextSnapshots: createSessionSnapshotCache<FrozenSessionContext>(),
      promptSnapshots: {
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
      runScopes: { resolve: async () => [skills, emptyLoadedPlugins(), loadedMiniApps, []] },
      now: () => '2026-01-01T00:00:00Z',
    } as unknown as PromptContextDeps
    for (const sessionKind of ['chat', 'subagent'] as const) {
      const session = sessionFixture({
        projectId: 'p',
        sessionKind,
        pinnedSkills: ['shared'],
        agent: routedAgent({ agentId: 'native:project:alpha', name: 'alpha' }),
      })
      const prepare = (name: string) => {
        const agentId = `native:project:${name}`
        session.agent = routedAgent({ agentId, name: name })
        return prepareRunContext(deps, {
          userId: 'u',
          session,
          agentId,
          historyMessages: [],
          viewEpoch: '',
          globalAgentSettings: null,
          agent: {
            approval: 'policy',
            definition: agentDefinitionSchema.parse({
              id: agentId,
              name,
              description: '',
              instructions: 'Follow the task.',
              skills: [name, 'shared', 'blocked'],
            }),
            capabilities: composeCapabilities([
              { action: 'skill:blocked', resource: '*', effect: 'deny' },
            ]),
          },
        })
      }
      providerOn = false
      const alpha = await prepare('alpha')
      expect(alpha.pinnedSkills.map((skill) => skill.name)).toEqual(['shared', 'alpha'])
      expect(alpha.frozenContext).toMatchObject({
        memoryDir,
        memoryContext: '- [Role](role.md) — QA lead',
        memoryClipped: false,
      })
      const beta = await prepare('beta')
      expect(beta.pinnedSkills.map((skill) => skill.name)).toEqual(['shared', 'beta'])
      expect(beta.frozenContext.memoryDir).toBe(memoryDir)

      // A mini app's memory provider recalls into the same section, once per snapshot boundary
      // (a chat's; other runs build their context fresh and keep no project memory).
      if (sessionKind !== 'chat') continue
      providerOn = true
      deps.contextSnapshots = createSessionSnapshotCache<FrozenSessionContext>()
      snapshots.clear()
      const reads = externalMemoryReads.length
      expect((await prepare('alpha')).frozenContext.memoryContext).toBe('External unscoped notes.')
      expect((await prepare('alpha')).frozenContext.memoryContext).toBe('External unscoped notes.')
      expect(externalMemoryReads.length).toBe(reads + 1)
    }
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})
