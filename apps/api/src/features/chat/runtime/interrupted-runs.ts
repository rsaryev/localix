import type { ChatRepository } from '../repository'
import type { SessionStreamRegistry } from './session-stream-registry'
import { insertUiNote } from './message-persistence'

/**
 * Tell the user, durably, that a run did not finish because the backend restarted.
 *
 * The boot sweep already reclassifies the DB: `agent_runs.status='interrupted'` with
 * `error_code='PROCESS_RESTART'` (`db/migrator.ts`) and every session left `running` becomes
 * `stopped` (`repo.markRunningSessionsStopped`). Nothing READ either of those. An audit traced the
 * consequence: the assistant row holds whatever the last flush wrote — the cadence is 120ms
 * stretching to 2s, so a sentence or a whole turn is missing — and on reconnect the client's REST
 * reconcile reports `isRunning: false`. So the user returns to a **silently truncated answer with
 * no error and no spinner, indistinguishable from a complete reply**, and the only honest recovery
 * (send again) is the one thing they have no reason to do.
 *
 * A `uiOnly` note rather than an edit to the assistant row, deliberately:
 *   - the finalizer's own rule is "never append to a real answer" — it only writes a stop notice
 *     when the model produced no text at all, and an interrupted run usually did produce some;
 *   - `uiOnly` keeps it out of the model's context, so the next turn is not told about the
 *     restart in a way it might narrate or apologise for;
 *   - it is a persisted row, which is what makes it survive the very restart it describes. There
 *     is no live socket to publish to at boot: the client is not connected yet.
 *
 * Durable and idempotent: the run keeps a pending marker until this insert succeeds, and its run id
 * is also the deterministic message id. A crash before the insert retries; a crash after the insert
 * observes the existing row and only finishes the acknowledgement.
 */
/**
 * Deliberately SHORT — pinned at ≤72 chars so it fits an 80-column terminal on one line. The rule
 * came from a transcript renderer that padded a system notice to the full width and never truncated
 * it: a long sentence hard-wrapped and desynced its row accounting by one line per notice. The
 * first version of this was 116 chars and overflowed every terminal under 118 columns — caught by
 * review, not by the width-invariant test, whose adversarial set had no notice row until now. The
 * cap survives as the brevity budget for a notice every client renders verbatim.
 */
export const RUN_INTERRUPTED_NOTICE = 'Backend restarted — this reply is incomplete.'

/**
 * The same interruption, when a SIDE-EFFECTING tool call was in flight.
 *
 * "Just retry" is safe advice only when nothing outside this process changed. A `bash`
 * command dispatched and never settled may have pushed, deleted or deployed — and unlike a
 * file edit (atomic, so no half-file exists and the tree is either before or after) nothing
 * records whether it took effect. Retrying then risks doing it twice, so the notice names
 * the call and asks to check first. The button is still offered: the decision is the
 * reader's, and withholding it would only mean they make the same decision with more
 * clicks.
 */
export function interruptedWithPendingToolNotice(toolNames: readonly string[]): string {
  const named = [...new Set(toolNames)].slice(0, 3).join(', ')
  return `Backend restarted while ${named} was still running — this reply is incomplete, and that call may or may not have taken effect. Check before retrying.`
}

/**
 * Tool calls left `running` in the interrupted reply: dispatched, never settled.
 *
 * Reads the payload the run persisted — which is exactly why dispatching a mutating tool
 * forces a write (see `handleToolExecutionStart`); on the streaming cadence alone this
 * evidence would survive or not by luck.
 */
export function pendingToolNames(payload: unknown): string[] {
  const items = (payload as { items?: unknown } | null)?.items
  if (!Array.isArray(items)) return []
  return items.flatMap((item) => {
    const record = item as {
      status?: unknown
      toolName?: unknown
      name?: unknown
      error?: { code?: unknown }
    }
    // Still running, or settled by the boot sweep below as cut off by the restart.
    const cutOff = record.status === 'aborted' && record.error?.code === RESTART_CODE
    if (record.status !== 'running' && !cutOff) return []
    const name = typeof record.toolName === 'string' ? record.toolName : record.name
    return typeof name === 'string' && name.length > 0 ? [name] : []
  })
}

/** The code a tool call cut off by a restart is settled with — what `pendingToolNames` reads. */
const RESTART_CODE = 'PROCESS_RESTART'
const CUT_OFF_TEXT =
  'Interrupted: the server restarted while this was running. It may or may not have taken effect.'

/**
 * Settle the calls a restart left `running`: nothing will ever end them, and a card that kept
 * spinning "Working…" read as work still in progress (opencode settles stale calls the same way).
 * Each becomes aborted with the restart's code, so the reader sees it stopped and the Continue
 * note can still name it as a call whose effect is unknown.
 */
async function settleCutOffCalls(
  deps: AnnounceInterruptedRunsDeps,
  run: { userId: string; sessionId: string },
  reply: { id: string; payload: { items?: unknown } } | undefined,
): Promise<void> {
  const items = reply?.payload.items
  if (!reply || !Array.isArray(items)) return
  if (!items.some((item) => (item as { status?: unknown }).status === 'running')) return
  const settled = items.map((item) =>
    (item as { status?: unknown }).status === 'running'
      ? {
          ...item,
          status: 'aborted',
          errorText: CUT_OFF_TEXT,
          error: {
            kind: 'aborted',
            code: RESTART_CODE,
            message: CUT_OFF_TEXT,
            userMessage: 'Interrupted by a restart',
          },
        }
      : item,
  )
  await deps.repo.updateMessage(
    run.userId,
    run.sessionId,
    reply.id,
    { items: settled } as never,
    deps.now(),
  )
}

export interface AnnounceInterruptedRunsDeps {
  repo: ChatRepository
  streamRegistry: SessionStreamRegistry
  now: () => string
  markAnnounced: (runId: string) => Promise<void>
  logger?: { warn: (msg: string) => void }
}

/**
 * Announce into every session whose run was interrupted, whatever its kind.
 *
 * The first version filtered to `chat` on the claim that a `subagent` transcript "is not a surface
 * anyone opens" — which a review disproved: `RuntimeSessionsPanel` renders an explicit "Open"
 * button for exactly `subagent`/`job` sessions. A line that duplicates an existing indicator is
 * a far smaller harm than silence.
 */
/** What the interrupted agent left: the still-running tool calls in its last reply — or nothing on any failure. */
async function interruptedReplyOf(
  deps: AnnounceInterruptedRunsDeps,
  run: { userId: string; sessionId: string; agentId: string },
): Promise<{
  pending: string[]
  reply?: { id: string; payload: { items?: unknown } }
}> {
  try {
    const author = `agent:${run.agentId}`
    const messages = await deps.repo.listMessages(run.userId, run.sessionId)
    const replies = messages.filter((message) => message.payload.role === 'assistant')
    const own = [...replies].reverse().find((message) => message.payload.from === author)
    return {
      pending: own ? pendingToolNames(own.payload) : [],
      ...(own ? { reply: { id: own.id, payload: own.payload } } : {}),
    }
  } catch {
    return { pending: [] }
  }
}

export async function announceInterruptedRuns(
  deps: AnnounceInterruptedRunsDeps,
  runs: ReadonlyArray<{ runId: string; sessionId: string; userId: string; agentId: string }>,
): Promise<number> {
  let announced = 0
  for (const { runId, sessionId, userId, agentId } of runs) {
    try {
      // Was a side-effecting call in flight? The answer changes the advice, so it is read
      // rather than assumed. A failure to read it degrades to the plain notice: an
      // interruption must always be announced, and a less specific warning beats silence.
      const { pending, reply } = await interruptedReplyOf(deps, {
        userId,
        sessionId,
        agentId,
      })
      // Best effort: the announcement matters more than the card's spinner.
      await settleCutOffCalls(deps, { userId, sessionId }, reply).catch(() => undefined)
      const notice =
        pending.length > 0 ? interruptedWithPendingToolNotice(pending) : RUN_INTERRUPTED_NOTICE
      await insertUiNote({
        repo: deps.repo,
        streamRegistry: deps.streamRegistry,
        now: deps.now,
        userId,
        sessionId,
        // A crash after insert but before acknowledgement retries this exact id on the next boot.
        messageId: runId,
        content: notice,
        // The recovery, carried with the notice rather than left as prose for the reader to
        // act out. Re-running the turn is always the right gesture here — the history up to
        // the user's message is intact, and regenerate keeps the truncated attempt as a
        // sibling branch instead of overwriting it.
        systemNotice: {
          kind: 'run_interrupted',
          tone: 'warning',
          text: notice,
          recovery: ['retry'],
        },
      })
      await deps.markAnnounced(runId)
      announced += 1
    } catch (error) {
      // A note is worth less than a boot. One unwritable session must not stop the server.
      deps.logger?.warn(
        `[boot] could not announce the interrupted run in session ${sessionId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
  }
  return announced
}
