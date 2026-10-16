import type { OptionalToolPorts } from '../../../agent-core/tool-registry'
import { isToolDirect, type RunProfile } from '../../../agent-core/run-shape'
import { TOOL } from '../../../agent-core/tool-names'
import { laneOf } from '../../../agent-core/delegation-lanes'
import { dropExpectedReport } from '../../../agent-core/delegation-awaits'
import { forkSelf } from '../../../agent-core/tools/agent-fork'
import type { TaskDelegationOptions } from '../../../agent-core/tools/task-delegation'
import type { DelegatedRunSummary } from '../../../agent-core/tools/fork-control'
import type { SessionRecord } from '../../repository'
import { getAgentService } from '../agent-service-binding'

export interface ForkOptionsInput {
  userId: string
  session: SessionRecord
  agentProfile: RunProfile
  taskDelegation?: TaskDelegationOptions
}

/**
 * A fork waiting for one of its parent's lanes reads `queued`, with its place — the database
 * only knows it has not run yet, and "idle" would tell the agent nothing is coming.
 */
const withLaneState = (run: DelegatedRunSummary): DelegatedRunSummary => {
  const lane = laneOf(run.sessionId)
  return lane?.state === 'queued' && run.status !== 'running' && run.status !== 'closed'
    ? { ...run, status: `queued (#${lane.position})` }
    : run
}

/** Build `fork` — the start, and the line to each fork — for an interactive chat. */
export function buildForkOptions(input: ForkOptionsInput): OptionalToolPorts['fork'] {
  const { userId, session, agentProfile, taskDelegation } = input
  if (!isToolDirect(agentProfile, TOOL.fork) || !taskDelegation) return undefined

  const svc = getAgentService()

  return {
    fork: (toolCallId, request) => forkSelf(toolCallId, request, taskDelegation),
    // This session's OWN forks. A child an older conversation delegated to another agent stays
    // readable and a person can still talk to it, but it is no longer the agent's to manage.
    listRuns: async () =>
      ((await svc?.listDelegatedRuns?.(userId, session.id)) ?? [])
        .filter((run) => run.forked && (run.level ?? 1) === 1)
        .map(withLaneState),
    // All three act on a fork the tool already resolved against `listRuns`, which is scoped to
    // this user and this session's own forks — a session id from anywhere else never reaches here.
    message: async (childSessionId, text, interrupt) =>
      (await svc?.messageSubagent?.(userId, childSessionId, text, undefined, interrupt)) ?? {
        delivered: false,
        reason: 'gone',
      },
    stop: async (childSessionId) => {
      // The agent stopped it, so it is no longer waiting to hear back: a later run of the fork
      // (a person talking to it) must not answer a question the agent withdrew. A person's Stop
      // does not come through here, and leaves the wait standing.
      dropExpectedReport(childSessionId)
      await svc?.stopSession?.(childSessionId, userId)
    },
    close: async (childSessionId) =>
      (await svc?.closeSubagent?.(userId, childSessionId)) ?? { closed: false, reason: 'gone' },
  }
}
