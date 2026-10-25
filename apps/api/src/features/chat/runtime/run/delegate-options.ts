import type { OptionalToolPorts } from '../../../agent-core/tool-registry'
import { isToolDirect, type RunProfile } from '../../../agent-core/run-shape'
import { TOOL } from '../../../agent-core/tool-names'
import { laneOf } from '../../../agent-core/delegation-lanes'
import { dropExpectedReport } from '../../../agent-core/delegation-awaits'
import { startDelegation } from '../../../agent-core/tools/delegate-start'
import type { TaskDelegationOptions } from '../../../agent-core/tools/task-delegation'
import type { DelegatedRunSummary } from '../../../agent-core/tools/delegate-control'
import type { DelegateAgentPorts } from '../../../agent-core/tools/delegate-agent-type'
import type { SessionRecord } from '../../repository'
import { getAgentService } from '../agent-service-binding'

export interface DelegateOptionsInput {
  userId: string
  session: SessionRecord
  agentProfile: RunProfile
  taskDelegation?: TaskDelegationOptions
  /** The enabled plugins' agents, delegable as subagent types (`speaker-agent.ts`). */
  plugins?: DelegateAgentPorts
}

/**
 * A child waiting for one of its parent's lanes reads `queued`, with its place — the database
 * only knows it has not run yet, and "idle" would tell the agent nothing is coming.
 */
const withLaneState = (run: DelegatedRunSummary): DelegatedRunSummary => {
  const lane = laneOf(run.sessionId)
  return lane?.state === 'queued' && run.status !== 'running' && run.status !== 'closed'
    ? { ...run, status: `queued (#${lane.position})` }
    : run
}

/** Build `delegate` — the start, and the line to each child — for an interactive chat. */
export function buildDelegateOptions(input: DelegateOptionsInput): OptionalToolPorts['delegate'] {
  const { userId, session, agentProfile, taskDelegation, plugins } = input
  if (!isToolDirect(agentProfile, TOOL.delegate) || !taskDelegation) return undefined

  const svc = getAgentService()

  return {
    delegate: (toolCallId, request, signal) =>
      startDelegation(toolCallId, request, taskDelegation, signal, plugins),
    // This session's own children: a deeper row is its own delegator's to manage.
    listRuns: async () =>
      ((await svc?.listDelegatedRuns?.(userId, session.id)) ?? [])
        .filter((run) => (run.level ?? 1) === 1)
        .map(withLaneState),
    // All three act on a child the tool already resolved against `listRuns`, which is scoped to
    // this user and this session's own children: a session id from elsewhere never reaches here.
    message: async (childSessionId, text, interrupt) =>
      (await svc?.messageSubagent?.(userId, childSessionId, text, undefined, interrupt)) ?? {
        delivered: false,
        reason: 'gone',
      },
    stop: async (childSessionId) => {
      // The agent stopped it, so it is no longer waiting to hear back: a later run of the child
      // (a person talking to it) must not answer a question the agent withdrew. A person's Stop
      // does not come through here, and leaves the wait standing.
      dropExpectedReport(childSessionId)
      await svc?.stopSession?.(childSessionId, userId)
    },
    close: async (childSessionId) =>
      (await svc?.closeSubagent?.(userId, childSessionId)) ?? { closed: false, reason: 'gone' },
  }
}
