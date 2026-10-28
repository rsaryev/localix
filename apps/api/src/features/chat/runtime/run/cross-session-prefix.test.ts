import { describe, expect, test } from 'bun:test'
import { describeFixedContext } from '@localixai/agent/agents'

import { runPolicyFixture } from '../../../../testing/run-policy-fixture'
import { sessionFixture } from '../../../../testing/session-fixture'
import { resolveRunProfile } from '../../../agent-core/run-shape'
import { createRuntimeToolRegistry } from '../../../agent-core/tool-registry'
import { emptyLoadedMiniApps } from '../../../mini-apps/loader-contract'
import type { LoadedPlugins } from '../../../plugins/loader'
import type { SessionRecord } from '../../repository'
import { buildRunSystemPrompt } from './system-prompt-build'

/**
 * The stable part of a request (the tools, then the system prompt) is what a provider's prompt
 * cache reads first. Two NEW sessions of one agent, model and project must send it byte for byte,
 * so the second one starts on a cache the first one wrote: whatever belongs to one session (its
 * id, its scratch folder, the children it runs, the jobs it started) rides the tail, not here.
 */
const agentProfile = resolveRunProfile({ sessionKind: 'chat' })

async function firstRequestOf(session: SessionRecord, volatile: { scratchDir: string }) {
  const runtimeTools = createRuntimeToolRegistry({ policy: { agentProfile } })
  const answeringAgent = session.agent!.agentId
  const built = await buildRunSystemPrompt({
    userId: session.userId,
    session,
    agentId: answeringAgent,
    policy: runPolicyFixture(session),
    providerId: 'openai',
    agentProfile,
    runtimeTools,
    loadedPlugins: { loaded: [], agents: [], outputStyles: [] } as unknown as LoadedPlugins,
    loadedMiniApps: emptyLoadedMiniApps(),
    frozenContext: {},
    pinnedSkills: [],
    triggeredSkills: [],
    contextFiles: [],
    defaultCwd: '/work/project',
    childRuntimeSessions: new Map(),
    now: () => '2026-10-08',
    webhookUrl: undefined,
    ...volatile,
  } as never)
  return { built, fixed: describeFixedContext(built.systemPrompt, runtimeTools.tools) }
}

describe('the first request of two new sessions of one agent, model and project', () => {
  test('carries the same tools and the same system prompt', async () => {
    const a = await firstRequestOf(
      sessionFixture({ id: 'LOCALIX-1', title: 'Fix the parser', goal: 'Fix the parser bug.' }),
      {
        scratchDir: '/home/u/.localix/tmp/sessions/LOCALIX-1',
      },
    )
    const b = await firstRequestOf(
      sessionFixture({ id: 'LOCALIX-2', title: 'Write release notes', goal: 'Write the notes.' }),
      {
        scratchDir: '/home/u/.localix/tmp/sessions/LOCALIX-2',
      },
    )
    expect(b.built.systemPrompt).toBe(a.built.systemPrompt)
    expect(b.fixed.toolSchemaHash).toBe(a.fixed.toolSchemaHash)
    expect(b.fixed.systemPromptHash).toBe(a.fixed.systemPromptHash)
    // What is one session's own is in the tail, where it costs the next session nothing.
    const tail = (r: typeof a) => r.built.runtimeSections.map((section) => section.text).join('\n')
    expect(tail(a)).toContain('LOCALIX-1')
    expect(a.built.systemPrompt).not.toContain('LOCALIX-1')
    expect(a.built.systemPrompt).not.toContain('sessions/LOCALIX')
  })
})
