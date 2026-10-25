import type { AgentToolExecutionContext, AgentToolResult } from '@localixai/agent/agents'
import type { ConfirmToolRequest, ConfirmToolResponse } from './hitl/confirm'
import {
  HITL_DECISION_MS,
  isHitlTimeout,
  unansweredError,
  unansweredRefusal,
} from './hitl/decision-deadline'

/**
 * The person's yes to one change of the Store, asked by the tool itself.
 *
 * The permission gate cannot show a plan (it is pure and synchronous) and cannot tell whether it
 * approved because a person clicked or because a rule let the call through. A Store install needs
 * the second answer: the plan's consent goes to the Store only after a person said yes to a card
 * that listed it. So the card is raised here, once per mutating call, with no breadth to widen: a
 * session grant must never stand in for reading a plan.
 */

export const NO_APPROVER =
  'No person can approve a change to the Store from this run. Say what you would install or change and why, and let the user do it.'

type Context = Pick<AgentToolExecutionContext, 'humanInLoop' | 'interactive'> | undefined

export const canConfirm = (context: Context): boolean =>
  !!context?.humanInLoop && context.interactive !== false

export async function askStoreApproval(args: {
  context: NonNullable<Context>
  toolCallId: string
  title: string
  /** One line per fact the person decides on. */
  lines: readonly string[]
  signal: AbortSignal | undefined
  onUpdate: ((update: { request: ConfirmToolRequest }) => void) | undefined
}): Promise<{ approved: true } | { approved: false; result: AgentToolResult }> {
  const now = Date.now()
  const request: ConfirmToolRequest = {
    id: args.toolCallId,
    kind: 'confirm',
    title: args.title,
    payload: { command: args.lines.join('\n'), subject: 'resource' },
    createdAt: now,
    expiresAt: now + HITL_DECISION_MS,
  }
  args.onUpdate?.({ request })
  type Outcome = { answer: ConfirmToolResponse } | { unanswered: 'expired' | 'dismissed' }
  const outcome = await args.context
    .humanInLoop!.request<ConfirmToolRequest, ConfirmToolResponse>(request, args.signal)
    .then((answer): Outcome => ({ answer }))
    .catch((error: unknown): Outcome => {
      // An abort is the run ending, not a decision.
      if (isHitlTimeout(error)) return { unanswered: 'expired' }
      if (error instanceof Error && error.name === 'HumanInLoopDismissedError')
        return { unanswered: 'dismissed' }
      throw error
    })
  if ('answer' in outcome && outcome.answer.payload.answers.confirmed) return { approved: true }
  if ('unanswered' in outcome && outcome.unanswered === 'expired') {
    const content = unansweredRefusal(
      `"${args.title}" was not done and nothing was changed. Do not ask again in this conversation.`,
    )
    return {
      approved: false,
      result: { content, isError: true, error: unansweredError(content) },
    }
  }
  const reply = 'answer' in outcome ? outcome.answer.payload.answers.message?.trim() : undefined
  return {
    approved: false,
    result: {
      content:
        `The user declined "${args.title}". Nothing was changed. Do not ask again in this conversation; continue without it or ask what they want instead.` +
        (reply ? `\nThe user replied: ${reply}` : ''),
      isError: true,
    },
  }
}
