import { sessionRoute } from '../../../contracts/session-route'
import { randomUUID } from 'node:crypto'

import type { AgentRoute } from '../../agent-core/agent-model-route'
import { isDelegationParent } from '../../agent-core/delegation-policy'
import { GENERAL_PURPOSE_TYPE } from '../../agent-core/tools/agent/agent-type'
import { awaitAgentService } from '../runtime/agent-service-binding'
import { childExecutionContext } from '../runtime/execution-context'
import type { SessionRecord } from '../repository'
import * as sessionLifecycle from './session-lifecycle'
import type { SessionLifecycleCtx } from './session-lifecycle-contracts'
import type { RunAgentFn } from './run-agent'
import type { ScopedCcHooks } from '../runtime/run-contract'

export interface ForkSkillDeps {
  now: () => string
  requireSession: (userId: string, id: string) => Promise<SessionRecord>
  runAgent: RunAgentFn
  sessionLifecycleCtx: SessionLifecycleCtx
  /**
   * The model and effort the person chose for an agent (`agentSettings.agentModelChoices`). The
   * fork runs on it, else on its parent's route: the skill's own `model` and `effort` are not read.
   */
  chosenRoute?: (userId: string, agentId: string) => Promise<AgentRoute>
}

export type SpawnForkSkillFn = (
  userId: string,
  parentSessionId: string,
  prompt: string,
  opts?: {
    title?: string
    /** CC skill frontmatter `hooks` — activated for the forked child run (Stop→SubagentStop). */
    hooks?: unknown
    /** The plugin shipping the skill: its `hooks` get that plugin's root and data dir. */
    hooksPlugin?: ScopedCcHooks['plugin']
    /**
     * CC `agent:` — the agent the fork runs as. A catalog agent (a file, a plugin's, `Explore`) is
     * used by the child and runs on its own definition; `general-purpose` or none is the
     * invoking agent itself.
     */
    agent?: string
  },
) => Promise<string>

/**
 * Run a skill task in its own child session, started as the INVOKING agent unless the skill's
 * `agent:` names another: that agent is used bystead and every run takes its prompt, tool limits
 * and model — Claude Code: "The `agent` field determines the execution environment". The child
 * shares the parent's workspace. The factory closes over the required service ports instead of the
 * full chat service.
 */
export function createSpawnForkSkill(deps: ForkSkillDeps): SpawnForkSkillFn {
  const { now, requireSession, runAgent, sessionLifecycleCtx } = deps

  return async (userId, parentId, prompt, opts) => {
    const parentSession = await requireSession(userId, parentId)
    if (!isDelegationParent(parentSession)) {
      throw new Error('Only a root chat may fork. Subsessions cannot create child work.')
    }
    // The session's agent asked for the fork: it is that agent the child runs, its model the
    // child inherits and its report the child owes.
    const parentRoute = sessionRoute(parentSession)
    const named = opts?.agent
      ? await (
          await awaitAgentService()
        )?.resolveDelegation?.(opts.agent, {
          projectId: parentSession.projectId ?? undefined,
        })
      : undefined
    if (named && (named.kind === 'ambiguous' || named.kind === 'unavailable'))
      throw new Error(
        named.kind === 'ambiguous'
          ? `The skill's agent "${opts?.agent}" names several agents: ${named.names.join(', ')}.`
          : `The skill's agent "${opts?.agent}" is not an enabled agent here.`,
      )
    const childAgentId = named?.kind === 'agent' ? named.agent.agentId : parentRoute.agentId
    // The person's choice for the agent, else the parent's route: the same rule as `Agent`.
    const chosen = (await deps.chosenRoute?.(userId, childAgentId)) ?? {}
    const modelId = chosen.modelId ?? parentRoute.modelId ?? undefined
    const providerConnectionId = chosen.modelId
      ? (chosen.providerConnectionId ?? null)
      : parentRoute.providerConnectionId
    const effort = chosen.reasoningEffort
    const child = await sessionLifecycle.createSession(sessionLifecycleCtx, userId, {
      agent: { agentId: childAgentId },
      title: opts?.title ?? 'Forked skill',
      parentSessionId: parentId,
      sessionKind: 'job',
      sourceToolCallId: `skill-fork:${parentId}:${randomUUID()}`,
      provenance: {
        kind: 'skill-fork',
        parentSessionId: parentId,
      },
      providerConnectionId,
      // A fork is created fresh, so it must not end up holding authority its parent did not have.
      modelId,
      // The person's effort for the agent when they chose one; else the parent's, at birth.
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
                agentType: named?.kind === 'agent' ? named.agent.name : GENERAL_PURPOSE_TYPE,
                ...(opts.hooksPlugin ? { plugin: opts.hooksPlugin } : {}),
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
