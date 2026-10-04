import type { OptionalToolPorts } from '../../../agent-core/tool-registry'
import { isToolDirect, type RunProfile } from '../../../agent-core/run-shape'
import { TOOL } from '../../../agent-core/tool-names'
import { laneOf } from '../../../agent-core/delegation-lanes'
import { dropExpectedReport } from '../../../agent-core/delegation-awaits'
import {
  delegateTasks,
  type TaskDelegationOptions,
} from '../../../agent-core/tools/task-delegation'
import type { DelegatedRunSummary } from '../../../agent-core/tools/agents'
import type { SessionRecord } from '../../repository'
import { getAgentService } from '../agent-service-binding'

export interface AgentsOptionsInput {
  userId: string
  session: SessionRecord
  agentProfile: RunProfile
  taskDelegation?: TaskDelegationOptions
}

/**
 * A child waiting for one of its parent's lanes reads `queued`, with its place — the database
 * only knows it has not run yet, and "idle" would tell the delegator nothing is coming.
 */
const withLaneState = (run: DelegatedRunSummary): DelegatedRunSummary => {
  const lane = laneOf(run.sessionId)
  return lane?.state === 'queued' && run.status !== 'running' && run.status !== 'closed'
    ? { ...run, status: `queued (#${lane.position})` }
    : run
}

/** Build the delegation surface — and the line to each delegated child — for an interactive chat. */
export function buildAgentsOptions(input: AgentsOptionsInput): OptionalToolPorts['agents'] {
  const { userId, session, agentProfile, taskDelegation } = input
  if (!isToolDirect(agentProfile, TOOL.agents) || !taskDelegation) return undefined

  const svc = getAgentService()

  return {
    // This session's OWN children: a grandchild belongs to the child that delegated it.
    listRuns: async () =>
      ((await svc?.listDelegatedRuns?.(userId, session.id)) ?? []).map(withLaneState),
    delegate: (toolCallId, briefs) => delegateTasks(toolCallId, briefs, taskDelegation),
    // All three act on a child the tool already resolved against `listRuns`, which is scoped to
    // this user and this session's own children — a session id from anywhere else never reaches here.
    message: async (childSessionId, text, priority, interrupt) =>
      (await svc?.messageSubagent?.(userId, childSessionId, text, priority, interrupt)) ?? {
        delivered: false,
        reason: 'gone',
      },
    stop: async (childSessionId) => {
      // The delegator stopped it, so it is no longer waiting to hear back: a later run of the
      // child (a person talking to it) must not answer a question the delegator withdrew. A
      // person's Stop does not come through here, and leaves the wait standing.
      dropExpectedReport(childSessionId)
      await svc?.stopSession?.(childSessionId, userId)
    },
    close: async (childSessionId) =>
      (await svc?.closeSubagent?.(userId, childSessionId)) ?? { closed: false, reason: 'gone' },
  }
}
