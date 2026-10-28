/**
 * The report a parent receives each time a delegated child's run ends — one builder for both
 * paths that deliver it.
 *
 * EVERY RUN REPORTS. A child is not one-shot any more: the agent that delegated to it can message
 * it (`SendMessage`) and the person can write into its chat, and each of those starts a
 * run whose result the parent must see — delegated, worked, reported; messaged, worked, reported. A report
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
 *   bound the text → word the message → address it (session, agent, key).
 */
import { reportBody } from '../../agent-core/tools/child-report'
import { TOOL } from '../../agent-core/tool-names'
import type { DelegatedReport, WakeRequest } from '../contracts'

/** How far back one run's rows are followed: a backstop against a stored cycle, never a limit in use. */
const MAX_RUN_ROWS = 200

/** One stored assistant row of a child, as far as its report needs it. */
export interface RunRow {
  content: string | null | undefined
  /** The row's items, as stored: what the run's last tool call was says how it ended. */
  items?: readonly { type?: string; name?: string; status?: string }[] | null
  /** The row this one continues: a steer ended that row and started this one, in the same run. */
  continuedFromMessageId: string | null | undefined
}

/** Every reply of one run, in the order it was written, as one text (empty replies are dropped). */
export function joinRunReplies(replies: readonly (string | null | undefined)[]): string | null {
  const text = replies
    .map((reply) => reply?.trim())
    .filter(Boolean)
    .join('\n\n')
  return text || null
}

/**
 * Did the run end right after the child messaged the agent that started it? `SendMessage` is a
 * subagent's line to its delegator and nothing else, so a completed one as the run's last tool
 * call is a child that said what it needed and ended its turn to wait for the answer — the
 * instruction it was given for exactly that case (`PARENT_LINE`). Read from the stored row, not
 * from what the child wrote.
 */
function endedAwaitingParent(items: RunRow['items']): boolean {
  const last = [...(items ?? [])].reverse().find((item) => item.type === 'tool_call')
  return last?.name === TOOL.SendMessage && last.status === 'completed'
}

/** The text of a run and how it ended (`readRunReplies`). */
export interface RunReplies {
  text: string | null
  /** It ended after the child messaged its delegator (`endedAwaitingParent`). */
  waiting: boolean
}

/**
 * The text of the RUN that ended with `runId`: a message that arrives mid-run splits the
 * assistant row (`run/steer-split.ts`), so a run is the chain of rows from its end back through
 * `continuedFromMessageId`. The report used to be the last row alone — and a child that finished
 * its review in the row before a late amendment reported only what it said after it
 * (LOCALIX-430: a 15,000 character review lost, a 244 character "see my previous report" sent).
 * Both the live seam and the recovery sweep read it through this, so the two cannot disagree.
 */
export async function readRunReplies(
  runId: string,
  read: (messageId: string) => Promise<RunRow | null>,
): Promise<RunReplies> {
  const replies: (string | null | undefined)[] = []
  let waiting = false
  const seen = new Set<string>()
  for (let id: string | null | undefined = runId; id && !seen.has(id);) {
    seen.add(id)
    if (seen.size > MAX_RUN_ROWS) break
    // oxlint-disable-next-line react-doctor/async-await-in-loop -- each row names the one before it
    const row = await read(id)
    if (!row) break
    if (replies.length === 0) waiting = endedAwaitingParent(row.items)
    replies.unshift(row.content)
    id = row.continuedFromMessageId
  }
  return { text: joinRunReplies(replies), waiting }
}

/** One run of a child, as its report states it (`DelegatedReport` on the wake). */
export type DelegationReportInput = DelegatedReport

const REPORT_FOLLOW_UP =
  'To change or extend this work, SendMessage to the child by its name or id: it keeps everything it learned. Check its conclusion against its evidence before relaying it.'

/** One child's part of a report: how its run ended, and its bounded final text. */
function reportSection(input: DelegationReportInput): string {
  // A run cut off at its turn limit (CC `maxTurns`) reports what it has, marked partial.
  const partial = input.partial === true && input.status === 'completed'
  const outcome =
    input.status === 'failed'
      ? 'FAILED'
      : input.status === 'stopped'
        ? 'was STOPPED before finishing'
        : partial
          ? 'reached its turn limit'
          : input.waiting
            ? 'is waiting for your answer'
            : 'finished'
  // A child that asked and ended its turn is not done: say what it needs, not that it finished.
  const waitingNote =
    input.waiting && outcome === 'is waiting for your answer'
      ? 'It messaged you and ended its turn to wait. SendMessage to it to answer: its next run reports again.\n\n'
      : ''
  return (
    `[Subagent ${outcome}] ${input.label} (id: ${input.childSessionId}) ${outcome}.\n\n` +
    waitingNote +
    reportBody(input.text, input.childSessionId, { partial })
  )
}

/** The wake content the parent reads for one child's run. */
export function delegationReportMessage(input: DelegationReportInput): string {
  return `${reportSection(input)}\n\n${REPORT_FOLLOW_UP}`
}

/**
 * The content the parent reads for every report delivered together — the children one delegator
 * handed work to, reporting as one batch once the last of them is done (`wake-queue/kinds.ts`).
 * One report reads exactly as it does alone; several are numbered under one heading, with the
 * follow-up hint once at the end rather than after each.
 */
export function delegationReportsMessage(reports: readonly DelegationReportInput[]): string {
  if (reports.length === 1) return delegationReportMessage(reports[0]!)
  const sections = reports.map((report, index) => `${index + 1}. ${reportSection(report)}`)
  return [
    `[${reports.length} subagent replies] Each subagent's reply follows; answer them together.`,
    ...sections,
    REPORT_FOLLOW_UP,
  ].join('\n\n')
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
  },
): WakeRequest {
  const { label, childSessionId, runId, status, text, partial, waiting } = input
  return {
    userId: input.userId,
    sessionId: delegationReportSession(input.parent),
    content: delegationReportMessage(input),
    source: 'subagent',
    deliveryKey: delegationReportKey(input.childSessionId, input.runId),
    receipt: true,
    report: {
      label,
      childSessionId,
      runId,
      status,
      text,
      ...(partial ? { partial } : {}),
      ...(waiting ? { waiting } : {}),
    },
  }
}

/**
 * A subagent's message to the agent that started it, sent while it works (`SendMessage` to
 * "main"): a question only the parent can answer, a finding it needs now. It is not a report —
 * no hold waits for the other subagents, no receipt makes it once-ever — and it joins the
 * delegator's running turn at its next completed tool step (`wake-queue/kinds.ts`), or opens a
 * turn when the delegator is idle. Each call is its own delivery.
 */
export function childMessageWake(input: {
  userId: string
  parentSessionId: string
  label: string
  childSessionId: string
  toolCallId: string
  text: string
}): WakeRequest {
  return {
    userId: input.userId,
    sessionId: input.parentSessionId,
    content:
      `[Message from subagent] ${input.label} (id: ${input.childSessionId}) is still working and sent:\n\n` +
      `${input.text}\n\n` +
      'Answer with SendMessage to its id if it asks something; its final reply arrives on its own.',
    source: 'subagent',
    deliveryKey: `child-message:${input.childSessionId}:${input.toolCallId}`,
  }
}
