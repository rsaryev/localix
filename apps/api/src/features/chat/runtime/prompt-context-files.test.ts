import { expect, test } from 'bun:test'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'
import { agentDefinitionSchema } from '@localixai/agent/agents'
import { composeCapabilities } from '../../capabilities/resolve'
import { emptyLoadedPlugins } from '../../plugins/loader-contract'
import { emptyLoadedMiniApps } from '../../mini-apps/loader-contract'
import { routedAgent, sessionFixture } from '../../../testing/session-fixture'
import { createSessionSnapshotCache } from './session-snapshot'
import type { FrozenSessionContext } from './agent-runner-types'
import { prepareRunContext, type PromptContextDeps } from './prompt-context'

const dir = tempDirPerTest('localix-run-context-files-')

/**
 * A conversation reads the project's `CLAUDE.md` and rules as they are when it starts, as Claude
 * Code does: the scope's discovery cache, shared by every run until a capability changes, must
 * not hand a new conversation the files as an earlier one found them.
 */
test('a CLAUDE.md written after an earlier run in the scope reaches the next one', async () => {
  const cwd = dir()
  const deps = {
    claudeHome: cwd,
    projectsRepo: { getProject: async () => ({ workingDir: cwd, settings: null }) },
    pluginRepo: {},
    contextSnapshots: createSessionSnapshotCache<FrozenSessionContext>(),
    promptSnapshots: { get: async () => undefined, set: async () => {} },
    // A scope cache that keeps its first answer, as the real one does between capability changes.
    runScopes: { resolve: async () => [emptyLoadedPlugins(), emptyLoadedMiniApps()] },
    now: () => '2026-01-01T00:00:00Z',
  } as unknown as PromptContextDeps
  const agent = {
    approval: 'policy' as const,
    definition: agentDefinitionSchema.parse({
      id: 'native:project:worker',
      name: 'worker',
      description: '',
      instructions: 'Work.',
    }),
    capabilities: composeCapabilities([]),
  }
  const prepare = () =>
    prepareRunContext(deps, {
      userId: 'user',
      session: sessionFixture({
        projectId: 'project',
        agent: routedAgent({ agentId: agent.definition.id, name: 'worker' }),
      }),
      historyMessages: [],
      viewEpoch: '',
      globalAgentSettings: null,
      agentId: agent.definition.id,
      agent,
    })

  expect((await prepare()).contextFiles).toEqual([])
  await writeFile(join(cwd, 'CLAUDE.md'), 'Use tabs.')
  expect((await prepare()).contextFiles.map((file) => file.path)).toEqual([join(cwd, 'CLAUDE.md')])
})
