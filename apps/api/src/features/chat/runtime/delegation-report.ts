/**
 * The report a parent receives each time a delegated child's run ends — one builder for both
 * paths that deliver it.
 *
 * EVERY RUN REPORTS. A child is not one-shot any more: its delegator can message it
 * (`agents message`) and the person can write into its chat, and each of those starts a run whose
 * result the parent must see — delegated, worked, reported; messaged, worked, reported. A report
 * sent only for the first run left every later answer in a transcript nobody was reading.
 *
 * Two paths exist because a child can outlive the process running it: the LIVE seam in
 * `run/child-run-report.ts` wakes the parent the moment a run settles, and the RECOVERY sweep in
 * `service/recover-delegation.ts` re-sends the report of a child's latest run whose wake never
 * reached durable admission. They used to build the report separately, and the copies drifted
 * three ways: recovery dropped the truncation marker that says where the rest of a long report
 * lives, dropped the recipient's handle, and woke the child's direct parent where the live path
 * wakes the ROOT chat. Every rule of the report is therefore here once:
 *
 *   bound the text → word the message → address it (session, participant, key).
 */
import { truncateTail } from '@localixai/agent'
import { truncationMarker } from '../../agent-core/tools/tool-output'
import { agentParticipant } from '../../../db/participant'
import type { WakeRequest } from '../contracts'

/** Unbounded child reports once exhausted the parent's context. Keep the conclusion
 * (tail), with a pointer to the full child transcript, instead of copying its log. */
const CHILD_REPORT_MAX_LINES = 120
const CHILD_REPORT_MAX_BYTES = 12_000

const NO_REPORT_NOTICE =
  'It produced no final text. Treat that as a FAILED report, not as an empty result: ' +
  'inspect its transcript with `history_search` before re-running anything.'

/**
 * Cap one child's report and, when capped, say exactly how to read the rest.
 *
 * The bound is the whole defence against a tree bricking the conversation that owns it, and a
 * silent regression here is invisible until a session is already unrecoverable.
 */
export function childReport(text: string, childSessionId: string): string {
  const truncated = truncateTail(text, {
    maxLines: CHILD_REPORT_MAX_LINES,
    maxBytes: CHILD_REPORT_MAX_BYTES,
  })
  if (!truncated.truncated) return text
  return `${truncationMarker(truncated, {
    kept: 'last',
    advice: `Read the full transcript with history_search session_id:"${childSessionId}".`,
  })}\n${truncated.content}`
}

export interface DelegationReportInput {
  /** The child's label (the delegation title). */
  label: string
  childSessionId: string
  /** The run being reported: its final assistant message id — the report's identity. */
  runId: string
  /** How the run ended; only `failed` and `stopped` change the wording. */
  status: string | null
  /** The run's final assistant text; empty or absent means it produced none. */
  text: string | null | undefined
}

/** The wake content the parent reads. */
export function delegationReportMessage(input: DelegationReportInput): string {
  const outcome =
    input.status === 'failed'
      ? 'FAILED'
      : input.status === 'stopped'
        ? 'was STOPPED before finishing'
        : 'finished'
  const text = input.text?.trim()
  const body = text
    ? `\n\nIts final report:\n${childReport(text, input.childSessionId)}`
    : `\n\n${NO_REPORT_NOTICE}`
  return (
    `[Background sub-agent ${outcome}] ${input.label} (id: ${input.childSessionId}) ${outcome}.${body}\n\n` +
    'Act on this result as the task requires (relay it, integrate it, or wrap up). ' +
    'To change or extend its work, send it `agents` action="message" rather than delegating again.'
  )
}

/**
 * The session a report wakes: the one that DELEGATED the work — a conversation for its child, a
 * child for its own child.
 *
 * It used to be the root chat, because delegation was one level deep and the root was always the
 * delegator. Once a child delegates in turn, the root is the wrong reader: the grandchild's work
 * answers the child that asked for it, which integrates it and reports upward in its own turn.
 * Sending it to the root skipped that agent and handed the root work it never assigned.
 */
export function delegationReportSession(parent: { id: string }): string {
  return parent.id
}

/** The participant who delegated, so a multi-participant conversation routes the report back. */
export function delegationReportRecipient(
  delegatingAgentId: string | null | undefined,
  handle: string | null | undefined,
) {
  if (!delegatingAgentId) return undefined
  return {
    participant: agentParticipant(delegatingAgentId),
    ...(handle ? { handle } : {}),
  }
}

/** The prefix every report key starts with; recovery joins receipts on it. */
export const DELEGATION_REPORT_KEY_PREFIX = 'child-terminal:'

/**
 * The idempotency key — one per RUN of a child: both paths use it, and the wake asks for a
 * receipt (`receipt: true`), which the queue store records in the same transaction as the wake
 * row, so each run's report is admitted exactly once whichever path wins.
 *
 * It was one per CHILD while a child ran once. With follow-up runs that key admitted the first
 * report and silently refused every later one as a duplicate — the receipt doing its job on a
 * key that no longer named one delivery. The run's final assistant message is what both paths
 * can name: the live seam holds it, and recovery reads it as the child's latest assistant row.
 *
 * Why this is not a trigger kind. A trigger kind owns TIMING (`firstDue` / `nextDue`) and keys
 * each fire by its sequence (`trg:<id>:<seq>`); a run's end has no due time — it is an event the
 * live seam already observes. A trigger row would need an invented due time and a key re-derived
 * from the run anyway so that recovery agrees with the live path. The receipt says the report
 * was admitted; nothing is left for a trigger to hold.
 */
export const delegationReportKey = (childSessionId: string, runId: string): string =>
  `${DELEGATION_REPORT_KEY_PREFIX}${childSessionId}:${runId}`

/**
 * The whole report wake — message, session, recipient and key — so the two paths hand the
 * queue one value instead of assembling four and able to disagree on any of them.
 */
export function delegationReportWake(
  input: DelegationReportInput & {
    userId: string
    parent: { id: string }
    delegatingAgentId: string | null | undefined
    handle: string | null | undefined
  },
): WakeRequest {
  const to = delegationReportRecipient(input.delegatingAgentId, input.handle)
  return {
    userId: input.userId,
    sessionId: delegationReportSession(input.parent),
    content: delegationReportMessage(input),
    source: 'subagent',
    deliveryKey: delegationReportKey(input.childSessionId, input.runId),
    receipt: true,
    ...(to ? { to } : {}),
  }
}
