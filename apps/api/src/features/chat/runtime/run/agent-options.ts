import type { OptionalToolPorts } from '../../../agent-core/tool-registry'
import { isToolDirect, type RunProfile } from '../../../agent-core/run-shape'
import { TOOL } from '../../../agent-core/tool-names'
import { cancelLane, laneOf } from '../../../agent-core/delegation-lanes'
import { dropExpectedReport } from '../../../agent-core/delegation-awaits'
import { launchAgent } from '../../../agent-core/tools/agent/agent-start'
import type { TaskDelegationOptions } from '../../../agent-core/tools/task-delegation'
import type {
  AgentControlPorts,
  ChildRunSummary,
} from '../../../agent-core/tools/agent/agent-control'
import type { AgentLaunchPorts } from '../../../agent-core/tools/agent/agent-type'
import type { ParentLine } from '../../../agent-core/tools/agent/send-message'
import type { ChatRepository, SessionRecord } from '../../repository'
import { getAgentService } from '../agent-service-binding'
import { childMessageWake } from '../delegation-report'

export interface AgentOptionsInput {
  userId: string
  session: SessionRecord
  /** Whether this run reports to the agent that started it (`chat/policy`'s lineage axis). */
  reportsToDelegator: boolean
  agentProfile: RunProfile
  repo: Pick<ChatRepository, 'getSession'>
  taskDelegation?: TaskDelegationOptions
  /** The enabled plugins' agents, startable as subagent types (`catalog-agent.ts`). */
  plugins?: AgentLaunchPorts
  /** Stop a background job of this session (`jobs-tool.ts`), for `TaskStop`. */
  stopJob?: NonNullable<OptionalToolPorts['TaskStop']>['stopJob']
}

/**
 * A child waiting for one of its parent's lanes reads `queued`, with its place — the database
 * only knows it has not run yet, and "idle" would tell the agent nothing is coming. The lane is
 * the only authority: the stored status of a child that has not started can read anything
 * (LOCALIX-430: a queued child read `running` and was answered as one that was being stopped).
 */
const withLaneState = (run: ChildRunSummary): ChildRunSummary => {
  const lane = laneOf(run.sessionId)
  return lane?.state === 'queued' && run.status !== 'closed'
    ? { ...run, status: `queued (#${lane.position})`, waitingForLane: true }
    : run
}

/** The line from a run to the children it started; none where it cannot start any. */
function childControl(input: AgentOptionsInput): AgentControlPorts | undefined {
  const { userId, session } = input
  const svc = getAgentService()
  if (!input.taskDelegation || !svc) return undefined
  return {
    // This session's own children: a deeper row is its own parent's to manage.
    listRuns: async () =>
      ((await svc.listDelegatedRuns?.(userId, session.id)) ?? [])
        .filter((run) => (run.level ?? 1) === 1)
        .map(withLaneState),
    // Both act on a child the tool already resolved against `listRuns`, which is scoped to this
    // user and this session's own children: a session id from elsewhere never reaches here.
    message: async (childSessionId, text) =>
      (await svc.messageSubagent?.(userId, childSessionId, text)) ?? {
        delivered: false,
        reason: 'gone',
      },
    stop: (childSessionId) => stopDelegatedChild(userId, childSessionId),
  }
}

/**
 * The delegator stops a child it started: `TaskStop`, or a workflow whose script no longer waits
 * for its agent. A person's Stop does not come through here, and leaves the wait standing.
 */
export async function stopDelegatedChild(userId: string, childSessionId: string): Promise<void> {
  const svc = getAgentService()
  // The delegator is no longer waiting to hear back: a later run of the child (a person talking
  // to it) must not answer a question the delegator withdrew.
  dropExpectedReport(childSessionId)
  // And no report of it is owed to a sweep either: a child that never ran has no run end to
  // say so (`service/delegation-stop.ts`).
  await svc?.recordChildStopped?.(userId, childSessionId)
  // A child still waiting for a lane has no run to abort: leaving its place would start it
  // later anyway, so it leaves the queue (`cancelLane`) and the stop below finds nothing live.
  if (cancelLane(childSessionId)) return
  await svc?.stopSession?.(childSessionId, userId)
}

/**
 * A subagent's line to the agent that started it (`SendMessage` to "main"): a wake to the
 * parent session, whose agent is the delegator.
 */
function parentLine(input: AgentOptionsInput): ParentLine | undefined {
  const { userId, session } = input
  const provenance = session.provenance
  const wake = getAgentService()?.wakeSession
  if (!input.reportsToDelegator || provenance.kind !== 'task-delegation' || !wake) return undefined
  return {
    send: async (text, toolCallId) => {
      await wake(
        childMessageWake({
          userId,
          parentSessionId: provenance.parentSessionId,
          label: session.title,
          childSessionId: session.id,
          toolCallId,
          text,
        }),
      )
    },
  }
}

/** The ports of `Agent`, `SendMessage` and `TaskStop` for this run, each where it applies. */
export function buildAgentOptions(
  input: AgentOptionsInput,
): Pick<OptionalToolPorts, 'Agent' | 'SendMessage' | 'TaskStop'> {
  const { agentProfile, taskDelegation, plugins } = input
  const children = childControl(input)
  const parent = isToolDirect(agentProfile, TOOL.SendMessage) ? parentLine(input) : undefined
  return {
    Agent:
      isToolDirect(agentProfile, TOOL.Agent) && taskDelegation
        ? {
            start: (toolCallId, request, signal) =>
              launchAgent(toolCallId, request, taskDelegation, signal, plugins),
          }
        : undefined,
    SendMessage:
      isToolDirect(agentProfile, TOOL.SendMessage) && (children || parent)
        ? { ...(children ? { children } : {}), ...(parent ? { parent } : {}) }
        : undefined,
    TaskStop:
      isToolDirect(agentProfile, TOOL.TaskStop) && (children || input.stopJob)
        ? {
            ...(children ? { children } : {}),
            ...(input.stopJob ? { stopJob: input.stopJob } : {}),
          }
        : undefined,
  }
}
