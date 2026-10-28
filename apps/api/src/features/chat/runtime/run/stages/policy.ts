/**
 * Stage 1b — policy: the facts of this run, resolved into its policy once (`chat/policy`).
 *
 * Every later stage reads the decisions instead of asking the session record again, and the
 * registry is read here, once — it used to be read by the tool stage, the prompt, the agent's
 * tool context and the topic port, up to three times a run. The agent
 * is admitted under the host this policy names, so the stage runs before the turn resolves.
 */
import { resolveRunPolicy, type RunPolicy } from '../../../policy/run-policy'
import type { RunFrame } from './frame'

export interface RunStanding {
  policy: RunPolicy
  /** The registry as the run's scope sees it — the agents `Agent` can delegate to. */
  registry: Awaited<ReturnType<NonNullable<RunFrame['env']['deps']['listRegistryAgents']>>>
}

export async function resolveRunStanding(frame: RunFrame): Promise<RunStanding> {
  const { env, params, userId, session } = frame
  const registry = (await env.deps.listRegistryAgents?.(userId, session.projectId)) ?? []
  const policy = resolveRunPolicy({
    session,
    invocation: params.scope.executionContext.invocation,
    trigger: {
      promptOrigin: params.historyMessages.at(-1)?.payload.origin,
      continuation: params.chain.continuation,
    },
    hitl: frame.hitl,
  })
  return { policy, registry }
}
