/**
 * A skill fork (`context: fork`) is child work by another door, and follows the rules a `fork`
 * does: only a root chat creates one, and it runs the INVOKING agent itself — no path starts a
 * different agent on a skill's behalf, so `agent:` frontmatter no longer selects one.
 */
import { REASONING_EFFORTS, type ReasoningEffort } from '../../../db/types'
import { describe, expect, it } from 'bun:test'

import { createSpawnForkSkill, type ForkSkillDeps } from './fork-skill'
import type { SessionRecord } from '../repository'
import type { SessionLifecycleCtx } from './session-lifecycle'
import { routedParticipants, sessionFixture } from '../../../testing/session-fixture'
import { sessionRoute } from '../../../contracts/session-route'

/** The effort a forked child ended up on — it lives on the child's participant. */
const childEffort = (child: SessionRecord | undefined | null) =>
  child ? sessionRoute(child).reasoningEffort : undefined

/** The model a forked child ended up on — it lives on the child's participant too. */
const childModel = (child: SessionRecord | undefined | null) =>
  child ? sessionRoute(child).modelId : undefined

function parentSession(over: Partial<SessionRecord> = {}): SessionRecord {
  return sessionFixture({
    id: 'parent',
    userId: 'u1',
    seq: 1,
    title: 'Chat',
    agents: routedParticipants({ modelId: 'm', reasoningEffort: 'low' }),
    createdAt: '2026-01-01 00:00:00',
    updatedAt: '2026-01-01 00:00:00',
    lastMessageAt: '2026-01-01 00:00:00',
    rootSessionId: 'parent',
    ...over,
  })
}

function makeDeps(parent: SessionRecord) {
  let inserted: SessionRecord | null = null
  let catalogReads = 0
  let runPrompt: string | undefined
  let runOptions: Parameters<ForkSkillDeps['runAgent']>[7]
  const sessionLifecycleCtx = {
    // The registry a host resolves non-shipped agents from: here, any native ID by its handle.
    resolveSessionAgent: async (_userId: string, selection: { agentId?: string }) =>
      selection.agentId?.startsWith('native:')
        ? { id: selection.agentId, handle: selection.agentId.split(':').pop()! }
        : selection.agentId === 'builtin:localix'
          ? { id: 'builtin:localix', handle: 'localix' }
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
    repo: {
      listMessages: async () => {
        throw new Error('a fresh fork child cannot have history to hydrate')
      },
    } as unknown as ForkSkillDeps['repo'],
    now: () => '2026-02-02 12:00:00',
    requireSession: async (_u, id) => (id === 'parent' ? parent : (inserted ?? parent)),
    runAgent: (async (...args: Parameters<ForkSkillDeps['runAgent']>) => {
      runPrompt = args[4]
      runOptions = args[7]
    }) as unknown as ForkSkillDeps['runAgent'],
    sessionLifecycleCtx,
    listModelIds: async () => {
      catalogReads += 1
      return ['anthropic/claude-sonnet-5', 'anthropic/claude-haiku-4-5', 'openai/gpt-5.6-sol']
    },
  }
  return {
    deps,
    getInserted: () => inserted as SessionRecord | null,
    getRunOptions: () => runOptions,
    getRunPrompt: () => runPrompt,
    getCatalogReads: () => catalogReads,
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

    expect(getInserted()?.agents.map((agent) => agent.agentId)).toEqual(['builtin:localix'])
    expect(getInserted()?.provenance).toEqual({
      kind: 'skill-fork',
      parentSessionId: 'parent',
      parentParticipant: 'agent:builtin:localix',
    })
    expect(getRunPrompt()).toBe('do the thing')
    expect(getRunOptions()?.executionContext).toEqual({
      invocation: { kind: 'skill-fork', parentSessionId: 'parent' },
      authority: { capabilities: [] },
    })
  })

  it('in a room, the fork is the participant who invoked the skill, on its own route', async () => {
    const [lead] = routedParticipants({ modelId: 'lead-model' })
    const qa = {
      ...lead,
      agentId: 'native:global:qa',
      handle: 'qa',
      modelId: 'qa-model',
      providerConnectionId: 'qa-connection',
    }
    const { deps, getInserted } = makeDeps(parentSession({ agents: [lead, qa] }))
    await createSpawnForkSkill(deps)('u1', 'parent', 'check it', { invokedBy: 'native:global:qa' })
    expect(getInserted()?.agents.map((agent) => agent.agentId)).toEqual(['native:global:qa'])
    expect(childModel(getInserted())).toBe('qa-model')
    expect(getInserted()?.agents[0]?.providerConnectionId).toBe('qa-connection')
    expect(getInserted()?.provenance).toMatchObject({ parentParticipant: 'agent:native:global:qa' })
  })
})

describe('a declared effort must take effect or be ignored — never mean something else', () => {
  // Driven through the REAL fork path and asserted on the session that gets inserted, because
  // the defect lived at the call site, not in the resolver: `fork-skill.ts` cast the frontmatter
  // string straight into ReasoningEffort behind a comment promising "unknown values →
  // undefined". The column is plain text with no constraint, so a typo was persisted verbatim
  // and then handed to the provider, where an unrecognized level becomes something
  // PROVIDER-DEPENDENT for the whole forked session: the lowest supported level on the OpenAI
  // family, `high` on adaptive Claude, a 400 on the legacy Anthropic budget path.
  const fork = (preferredEffort: string | undefined, parentEffort: ReasoningEffort = 'low') => {
    const { deps, getInserted } = makeDeps(
      parentSession({
        agents: routedParticipants({ modelId: 'm', reasoningEffort: parentEffort }),
      }),
    )
    const options = preferredEffort === undefined ? undefined : { preferredEffort }
    return createSpawnForkSkill(deps)('u1', 'parent', 'do it', options).then(() => getInserted())
  }

  it('a typo inherits the parent effort instead of becoming a level', async () => {
    expect(childEffort(await fork('hgih', 'high'))).toBe('high')
    expect(childEffort(await fork('banana', 'medium'))).toBe('medium')
  })

  it('a declared level the system carries is applied verbatim', async () => {
    for (const value of REASONING_EFFORTS) {
      const child = await fork(value, 'low')
      expect({ value, applied: childEffort(child) }).toEqual({ value, applied: value })
    }
  })

  it("pi's native xhigh now applies as authored, not one rung up", async () => {
    // It used to normalize to `max`, which is a HIGHER level on the models that have native
    // xhigh (Opus 4.7/4.8, Sonnet 5, Fable 5) — so an author who wrote the right value paid for
    // more thinking than they asked for.
    expect(childEffort(await fork('xhigh', 'low'))).toBe('xhigh')
  })

  it('a family ALIAS resolves to a concrete catalog id, not the parent model', async () => {
    // The half-hollow part a review measured: `resolveModelAlias` needs the catalog to turn
    // `sonnet` into an id, and this path passed none — so it fell back to the parent model and the
    // declaration did nothing. `model: sonnet` is the form the CC convention and this repo's own
    // skills doc teach, so the documented spelling was the broken one.
    const { deps, getInserted, getCatalogReads } = makeDeps(
      parentSession({ agents: routedParticipants({ modelId: 'anthropic/claude-opus-4-8' }) }),
    )
    await createSpawnForkSkill(deps)('u1', 'parent', 'do it', { preferredModel: 'haiku' })
    expect(childModel(getInserted())).toBe('anthropic/claude-haiku-4-5')
    expect(getCatalogReads()).toBe(1)
  })

  it('no declaration and a concrete id both skip the catalog read', async () => {
    // The read is only needed to resolve an alias; paying for it on every fork would be a tax on
    // the common case.
    const bare = makeDeps(
      parentSession({ agents: routedParticipants({ modelId: 'anthropic/claude-opus-4-8' }) }),
    )
    await createSpawnForkSkill(bare.deps)('u1', 'parent', 'do it')
    expect(bare.getCatalogReads()).toBe(0)

    const concrete = makeDeps(
      parentSession({ agents: routedParticipants({ modelId: 'anthropic/claude-opus-4-8' }) }),
    )
    await createSpawnForkSkill(concrete.deps)('u1', 'parent', 'do it', {
      preferredModel: 'openai/gpt-5.6-sol',
    })
    expect(childModel(concrete.getInserted())).toBe('openai/gpt-5.6-sol')
    expect(concrete.getCatalogReads()).toBe(0)
  })

  it('no declaration at all inherits, as before', async () => {
    expect(childEffort(await fork(undefined, 'medium'))).toBe('medium')
  })
})
