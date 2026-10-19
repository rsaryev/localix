/**
 * Constructors for `RunParams` — the ONLY place a run's parameters are built or
 * carried forward.
 *
 * Why this exists: the runner has several ways to re-enter a run (configuration/hook
 * continuations, transient retry, checkpoint-and-rerun, a queued wake) and each used to
 * hand-list the fields it carried. Three of them disagreed: continuations dropped the
 * skill tool grants and the sub-agent turn cap and RESET the retry latches (every
 * continuation refilled the recovery and transient-retry budgets), and a queued wake
 * rebuilt the params from scratch, so a delegated task run woken by its own background job
 * ran under the session's default profile instead of its task role. With the fields
 * grouped by lifetime (`RunScope` / `RunChain`) a re-entry carries each group whole,
 * and the disagreement has no place to live.
 */
import type { SessionRecord } from '../repository'
import type { RunCompletion } from './run-outcome'
import type { RunChain, RunIdentity, RunParams, RunScope, RunTurn } from './run-contract'
import type { ToolRequirement } from '../../agent-core/required-tools'
import { hostPolicy } from '../policy/session-policy'

function mergeToolRequirements(requirements: readonly ToolRequirement[]): ToolRequirement[] {
  const byName = new Map<string, Set<string>>()
  for (const requirement of requirements) {
    const resources = byName.get(requirement.name) ?? new Set<string>()
    for (const resource of requirement.resources ?? []) resources.add(resource)
    byName.set(requirement.name, resources)
  }
  return [...byName].map(([name, resources]) => ({
    name,
    ...(resources.size ? { resources: [...resources] } : {}),
  }))
}

function snapshotToolConstraints<T extends RunIdentity>(identity: T): T {
  return identity.hostTools === undefined && identity.requiredTools === undefined
    ? identity
    : {
        ...identity,
        ...(identity.hostTools !== undefined
          ? { hostTools: Object.freeze([...identity.hostTools]) }
          : {}),
        ...(identity.requiredTools !== undefined
          ? {
              requiredTools: Object.freeze(
                identity.requiredTools.map((tool) =>
                  Object.freeze({
                    ...tool,
                    ...(tool.resources ? { resources: Object.freeze([...tool.resources]) } : {}),
                  }),
                ),
              ),
            }
          : {}),
      }
}

/** The chain of a run that nothing re-entered yet. */
export function freshChain(completion?: RunCompletion): RunChain {
  return {
    completion,
    continuation: false,
    checkpointRecovered: false,
    transientRetryCount: 0,
    hookStopContinuationCount: 0,
  }
}

/**
 * Params for a freshly dispatched run: this turn, the dispatcher's scope, an empty chain.
 *
 * The persisted participant order is never changed for execution. The explicit speaker address
 * is carried in `RunScope` through every continuation, retry and compact-and-rerun segment.
 */
export function dispatchParams(
  turn: RunTurn,
  scope: RunScope,
  completion?: RunCompletion,
): RunParams {
  return {
    ...turn,
    scope: snapshotToolConstraints(scope),
    chain: freshChain(completion),
  }
}

/**
 * Params for the next physical segment of the SAME logical run. The scope is carried
 * whole; the chain is carried whole and then patched (a counter bumped, a latch set);
 * `continuation` is always true — a re-entered segment is never a user turn.
 */
export function reenterParams(
  params: RunParams,
  turn: Partial<RunTurn>,
  chain: Partial<Omit<RunChain, 'continuation'>> = {},
): RunParams {
  return {
    userId: turn.userId ?? params.userId,
    session: turn.session ?? params.session,
    historyMessages: turn.historyMessages ?? params.historyMessages,
    ...((turn.contextBoundaryId ?? params.contextBoundaryId)
      ? { contextBoundaryId: turn.contextBoundaryId ?? params.contextBoundaryId }
      : {}),
    assistantMessageId: turn.assistantMessageId ?? params.assistantMessageId,
    scope: params.scope,
    chain: { ...params.chain, ...chain, continuation: true },
  }
}

/**
 * Whether a session's run identity outlives the run that carried it. A job or
 * sub-agent session IS one dispatched task, so the wakes landing on it later (its
 * background job finishing, a cron tick) must run under the same role. A chat
 * session's identity fields are one-run grants from a skill invocation; remembering
 * them would let a later wake inherit `allowed-tools` it was never granted.
 */
export function identityOutlivesRun(session: Pick<SessionRecord, 'sessionKind'>): boolean {
  return hostPolicy(session).remembersRunIdentity
}

/** The identity half of a scope, without the authority (which every wake re-derives). */
export function identityOf(scope: RunScope): RunIdentity {
  const { executionContext: _authority, ...identity } = scope
  return snapshotToolConstraints(identity)
}

/** Merge a wake's own tool restrictions over the remembered identity; restrictions only add. */
export function mergeIdentity(
  remembered: RunIdentity | undefined,
  extra: RunIdentity,
): RunIdentity {
  const disabled = [...(remembered?.extraDisabledTools ?? []), ...(extra.extraDisabledTools ?? [])]
  const hostTools =
    remembered?.hostTools !== undefined && extra.hostTools !== undefined
      ? remembered.hostTools.filter((name) => extra.hostTools!.includes(name))
      : (remembered?.hostTools ?? extra.hostTools)
  const requiredTools = [...(remembered?.requiredTools ?? []), ...(extra.requiredTools ?? [])]
  return snapshotToolConstraints({
    ...remembered,
    ...extra,
    ...(hostTools !== undefined ? { hostTools } : {}),
    ...(requiredTools.length ? { requiredTools: mergeToolRequirements(requiredTools) } : {}),
    ...(disabled.length ? { extraDisabledTools: [...new Set(disabled)] } : {}),
  })
}
