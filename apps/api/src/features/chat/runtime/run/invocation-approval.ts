import { randomUUID } from 'node:crypto'
import type { AgentDefinition } from '@localixai/agent/agents'
import type {
  ConfirmToolRequest,
  ConfirmToolResponse,
} from '../../../agent-core/tools/hitl/confirm'
import type { HitlRegistry } from '../hitl-registry'
import type { SessionStreamRegistry } from '../session-stream-registry'
import { surfaceConfirmRequest } from '../hitl-confirm'
import { isHitlTimeout } from '../../../agent-core/tools/hitl/decision-deadline'
import type { ApprovalAnswer } from '../../../agents/invocation-service'
import { reachableHitlTarget } from './hitl-reachable'
import type { AgentSessionKind } from '../../../agent-core/run-shape'

/** One human answer covers one attempt, never a persistent capability or session grant. */
export async function requestInvocationApproval(args: {
  hitlRegistry: HitlRegistry
  streamRegistry: SessionStreamRegistry
  userId: string
  targetSessionId: string
  sourceSessionId: string
  assistantMessageId: string
  agent: AgentDefinition
  host: string
  signal: AbortSignal
}): Promise<ApprovalAnswer> {
  if (args.signal.aborted) return 'declined'
  const label = args.agent.label ?? args.agent.handle
  const request = surfaceConfirmRequest({
    hitlRegistry: args.hitlRegistry,
    streamRegistry: args.streamRegistry,
    userId: args.userId,
    sessionId: args.targetSessionId,
    sourceSessionId: args.sourceSessionId,
    messageId: args.assistantMessageId,
    toolCallId: `invocation:${randomUUID()}`,
    toolName: 'agent invocation',
    // Imperative, like every other card — see the title note in `confirm-requester.ts`.
    title: `Start ${label}`,
    payload: {
      command: label,
      description: `Allow ${label} to run in ${args.host} for this attempt only.`,
    },
  })
  try {
    const response = await args.hitlRegistry.controller.request<
      ConfirmToolRequest,
      ConfirmToolResponse
    >(request, args.signal)
    if (args.signal.aborted) return 'declined'
    return response.payload.answers?.confirmed ? 'approved' : 'declined'
  } catch (error) {
    // The card expiring is not a person refusing, and the parent that tried to delegate is
    // told which happened — see `hitl/decision-deadline.ts`.
    return isHitlTimeout(error) ? 'unanswered' : 'declined'
  } finally {
    args.hitlRegistry.clearRequest(request.id)
  }
}

/**
 * The approval requester a run hands to `resolveRunAgent`, or `undefined` when this run has
 * no surface to ask on.
 *
 * Built HERE rather than inline at the call site because the `undefined` is the load-bearing
 * half: an invocation whose policy says `ask` must be REFUSED, not silently allowed, when
 * nobody can answer — so "can a human be reached" and "how to reach them" are one decision
 * and belong in one place. An unattended job reaching this returns undefined and the policy
 * turns its `ask` into a refusal.
 */
export function invocationApprovalRequester(args: {
  hitlRegistry: HitlRegistry
  streamRegistry: SessionStreamRegistry
  userId: string
  session: { id: string; sessionKind: AgentSessionKind }
  hitlTargetSessionId: string | null
  assistantMessageId: string
  host: string
  signal: AbortSignal
}): ((agent: AgentDefinition) => Promise<ApprovalAnswer>) | undefined {
  const { session, hitlTargetSessionId, ...rest } = args
  const target = reachableHitlTarget({
    sessionKind: session.sessionKind,
    sessionId: session.id,
    hitlTargetSessionId,
  })
  if (!target) return undefined
  return (agent) =>
    requestInvocationApproval({
      ...rest,
      targetSessionId: target,
      sourceSessionId: session.id,
      agent,
    })
}
