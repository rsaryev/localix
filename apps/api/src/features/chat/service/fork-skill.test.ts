/**
 * A skill fork (`context: fork`) is child work by another door, and follows the rules a `fork`
 * does: only a root chat creates one, and it runs the INVOKING agent itself — no path starts a
 * different agent on a skill's behalf, so `agent:` frontmatter no longer selects one.
 */
import type { ReasoningEffort } from '../../../db/types'
import { describe, expect, it } from 'bun:test'

import { createSpawnForkSkill, type ForkSkillDeps } from './fork-skill'
import type { AgentRoute } from '../../agent-core/agent-model-route'
import type { SessionRecord } from '../repository'
import type { SessionLifecycleCtx } from './session-lifecycle'
import { routedAgent, sessionFixture } from '../../../testing/session-fixture'
import { sessionRoute } from '../../../contracts/session-route'

/** The effort a forked child ended up on — it lives on the child's agent. */
const childEffort = (child: SessionRecord | undefined | null) =>
  child ? sessionRoute(child).reasoningEffort : undefined

/** The model a forked child ended up on — it lives on the child's agent too. */
const childModel = (child: SessionRecord | undefined | null) =>
  child ? sessionRoute(child).modelId : undefined

function parentSession(over: Partial<SessionRecord> = {}): SessionRecord {
  return sessionFixture({
    id: 'parent',
    userId: 'u1',
    seq: 1,
    title: 'Chat',
    agent: routedAgent({ modelId: 'm', reasoningEffort: 'low' }),
    createdAt: '2026-01-01 00:00:00',
    updatedAt: '2026-01-01 00:00:00',
    lastMessageAt: '2026-01-01 00:00:00',
    rootSessionId: 'parent',
    ...over,
  })
}

function makeDeps(parent: SessionRecord) {
  let inserted: SessionRecord | null = null
  let runPrompt: string | undefined
  let runOptions: Parameters<ForkSkillDeps['runAgent']>[7]
  const sessionLifecycleCtx = {
    // The registry a host resolves non-shipped agents from: here, any native ID by its handle.
    resolveSessionAgent: async (_userId: string, selection: { agentId?: string }) =>
      selection.agentId?.startsWith('native:')
        ? { id: selection.agentId, name: selection.agentId.split(':').pop()! }
        : selection.agentId === 'builtin:localix'
          ? { id: 'builtin:localix', name: 'localix' }
          : null,
    repo: {
      listSessions: async () => [],
      allocateSessionRef: async () => ({ seq: 2, id: 'child' }),
      insertSession: async (s: SessionRecord) => {
        inserted = s
      },
      updateSession: async () => {},
      deleteSession: async () => {},
      listChildSessionIds: async () => [],
    },
    streamRegistry: { publish: () => {} },
    runner: {
      withSessionsQuiesced: async <T>(_ids: readonly string[], operation: () => Promise<T>) =>
        operation(),
      stop: async () => true,
      forgetSession: () => {},
    },
    now: () => '2026-02-02 12:00:00',
    requireSession: async () => parent,
    getSessionDetail: async () => ({}) as never,
    publishSession: () => {},
  } as unknown as SessionLifecycleCtx

  const deps: ForkSkillDeps = {
    now: () => '2026-02-02 12:00:00',
    requireSession: async (_u, id) => (id === 'parent' ? parent : (inserted ?? parent)),
    runAgent: (async (...args: Parameters<ForkSkillDeps['runAgent']>) => {
      runPrompt = args[4]
      runOptions = args[7]
    }) as unknown as ForkSkillDeps['runAgent'],
    sessionLifecycleCtx,
  }
  return {
    deps,
    getInserted: () => inserted as SessionRecord | null,
    getRunOptions: () => runOptions,
    getRunPrompt: () => runPrompt,
  }
}

describe('spawnForkSkill — a fork of the invoking agent', () => {
  it('rejects subsessions before creating children', async () => {
    for (const parent of [
      parentSession({ parentSessionId: 'root' }),
      parentSession({ sessionKind: 'subagent' }),
      parentSession({ sessionKind: 'job' }),
    ]) {
      const fixture = makeDeps(parent)
      await expect(createSpawnForkSkill(fixture.deps)('u1', 'parent', 'work')).rejects.toThrow(
        'Only a root chat may fork',
      )
      expect(fixture.getInserted()).toBeNull()
    }
  })

  it('runs the conversation agent itself, without authority to create more child work', async () => {
    const { deps, getInserted, getRunOptions, getRunPrompt } = makeDeps(parentSession())
    await createSpawnForkSkill(deps)('u1', 'parent', 'do the thing')

    expect(getInserted()?.agent?.agentId).toBe('builtin:localix')
    expect(getInserted()?.provenance).toEqual({
      kind: 'skill-fork',
      parentSessionId: 'parent',
    })
    expect(getRunPrompt()).toBe('do the thing')
    expect(getRunOptions()?.executionContext).toEqual({
      invocation: { kind: 'skill-fork', parentSessionId: 'parent' },
      authority: { capabilities: [] },
    })
  })

  it("a plugin skill's hooks run in the child with that plugin's root and data dir", async () => {
    const { deps, getRunOptions } = makeDeps(parentSession())
    const hooks = { Stop: [{ hooks: [{ type: 'command', command: 'x' }] }] }
    const plugin = { name: 'kit', root: '/plugins/kit', dataDir: '/data/kit' }
    await createSpawnForkSkill(deps)('u1', 'parent', 'work', { hooks, hooksPlugin: plugin })
    expect(getRunOptions()?.ccScopedHooks).toEqual([
      { raw: hooks, source: 'skill', asSubagent: true, agentType: 'general-purpose', plugin },
    ])
  })
})

describe('the model and effort of a skill fork follow the rule of every subagent', () => {
  const fork = async (chosen: AgentRoute | undefined, parentEffort: ReasoningEffort = 'low') => {
    const { deps, getInserted } = makeDeps(
      parentSession({
        agent: routedAgent({ modelId: 'anthropic/claude-opus-4-8', reasoningEffort: parentEffort }),
      }),
    )
    // The skill's own `model` and `effort` ride in as ignored options.
    await createSpawnForkSkill({ ...deps, chosenRoute: async () => chosen ?? {} })(
      'u1',
      'parent',
      'do it',
      { preferredModel: 'haiku', preferredEffort: 'max' } as never,
    )
    return getInserted()
  }

  it('without a choice of the person it runs on its parent’s model and effort', async () => {
    const child = await fork(undefined, 'medium')
    expect(childModel(child)).toBe('anthropic/claude-opus-4-8')
    expect(childEffort(child)).toBe('medium')
  })

  it('the person’s choice for the agent is its model and effort', async () => {
    const child = await fork({ modelId: 'openai/gpt-5.6-sol', reasoningEffort: 'xhigh' })
    expect(childModel(child)).toBe('openai/gpt-5.6-sol')
    expect(childEffort(child)).toBe('xhigh')
  })
})
