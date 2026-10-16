/**
 * agentLoop tool-execution event handlers for one run (start / update / end).
 * Split out of event-handlers.ts to keep that dispatcher focused; these operate
 * on the same RunTurnState through the shared TurnEventContext.
 */
import type { AgentItemStatus } from '@localixai/agent/agents'

import { recordToolUse } from '../../../tools/usage-recorder'
import { finalizeTiming, setItemsPayload } from './turn-state'
import { settleToolTiming } from './tool-timing'
import { persistToolResultMedia } from './tool-result-media'
import {
  flushOrPublish,
  persistNow,
  publishSessionTiming,
  type EventOf,
  type TurnEventContext,
} from './event-handlers'

/**
 * At most one `child_session.activity` frame per child session per this window.
 *
 * The event fires on EVERY tool start, EVERY tool end, and every `tool_execution_update` — i.e.
 * once per streamed output chunk of a child's bash/agent tool. One session spawning hundreds of
 * concurrent sub-agents therefore published thousands of frames per second, each of which the
 * client turned into a store commit. ~200ms is well under the threshold where a "doing now" label
 * stops reading as live, and it is the publisher's job to impose it: the frame is classified
 * `live-only` precisely because intermediate values are meant to be droppable.
 */
const ACTIVITY_COALESCE_MS = 200

/**
 * Leading-edge + trailing-edge coalescer, keyed by CHILD session id.
 *
 * Leading edge so the first activity of a run appears instantly (a debounce alone would make every
 * child look idle for its first 200ms). Trailing edge so the LAST value in a burst is not lost —
 * without it a child that goes quiet right after a burst would be left showing a stale label until
 * its next tool. An entry exists only while a window is open, so the map drains itself and cannot
 * accumulate across a long session.
 */
const activityWindows = new Map<
  string,
  { timer: ReturnType<typeof setTimeout>; trailing: (() => void) | null }
>()

function publishCoalescedActivity(childSessionId: string, publish: () => void): void {
  const open = activityWindows.get(childSessionId)
  if (open) {
    // Latest-wins: replace whatever was pending, publish it when the window closes.
    open.trailing = publish
    return
  }
  const arm = () => {
    const timer = setTimeout(() => {
      const current = activityWindows.get(childSessionId)
      if (!current) return
      if (!current.trailing) {
        activityWindows.delete(childSessionId)
        return
      }
      const trailing = current.trailing
      current.trailing = null
      current.timer = arm()
      trailing()
    }, ACTIVITY_COALESCE_MS)
    // A transient UI label must never be the reason the process stays alive (a CLI run that
    // finishes inside the window would otherwise linger).
    timer.unref?.()
    return timer
  }
  activityWindows.set(childSessionId, { timer: arm(), trailing: null })
  publish()
}

/**
 * Forward this child's live progress UP to its parent so the delegate transcript
 * card + the runtime-sessions panel can show a "doing now" line and coarse
 * turn/tool counts. Covers BOTH our-agentLoop child kinds that run their OWN loop
 * rather than streaming through the parent:
 *   - `subagent` — a synchronous `delegate` child (created via createSession,
 *     not the registerExternalSession/childSessionsByToolCall path), so the
 *     parent never emits a tool_execution_update for it.
 *   - `job` — a delegated task run (also createSession, parentSessionId = the owning
 *     chat session via ownerLink), so it's likewise invisible on the parent
 *     stream without this forward.
 * Neither is in `childSessionsByToolCall`, so the executor-child path in
 * handleToolExecutionUpdate never fires for them — no double emission. Skip
 * entirely when nobody is watching the parent (the common case while a
 * worker/sub-agent runs unattended).
 */
function forwardChildActivity(ctx: TurnEventContext, activity: string) {
  const { env, state } = ctx
  const parentSessionId = ctx.session.parentSessionId
  if (
    !parentSessionId ||
    (ctx.session.sessionKind !== 'subagent' && ctx.session.sessionKind !== 'job') ||
    !env.deps.streamRegistry.hasWatchers(ctx.userId, parentSessionId)
  ) {
    return
  }
  // Snapshot the counters NOW: a trailing publish runs after the window closes, by which time
  // `state` has moved on, and the label and the counts must describe the same moment.
  const turnCount = state.timing.turns
  const toolCount = state.toolCallsThisRun
  publishCoalescedActivity(ctx.session.id, () =>
    env.deps.streamRegistry.publish(ctx.userId, parentSessionId, {
      type: 'child_session.activity',
      parentSessionId,
      sessionId: ctx.session.id,
      activity,
      turnCount,
      toolCount,
    }),
  )
}

/** Compact single-line label for a child tool's result, for the NOW line. */
function compactActivityLabel(text: string): string {
  const firstLine = text.trim().split('\n')[0].trim()
  return firstLine.length > 80 ? `${firstLine.slice(0, 79)}…` : firstLine
}

export async function handleToolExecutionStart(
  ctx: TurnEventContext,
  event: EventOf<'tool_execution_start'>,
) {
  const { state, acc } = ctx
  // Count tool executions per run — did the model do any real work, used to bound a
  // model that only narrates.
  state.toolCallsThisRun += 1
  // The SHOWN arguments, not the executed ones. Results and errors have always passed the vault
  // exposure shield (`sanitizeResult`/`sanitizeError`) and arguments never did — so a `bash`
  // invocation carrying an inline credential (`PGPASSWORD=… psql`, `curl -H "X-Api-Key: …"`) was
  // persisted verbatim into `agent_messages` and streamed to every connected client. The tool has
  // already been called with the real values by the time this event arrives, so shielding here
  // cannot break execution.
  const shownInput = ctx.env.deps.sanitizeToolInput?.(ctx.userId, event.input) ?? event.input
  state.pendingTools.set(event.toolCallId, {
    name: event.toolName,
    input: shownInput,
  })
  state.toolStartTimes.set(event.toolCallId, Date.now())

  // As a tool STARTS, the NOW line reads the tool NAME ("what it's doing now").
  // handleToolExecutionEnd overwrites it with the tool's RESULT ("what it just
  // did"), so the line naturally cycles name → result → next name.
  forwardChildActivity(ctx, event.toolName)

  // Upsert the tool item to `running` with validated input (it may
  // already exist as `pending` from progressive arg-streaming).
  acc.startTool(state.currentTurnIndex, event.toolCallId, event.toolName, shownInput)
  const snapshot = setItemsPayload(state, acc.list())
  // Dispatching a MUTATING tool is forced to disk instead of riding the streaming flush
  // cadence, which persists only every ~120ms–2s. That cadence is right for narration: a
  // write per delta made tool-heavy turns quadratic-feeling. But it makes one fact a matter
  // of luck — whether the transcript remembers that a side-effecting call was in flight when
  // the process died. That is the only interruption where "send again" is not obviously safe:
  // a completed FILE edit is atomic (temp + rename, so no half-file exists and the tree is
  // either before or after), while a `bash` command's effects are
  // recorded nowhere. Read-only tools are excluded deliberately — they are the bulk of a
  // tool-heavy turn and there is nothing about them to be unsure of.
  if (ctx.mutatingToolNames?.has(event.toolName)) {
    await persistNow(ctx, snapshot)
    return
  }
  await flushOrPublish(ctx, snapshot)
}

export async function handleToolExecutionUpdate(
  ctx: TurnEventContext,
  event: EventOf<'tool_execution_update'>,
) {
  const { env, state, acc } = ctx
  // Streaming progress reaches the item and the wire BEFORE `sanitizeResult` ever runs (the pi
  // bridge calls `onUpdate` inside `execute`), so a value the final result would have redacted was
  // already on screen. Same shield, applied where the details become presentation.
  const details = env.deps.sanitizeToolInput?.(ctx.userId, event.details) ?? event.details
  if (details && typeof details === 'object') {
    // Live tool details (e.g. streamed command output) flow into the
    // item and ride the message snapshot — no separate tool.* event.
    const pendingName = state.pendingTools.get(event.toolCallId)?.name
    if (pendingName) {
      acc.updateToolDetails(event.toolCallId, pendingName, details)
      await flushOrPublish(ctx, setItemsPayload(state, acc.list()))
    }
  }
}

// An aborted/timed-out tool error is treated as a non-failure cancellation
// (the run item goes "aborted") rather than a real "failed".
function isCancelledToolError(kind: string | undefined): boolean {
  return kind === 'aborted' || kind === 'timeout'
}

export async function handleToolExecutionEnd(
  ctx: TurnEventContext,
  event: EventOf<'tool_execution_end'>,
) {
  const { env, state, acc } = ctx
  const pending = state.pendingTools.get(event.toolCallId)
  state.pendingTools.delete(event.toolCallId)
  const toolName = pending?.name ?? event.toolName
  if (
    toolName === 'configure' &&
    !event.result.isError &&
    event.result.details &&
    typeof event.result.details === 'object'
  ) {
    const details = event.result.details as Record<string, unknown>
    if (details.outcome === 'applied' && details.reload === 'next-run') {
      state.configurationReloadPending = true
    }
  }

  // Count the call. Sub-agent turns reach this same handler and are counted
  // too, which is correct: the question the counter answers is "is this tool earning its place in
  // the prompt for this scope", and a tool only a sub-agent ever reaches for is still earning it.
  recordToolUse(toolName, {
    userId: ctx.userId,
    projectId: ctx.session.projectId,
    isError: event.result.isError,
  })

  // Tool timing: full span minus any human-in-the-loop wait so the
  // displayed tool duration reflects compute, not approval latency.
  settleToolTiming(state, event.toolCallId, toolName, Date.now())

  const output = event.result.details ?? event.result.content
  // The tool's human-readable content, as a string (details/records excluded).
  const contentText = typeof event.result.content === 'string' ? event.result.content : undefined
  // Concise model-facing replay text (item.resultText) — it keeps the rich details (diffs,
  // metadata) out of the prompt on later turns — plus any returned images, stored as media.
  const { resultText, attachments } = await persistToolResultMedia(
    event.result,
    env.deps.mediaStore,
  )
  // Narrow the tool output to a record once; both still-running checks read it.
  const outputRecord =
    output && typeof output === 'object' ? (output as Record<string, unknown>) : undefined
  const backgroundStillRunning = Boolean(
    outputRecord?.isBackground && outputRecord.jobStatus === 'running',
  )
  // Terminal outcome for this tool call, shared by the child-session status and
  // the run item's end status — they differ only in the cancelled label
  // ("stopped" for the child session vs "aborted" for the item).
  const cancelled = event.result.isError && isCancelledToolError(event.result.error?.kind)
  const terminalStatus = <C extends string>(cancelledLabel: C) =>
    !event.result.isError
      ? ('completed' as const)
      : cancelled
        ? cancelledLabel
        : ('failed' as const)
  finalizeTiming(state)
  // Overwrite the child's NOW line with a compact form of the tool's RESULT so
  // the delegate card / runtime panel show "what it just did" (e.g. "Applied
  // patch to config.ts") between tools, not only the tool name at start. Skip
  // the delegate ack ("Sub-agent started.") and empty results.
  if (resultText?.trim()) {
    forwardChildActivity(ctx, compactActivityLabel(resultText))
  }
  // A still-running background job / async delegate stays `running` (its
  // final state arrives later via emitBackground / child completion); otherwise terminal.
  const endStatus: AgentItemStatus = backgroundStillRunning ? 'running' : terminalStatus('aborted')
  acc.endTool(event.toolCallId, toolName, {
    status: endStatus,
    details: event.result.details,
    resultText,
    sources: event.result.sources,
    attachments,
    errorText: event.result.isError ? contentText : undefined,
    error: event.result.error,
    // Persist the live-state supersede key so stale same-key results (e.g. old
    // preview snapshots) collapse across turns, not just within the live run.
    supersedeKey: event.result.supersedeKey,
    // Permission-gate provenance (user approval / session grant / allow rule) —
    // persisted on the item so "why did this run without asking?" survives reload.
    gate: event.provenance,
  })
  state.payload = {
    ...state.payload,
    items: acc.list(),
    timing: { ...state.timing, tools: [...state.timing.tools] },
  }
  state.currentPayload = state.payload
  await flushOrPublish(ctx, state.payload)
  publishSessionTiming(ctx)
  env.deps.hitlRegistry.clearRequest(event.toolCallId)
}
