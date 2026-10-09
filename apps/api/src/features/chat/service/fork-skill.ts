import { agentRoute, sessionRoute } from '../session-route'
import { agentParticipant } from '../../../db'
import { randomUUID } from 'node:crypto'
import { DEFAULT_AGENT_ID } from '@localixai/agent/agents'

import { isModelAliasFamily, resolveModelAlias } from '../../agent-core/model-alias'
import { resolveDelegateSelection } from '../../agent-core/tools/delegate-selection'
import { resolveRunProfile } from '../../agent-core/run-shape'
import { isDelegationParent } from '../../agent-core/delegation-policy'
import { GENERAL_PURPOSE_AGENT, roleNameOfSubagentType } from '../../ext/cc-agent-selection'
import { resolveDeclaredReasoningEffort } from '../../../db/types'
import { childExecutionContext } from '../runtime/execution-context'
import { getAgentService } from '../runtime/agent-service-binding'
import type { createChatRepository, SessionRecord } from '../repository'
import * as sessionLifecycle from './session-lifecycle'
import type { SessionLifecycleCtx } from './session-lifecycle-contracts'
import type { RunAgentFn } from './run-agent'
import type { createAuxProviderHelpers } from './aux-provider'

export interface ForkSkillDeps {
  repo: ReturnType<typeof createChatRepository>
  now: () => string
  requireSession: (userId: string, id: string) => Promise<SessionRecord>
  runAgent: RunAgentFn
  sessionLifecycleCtx: SessionLifecycleCtx
  buildLanguageModel?: ReturnType<typeof createAuxProviderHelpers>['buildLanguageModel']
  inviteAgents: (userId: string, sessionId: string, agentIds: readonly string[]) => Promise<void>
  /** Parent session's working dir — plugin-agent discovery is cwd-scoped. */
  resolveWorkingDir: (userId: string, session: SessionRecord) => Promise<string>
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
    /** Exact native identity, admitted for the delegation host. */
    agentId?: string
    subagentType?: string
    title?: string
    preferredModel?: string
    preferredEffort?: string
    /** CC skill frontmatter `hooks` — activated for the forked child run (Stop→SubagentStop). */
    hooks?: unknown
    /**
     * The participant the fork is for: its route is inherited and its report comes back to it.
     * Absent means the conversation's first participant — the direct-chat case.
     */
    invokedBy?: string
  },
) => Promise<string>

/**
 * Run a skill task in its own delegated session, selected by native identity or
 * a compatibility name. The child shares the parent's workspace. The factory
 * closes over the required service ports instead of the full chat service.
 */
export function createSpawnForkSkill(deps: ForkSkillDeps): SpawnForkSkillFn {
  const { now, requireSession, runAgent, sessionLifecycleCtx, resolveWorkingDir } = deps

  return async (userId, parentId, prompt, opts) => {
    const parentSession = await requireSession(userId, parentId)
    if (!isDelegationParent(parentSession)) {
      throw new Error('Only a root chat may delegate. Subsessions cannot create delegated work.')
    }
    // Native IDs use the same admission port as spawn. External names retain their
    // cwd-scoped adapter lookup until skill format normalization owns that selection.
    const roleName = roleNameOfSubagentType(opts?.subagentType)
    if (opts?.agentId !== undefined && roleName) {
      throw new Error('agentId and subagentType cannot select different agents')
    }
    const service = getAgentService()
    const resolved =
      opts?.agentId !== undefined || roleName
        ? await resolveDelegateSelection(
            {
              projectId: parentSession.projectId ?? null,
              cwd: await resolveWorkingDir(userId, parentSession).catch(() => null),
              resolveAgentById: service?.resolveAgentById,
              resolveSubagentType: service?.resolveSubagentType,
            },
            opts?.agentId,
            roleName,
          )
        : null
    if (opts?.agentId !== undefined && resolved?.agentId !== opts.agentId) {
      throw new Error(`Native agent is unavailable: ${opts.agentId}`)
    }
    if (roleName && !resolved) {
      throw new Error(
        `Unknown subagent_type "${roleName}" — no enabled plugin agent or registry agent by that name.`,
      )
    }
    const fullPrompt =
      !resolved?.agentId && resolved?.prompt ? `${resolved.prompt}\n\n---\n\n${prompt}` : prompt
    // Map a declared CC effort string to a level this system can actually carry. The comment
    // here used to promise "unknown values → undefined" while the code was a bare `as` cast, so
    // ANY string became the child session's effort: it is persisted verbatim (the column is
    // plain text with no constraint) and then handed to the provider. Measured in vendor/pi,
    // an unrecognized level does not mean "no thinking" — it is
    // provider-dependent nonsense (lowest level on the OpenAI family, `default: "high"` on
    // adaptive Claude, `maxTokens: NaN` on the legacy Anthropic budget path), so the only sane
    // answer is "not specified" — see `resolveDeclaredReasoningEffort`.
    // Precedence: the SKILL's own declaration, then the resolved ROLE's, then inherit. The skill
    // is the more specific statement of intent (this task, this run); the role's is the standing
    // one for that agent.
    const effort =
      resolveDeclaredReasoningEffort(opts?.preferredEffort) ??
      resolveDeclaredReasoningEffort(resolved?.preferredEffort)
    // A family alias needs the catalog to become a concrete id; nothing else does, so the read is
    // skipped for the common cases (no declaration, or an already-qualified id).
    const declaredModel = opts?.preferredModel ?? resolved?.preferredModel
    const nativeModel = resolved?.agentId !== undefined && opts?.preferredModel === undefined
    const modelIds =
      !nativeModel && declaredModel && isModelAliasFamily(declaredModel)
        ? await deps.listModelIds?.()
        : undefined
    // The participant who asked for the fork, not whoever joined first: it is its model the
    // child inherits and its report the child owes.
    const parentRoute =
      (opts?.invokedBy ? agentRoute(parentSession, opts.invokedBy) : undefined) ??
      sessionRoute(parentSession)
    const modelId = nativeModel
      ? (declaredModel ?? parentRoute.modelId ?? undefined)
      : (resolveModelAlias(declaredModel, parentRoute.modelId ?? undefined, modelIds) ?? undefined)
    let providerConnectionId = parentRoute.providerConnectionId
    if (resolved?.agentId && (resolved.preferredProvider || resolved.preferredModel)) {
      const route = modelId
        ? await deps.buildLanguageModel?.(
            userId,
            modelId,
            providerConnectionId,
            resolved.preferredProvider ? { providerId: resolved.preferredProvider } : undefined,
          )
        : null
      if (!route) throw new Error('The native agent provider/model route is unavailable')
      providerConnectionId = route.providerConnectionId
    }
    const childAgentId = resolved?.agentId ?? DEFAULT_AGENT_ID
    await deps.inviteAgents(userId, parentId, [childAgentId])
    const child = await sessionLifecycle.createSession(sessionLifecycleCtx, userId, {
      agents: [{ agentId: childAgentId }],
      title: opts?.title ?? 'Forked skill',
      parentSessionId: parentId,
      sessionKind: 'job',
      sourceToolCallId: `skill-fork:${parentId}:${randomUUID()}`,
      provenance: {
        kind: 'skill-fork',
        parentSessionId: parentId,
        // WHICH member delegated it. A child session has one parent participant; callers that
        // dispatch from a multi-participant conversation must supply that address explicitly.
        ...(parentSession.agents?.length
          ? { parentParticipant: agentParticipant(parentRoute.agentId) }
          : {}),
      },
      providerConnectionId,
      // Same never-widen rule as `delegate`: a fork is created fresh, so it must not end
      // up holding authority its parent did not have.
      // Authored native IDs stay literal. Explicit skill declarations still use their
      // external-format compatibility semantics until the skill adapter normalizes them.
      modelId,
      // Apply skill's preferred reasoning effort when declared.
      ...(effort ? { reasoningEffort: effort } : {}),
      projectId: parentSession.projectId,
      // Preload skills declared in the agent's frontmatter.
      ...(resolved?.pinnedSkills?.length ? { pinnedSkills: [...resolved.pinnedSkills] } : {}),
    })
    const childRecord = await requireSession(userId, child.id)
    const runOpts: Parameters<RunAgentFn>[7] = {
      executionContext: childExecutionContext({ kind: 'skill-fork', parentSessionId: parentId }),
      ...(resolved?.agentId && resolved.maxTurns ? { maxTurns: resolved.maxTurns } : {}),
      // A skill that names tools but no agent runs on exactly those tools.
      ...(!resolved?.agentId && resolved?.tools?.length
        ? { profileOverride: resolveRunProfile(childRecord, { tools: [...resolved.tools] }) }
        : {}),
      // CC: a forked skill runs as a sub-agent, so its `Stop` hooks convert to
      // `SubagentStop` (fired on the child's own completion).
      ...(opts?.hooks
        ? {
            ccScopedHooks: [
              {
                raw: opts.hooks,
                source: 'skill' as const,
                asSubagent: true,
                agentType: opts?.subagentType ?? GENERAL_PURPOSE_AGENT,
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
      fullPrompt,
      now(),
      undefined,
      Object.keys(runOpts).length ? runOpts : undefined,
    ).catch((err: unknown) =>
      console.warn('[skill-fork] run failed:', err instanceof Error ? err.message : err),
    )
    return child.id
  }
}
