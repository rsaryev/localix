/**
 * A skill fork is a delegate child by another door, and must follow the same three
 * rules `delegate` itself enforces:
 *
 * 1. NEVER-WIDEN: a child session is created fresh, so a fork must not end up holding
 *    authority its parent did not have — the child's rules compose with the parent's
 *    scope rather than starting from a blank slate.
 * 2. cwd-SCOPED discovery: plugin-agent discovery is cwd-scoped, so a resolver call
 *    without the parent's working dir cannot see a project-local plugin's agents.
 * 3. NO silent downgrade: a NAMED role that does not resolve must fail loudly — the
 *    caller asked for that agent's prompt/tools/model and would otherwise attribute a
 *    general-purpose child's result to it.
 */
import { REASONING_EFFORTS, type ReasoningEffort } from '../../../db/types'
import { afterEach, describe, expect, it } from 'bun:test'

import { createSpawnForkSkill, type ForkSkillDeps } from './fork-skill'
import { setAgentService, type AgentServiceBinding } from '../runtime/agent-service-binding'
import type { SessionRecord } from '../repository'
import type { SessionLifecycleCtx } from './session-lifecycle'
import { routedParticipants, sessionFixture } from '../../../testing/session-fixture'
import { sessionRoute } from '../session-route'

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
    inviteAgents: async () => {},
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
    resolveWorkingDir: async () => '/repo/project',
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

const bindDelegate = (resolve: AgentServiceBinding['resolveSubagentType']) =>
  setAgentService({ resolveSubagentType: resolve } as unknown as AgentServiceBinding)

afterEach(() => {
  // Leave no stub behind for other test files sharing the module-level binding.
  setAgentService(null as unknown as AgentServiceBinding)
})

describe('spawnForkSkill — delegate-parity rules', () => {
  it('rejects subsessions before looking up settings or creating children', async () => {
    for (const parent of [
      parentSession({ parentSessionId: 'root' }),
      parentSession({ sessionKind: 'subagent' }),
      parentSession({ sessionKind: 'job' }),
    ]) {
      const fixture = makeDeps(parent)
      await expect(createSpawnForkSkill(fixture.deps)('u1', 'parent', 'work')).rejects.toThrow(
        'Only a root chat may delegate',
      )
      expect(fixture.getInserted()).toBeNull()
    }
  })

  it('a native assignee must join the parent before its fork can run', async () => {
    const fixture = makeDeps(parentSession())
    const invited: unknown[] = []
    fixture.deps.inviteAgents = async (...args) => {
      expect(fixture.getInserted()).toBeNull()
      invited.push(args)
      throw new Error('The roster is fixed')
    }
    setAgentService({ resolveAgentById: async () => ({ agentId: 'native:qa' }) } as never)
    await expect(
      createSpawnForkSkill(fixture.deps)('u1', 'parent', 'check', {
        agentId: 'native:qa',
      }),
    ).rejects.toThrow('The roster is fixed')
    expect(invited).toEqual([['u1', 'parent', ['native:qa']]])
    expect(fixture.getInserted()).toBeNull()
  })

  it('selects native identity through the exact-ID port and projects only native defaults', async () => {
    const agentId = 'native:global:fork-agent'
    const calls: unknown[] = []
    setAgentService({
      resolveAgentById: async (...args: unknown[]) => {
        calls.push(args)
        return {
          agentId,
          maxTurns: 13,
          pinnedSkills: ['native-skill'],
          prompt: 'Foreign instructions',
          tools: ['write'],
          hooks: { Stop: [] },
        }
      },
      resolveSubagentType: () => {
        throw new Error('Native IDs must not select an external role')
      },
    } as unknown as AgentServiceBinding)
    const { deps, getInserted, getRunPrompt, getRunOptions } = makeDeps(
      parentSession({ projectId: 'project' }),
    )
    deps.sessionLifecycleCtx.resolveSessionAgent = async (_userId, selection, projectId) => {
      expect(selection.agentId).toBe(agentId)
      expect(projectId).toBe('project')
      return { id: agentId, handle: 'fork-agent' }
    }
    await createSpawnForkSkill(deps)('u1', 'parent', 'Native task', { agentId })
    expect(calls).toEqual([[agentId, { projectId: 'project', cwd: '/repo/project' }]])
    expect(getInserted()?.agents.map((agent) => agent.agentId)).toEqual([agentId])
    expect(getInserted()?.pinnedSkills).toEqual(['native-skill'])
    expect(getRunPrompt()).toBe('Native task')
    expect(getRunOptions()?.maxTurns).toBe(13)
    expect(getRunOptions()?.profileOverride).toBeUndefined()
    expect(getRunOptions()?.ccScopedHooks).toBeUndefined()
  })

  it.each(['absent', 'unavailable', 'mismatched', 'error'])(
    'does not publish or run a native fork when resolution is %s',
    async (mode) => {
      let externalCalls = 0
      setAgentService({
        ...(mode === 'absent'
          ? {}
          : {
              resolveAgentById: async () => {
                if (mode === 'error') throw new Error('Resolver unavailable')
                return mode === 'mismatched' ? { agentId: 'another-agent' } : null
              },
            }),
        resolveSubagentType: () => {
          externalCalls++
          return { prompt: 'Fallback' }
        },
      } as unknown as AgentServiceBinding)
      const { deps, getInserted, getRunPrompt } = makeDeps(parentSession())
      await expect(
        createSpawnForkSkill(deps)('u1', 'parent', 'Task', {
          agentId: 'native:global:fork-agent',
        }),
      ).rejects.toThrow()
      expect(externalCalls).toBe(0)
      expect(getInserted()).toBeNull()
      expect(getRunPrompt()).toBeUndefined()
    },
  )

  it('rejects conflicting native and external selectors before resolution', async () => {
    let calls = 0
    setAgentService({
      resolveAgentById: async () => {
        calls++
        return null
      },
    } as unknown as AgentServiceBinding)
    const { deps, getInserted } = makeDeps(parentSession())
    await expect(
      createSpawnForkSkill(deps)('u1', 'parent', 'Task', {
        agentId: 'native:global:fork-agent',
        subagentType: 'plugin:reviewer',
      }),
    ).rejects.toThrow('agentId and subagentType')
    expect(calls).toBe(0)
    expect(getInserted()).toBeNull()
  })

  it('runs skill forks without authority to delegate another task', async () => {
    const { deps, getInserted, getRunOptions } = makeDeps(parentSession())
    await createSpawnForkSkill(deps)('u1', 'parent', 'do the thing')

    expect(getInserted()?.provenance).toEqual({
      kind: 'skill-fork',
      parentSessionId: 'parent',
      // WHICH participant delegated it: in a room the parent id alone cannot tell a member
      // its own children from a colleague's.
      parentParticipant: 'agent:builtin:localix',
    })
    expect(getRunOptions()?.executionContext).toEqual({
      invocation: { kind: 'skill-fork', parentSessionId: 'parent' },
      authority: { capabilities: [] },
    })
  })

  it.each(['sonnet', 'inherit', 'custom/model-v2'])(
    'forks with literal native model %s without reading the alias catalog',
    async (model) => {
      bindDelegate(() => ({
        agentId: 'builtin:backend',
        prompt: 'Review.',
        preferredModel: model,
      }))
      const { deps, getInserted, getCatalogReads } = makeDeps(parentSession())
      deps.buildLanguageModel = async () => ({
        providerConnectionId: 'live-native',
        providerId: 'native-provider',
        model: {} as never,
      })
      await createSpawnForkSkill(deps)('u1', 'parent', 'Review', { subagentType: 'backend' })
      expect(getInserted()?.agents[0]?.modelId).toBe(model)
      expect(getCatalogReads()).toBe(0)
    },
  )

  it.each([undefined, 'authored'])(
    'resolves native model with provider %s before persisting the fork route',
    async (providerId) => {
      bindDelegate(() => ({
        agentId: 'builtin:backend',
        prompt: 'Review.',
        preferredProvider: providerId,
        preferredModel: 'shared-model',
      }))
      const { deps, getInserted } = makeDeps(parentSession())
      const calls: unknown[] = []
      deps.buildLanguageModel = async (...args) => {
        calls.push(args)
        return { providerConnectionId: 'live-authored', providerId: 'authored', model: {} as never }
      }
      await createSpawnForkSkill(deps)('u1', 'parent', 'Review', { subagentType: 'backend' })
      expect(calls).toEqual([
        [
          'u1',
          'shared-model',
          sessionRoute(parentSession()).providerConnectionId,
          providerId ? { providerId } : undefined,
        ],
      ])
      expect(getInserted()?.agents[0]?.providerConnectionId).toBe('live-authored')
      expect(getInserted()?.agents[0]?.modelId).toBe('shared-model')
    },
  )

  it.each(
    ['provider', 'model'].flatMap((constraint) =>
      ['absent', 'rejected', 'error'].map((mode) => ({ constraint, mode })),
    ),
  )(
    'does not create a native fork when route resolution fails: %j',
    async ({ constraint, mode }) => {
      bindDelegate(() => ({
        agentId: 'builtin:backend',
        prompt: 'Review.',
        ...(constraint === 'provider'
          ? { preferredProvider: 'authored' }
          : { preferredModel: 'literal-model' }),
      }))
      const { deps, getInserted, getRunPrompt } = makeDeps(parentSession())
      if (mode !== 'absent')
        deps.buildLanguageModel = async () => {
          if (mode === 'error') throw new Error('resolver unavailable')
          return null
        }
      await expect(
        createSpawnForkSkill(deps)('u1', 'parent', 'Review', { subagentType: 'backend' }),
      ).rejects.toThrow()
      expect(getInserted()).toBeNull()
      expect(getRunPrompt()).toBeUndefined()
    },
  )

  it('persists native identity without copying its instructions into the task', async () => {
    bindDelegate(() => ({
      agentId: 'builtin:backend',
      prompt: 'Old instructions',
      tools: ['write'],
    }))
    const { deps, getInserted, getRunOptions, getRunPrompt } = makeDeps(parentSession())
    await createSpawnForkSkill(deps)('u1', 'parent', 'Review the patch', {
      subagentType: 'backend',
    })
    expect(getInserted()?.agents.map((agent) => agent.agentId)).toEqual(['builtin:backend'])
    expect(getRunPrompt()).toBe('Review the patch')
    expect(getRunOptions()?.profileOverride).toBeUndefined()
  })

  it('a role that names tools but no agent runs on exactly those tools', async () => {
    bindDelegate(() => ({ prompt: 'role prompt', tools: ['read', 'search'] }))
    const { deps, getRunOptions } = makeDeps(parentSession())
    await createSpawnForkSkill(deps)('u1', 'parent', 'task', { subagentType: 'sample:reader' })
    expect(getRunOptions()?.profileOverride?.declaredTools).toEqual(['read', 'search'])
  })

  it("the resolver gets the parent's cwd — project-local plugin agents are cwd-scoped", async () => {
    const seen: unknown[] = []
    bindDelegate(async (name, ctx) => {
      seen.push([name, ctx])
      return { prompt: 'role prompt' }
    })
    const { deps, getInserted } = makeDeps(parentSession())
    await createSpawnForkSkill(deps)('u1', 'parent', 'task', { subagentType: 'sample:reviewer' })
    expect(seen).toEqual([['sample:reviewer', { projectId: 'PRJ-fixture', cwd: '/repo/project' }]])
    expect(getInserted()?.provenance).toEqual({
      kind: 'skill-fork',
      parentSessionId: 'parent',
      // WHICH participant delegated it: in a room the parent id alone cannot tell a member
      // its own children from a colleague's.
      parentParticipant: 'agent:builtin:localix',
    })
  })

  it('an unresolved NAMED role throws instead of silently running general-purpose', () => {
    bindDelegate(async () => null)
    const { deps, getInserted } = makeDeps(parentSession())
    expect(
      createSpawnForkSkill(deps)('u1', 'parent', 'task', { subagentType: 'ghost:agent' }),
    ).rejects.toThrow('Unknown subagent_type "ghost:agent"')
    expect(getInserted()).toBeNull() // no orphaned child session
  })

  it('`general-purpose` is not a role: no resolver call, fork proceeds', async () => {
    let called = false
    bindDelegate(async () => {
      called = true
      return null
    })
    const { deps, getInserted } = makeDeps(parentSession())
    await createSpawnForkSkill(deps)('u1', 'parent', 'task', { subagentType: 'general-purpose' })
    expect(called).toBe(false)
    expect(getInserted()).not.toBeNull()
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

  it("the ROLE's declared effort applies when the skill declares none", async () => {
    // Precedence: skill > role > inherit. The role's declaration is the standing one for that
    // agent; the skill's is the specific one for this task.
    bindDelegate(() => ({ prompt: 'ROLE', preferredEffort: 'high' }))
    const { deps, getInserted } = makeDeps(
      parentSession({ agents: routedParticipants({ modelId: 'm', reasoningEffort: 'low' }) }),
    )
    await createSpawnForkSkill(deps)('u1', 'parent', 'do it', { subagentType: 'plug:reviewer' })
    expect(childEffort(getInserted())).toBe('high')
  })

  it("the SKILL's own declaration outranks the role's", async () => {
    bindDelegate(() => ({ prompt: 'ROLE', preferredEffort: 'high' }))
    const { deps, getInserted } = makeDeps(
      parentSession({ agents: routedParticipants({ modelId: 'm', reasoningEffort: 'low' }) }),
    )
    await createSpawnForkSkill(deps)('u1', 'parent', 'do it', {
      subagentType: 'plug:reviewer',
      preferredEffort: 'minimal',
    })
    expect(childEffort(getInserted())).toBe('minimal')
  })

  it("a role's typo falls through to inherit, not to the lowest level", async () => {
    bindDelegate(() => ({ prompt: 'ROLE', preferredEffort: 'hgih' }))
    const { deps, getInserted } = makeDeps(
      parentSession({ agents: routedParticipants({ modelId: 'm', reasoningEffort: 'medium' }) }),
    )
    await createSpawnForkSkill(deps)('u1', 'parent', 'do it', { subagentType: 'plug:reviewer' })
    expect(childEffort(getInserted())).toBe('medium')
  })

  it("a role's model applies too — never one half of a declaration", async () => {
    // The asymmetry this closes: the role's EFFORT was applied while its MODEL
    // was ignored, so `model: <x>` + `effort: max` ran the parent's (expensive) model at max —
    // the cost-limiting half dropped, the cost-raising half honoured.
    //
    // A CONCRETE model id, not a family alias: without a catalog `resolveModelAlias` cannot
    // resolve `haiku`/`sonnet` and correctly falls back to the parent model, so an alias here
    // would test the alias resolver rather than this precedence.
    bindDelegate(() => ({
      prompt: 'ROLE',
      preferredModel: 'anthropic/claude-haiku-4-5',
      preferredEffort: 'max',
    }))
    const { deps, getInserted } = makeDeps(
      parentSession({
        agents: routedParticipants({
          modelId: 'anthropic/claude-opus-4-8',
          reasoningEffort: 'low',
        }),
      }),
    )
    await createSpawnForkSkill(deps)('u1', 'parent', 'do it', { subagentType: 'plug:reviewer' })
    expect(childEffort(getInserted())).toBe('max')
    expect(childModel(getInserted())).toBe('anthropic/claude-haiku-4-5')
  })

  it('a family ALIAS resolves to a concrete catalog id, not the parent model', async () => {
    // The half-hollow part a review measured: `resolveModelAlias` needs the catalog to turn
    // `sonnet` into an id, and this path passed none — so it fell back to the parent model and the
    // declaration did nothing. `model: sonnet` is the form the CC convention and this repo's own
    // skills doc teach, so the documented spelling was the broken one.
    bindDelegate(() => ({ prompt: 'ROLE', preferredModel: 'haiku' }))
    const { deps, getInserted, getCatalogReads } = makeDeps(
      parentSession({ agents: routedParticipants({ modelId: 'anthropic/claude-opus-4-8' }) }),
    )
    await createSpawnForkSkill(deps)('u1', 'parent', 'do it', { subagentType: 'plug:reviewer' })
    expect(childModel(getInserted())).toBe('anthropic/claude-haiku-4-5')
    expect(getCatalogReads()).toBe(1)
  })

  it('no declaration and a concrete id both skip the catalog read', async () => {
    // The read is only needed to resolve an alias; paying for it on every fork would be a tax on
    // the common case.
    bindDelegate(() => ({ prompt: 'ROLE' }))
    const bare = makeDeps(
      parentSession({ agents: routedParticipants({ modelId: 'anthropic/claude-opus-4-8' }) }),
    )
    await createSpawnForkSkill(bare.deps)('u1', 'parent', 'do it', {
      subagentType: 'plug:reviewer',
    })
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

  it("the SKILL's own model still outranks the role's", async () => {
    bindDelegate(() => ({ prompt: 'ROLE', preferredModel: 'anthropic/claude-haiku-4-5' }))
    const { deps, getInserted } = makeDeps(
      parentSession({ agents: routedParticipants({ modelId: 'anthropic/claude-opus-4-8' }) }),
    )
    await createSpawnForkSkill(deps)('u1', 'parent', 'do it', {
      subagentType: 'plug:reviewer',
      preferredModel: 'anthropic/claude-sonnet-5',
    })
    expect(childModel(getInserted())).toBe('anthropic/claude-sonnet-5')
  })

  it('no declaration at all inherits, as before', async () => {
    expect(childEffort(await fork(undefined, 'medium'))).toBe('medium')
  })
})
