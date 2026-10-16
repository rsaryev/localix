import { agentRoute, sessionRoute } from '../session-route'
import { agentParticipant } from '../../../db'
import { randomUUID } from 'node:crypto'

import { isModelAliasFamily, resolveModelAlias } from '../../agent-core/model-alias'
import { isDelegationParent } from '../../agent-core/delegation-policy'
import { GENERAL_PURPOSE_AGENT } from '../../ext/cc-agent-selection'
import { resolveDeclaredReasoningEffort } from '../../../db/types'
import { childExecutionContext } from '../runtime/execution-context'
import type { createChatRepository, SessionRecord } from '../repository'
import * as sessionLifecycle from './session-lifecycle'
import type { SessionLifecycleCtx } from './session-lifecycle-contracts'
import type { RunAgentFn } from './run-agent'

export interface ForkSkillDeps {
  repo: ReturnType<typeof createChatRepository>
  now: () => string
  requireSession: (userId: string, id: string) => Promise<SessionRecord>
  runAgent: RunAgentFn
  sessionLifecycleCtx: SessionLifecycleCtx
  /**
   * Catalog model ids, for resolving a declared `model:` FAMILY ALIAS (`sonnet`/`opus`/`haiku`/
   * `fable`) to a concrete id. Without them `resolveModelAlias` falls back to the parent model, so
   * the alias form — the one the CC convention and this repo's own docs teach — silently did
   * nothing. Read only when an alias actually needs resolving.
   */
  listModelIds?: () => Promise<readonly string[]>
}

export type SpawnForkSkillFn = (
  userId: string,
  parentSessionId: string,
  prompt: string,
  opts?: {
    title?: string
    preferredModel?: string
    preferredEffort?: string
    /** CC skill frontmatter `hooks` — activated for the forked child run (Stop→SubagentStop). */
    hooks?: unknown
    /**
     * The participant the fork is for — and the agent that runs it: its route is inherited and
     * its report comes back to it. Absent means the conversation's first participant — the
     * direct-chat case.
     */
    invokedBy?: string
  },
) => Promise<string>

/**
 * Run a skill task in its own child session, as the INVOKING agent itself. The child shares the
 * parent's workspace. A skill's `agent:` frontmatter is not honoured any more: no path starts a
 * different agent on a skill's or a model's behalf (the caller warns when a skill declares one).
 * The factory closes over the required service ports instead of the full chat service.
 */
export function createSpawnForkSkill(deps: ForkSkillDeps): SpawnForkSkillFn {
  const { now, requireSession, runAgent, sessionLifecycleCtx } = deps

  return async (userId, parentId, prompt, opts) => {
    const parentSession = await requireSession(userId, parentId)
    if (!isDelegationParent(parentSession)) {
      throw new Error('Only a root chat may fork. Subsessions cannot create child work.')
    }
    // The participant who asked for the fork, not whoever joined first: it is that agent the
    // child runs, its model the child inherits and its report the child owes.
    const parentRoute =
      (opts?.invokedBy ? agentRoute(parentSession, opts.invokedBy) : undefined) ??
      sessionRoute(parentSession)
    // Map a declared CC effort string to a level this system can actually carry: an unknown
    // value means "not specified" and inherits — see `resolveDeclaredReasoningEffort`.
    const effort = resolveDeclaredReasoningEffort(opts?.preferredEffort)
    // A family alias needs the catalog to become a concrete id; nothing else does, so the read is
    // skipped for the common cases (no declaration, or an already-qualified id).
    const declaredModel = opts?.preferredModel
    const modelIds =
      declaredModel && isModelAliasFamily(declaredModel) ? await deps.listModelIds?.() : undefined
    const modelId =
      resolveModelAlias(declaredModel, parentRoute.modelId ?? undefined, modelIds) ?? undefined
    const providerConnectionId = parentRoute.providerConnectionId
    const childAgentId = parentRoute.agentId
    const child = await sessionLifecycle.createSession(sessionLifecycleCtx, userId, {
      agents: [{ agentId: childAgentId }],
      title: opts?.title ?? 'Forked skill',
      parentSessionId: parentId,
      sessionKind: 'job',
      sourceToolCallId: `skill-fork:${parentId}:${randomUUID()}`,
      provenance: {
        kind: 'skill-fork',
        parentSessionId: parentId,
        // WHICH member forked it. A child session has one parent participant; callers that
        // dispatch from a multi-participant conversation must supply that address explicitly.
        ...(parentSession.agents?.length
          ? { parentParticipant: agentParticipant(parentRoute.agentId) }
          : {}),
      },
      providerConnectionId,
      // A fork is created fresh, so it must not end up holding authority its parent did not have.
      modelId,
      // Apply skill's preferred reasoning effort when declared.
      ...(effort ? { reasoningEffort: effort } : {}),
      projectId: parentSession.projectId,
    })
    const childRecord = await requireSession(userId, child.id)
    const runOpts: Parameters<RunAgentFn>[7] = {
      executionContext: childExecutionContext({ kind: 'skill-fork', parentSessionId: parentId }),
      // CC: a forked skill runs as a sub-agent, so its `Stop` hooks convert to
      // `SubagentStop` (fired on the child's own completion).
      ...(opts?.hooks
        ? {
            ccScopedHooks: [
              {
                raw: opts.hooks,
                source: 'skill' as const,
                asSubagent: true,
                agentType: GENERAL_PURPOSE_AGENT,
              },
            ],
          }
        : {}),
    }
    void runAgent(
      userId,
      child.id,
      childRecord,
      // The child was created immediately above and cannot have history yet.
      [],
      prompt,
      now(),
      undefined,
      Object.keys(runOpts).length ? runOpts : undefined,
    ).catch((err: unknown) =>
      console.warn('[skill-fork] run failed:', err instanceof Error ? err.message : err),
    )
    return child.id
  }
}
