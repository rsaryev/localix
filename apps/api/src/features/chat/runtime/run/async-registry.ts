/**
 * Async tool registry for one run: action registration (kill/send_input),
 * background-job tracking, external child sessions and the emitBackground
 * live-update path that rebuilds the background tool's item in place. The stream stage
 * (`stages/stream.ts`) builds one per run; this module owns the AsyncToolRegistry wiring.
 */
import {
  isToolBackedItem,
  isToolCallItem,
  type AgentItemStatus,
  type AsyncToolRegistry,
  type ToolAction,
  type ToolActionDescriptor,
} from '@localixai/agent/agents'

import type { SessionRecord } from '../../repository'
import { buildToolItem } from '../items'
import { backgroundJobFinishedReminder } from '../mid-run-reminders'
import type { RunTurnState } from './turn-state'
import type { RunEnv } from './types'
import { wrapDelegatedWake } from '../wake-envelope'
import type { ExitNotice } from '../exit-notices'
import { workStatusOfJob, type WorkRecord } from '../../../work/contracts'

/** Strip executable callbacks before live actions cross the server/UI boundary. */
export function describeToolActions(
  toolCallId: string,
  actions: Record<string, ToolAction> | undefined,
): ToolActionDescriptor[] | undefined {
  if (!actions) return undefined
  return Object.entries(actions).map(([action, descriptor]) => ({
    toolCallId,
    action,
    label: descriptor.label,
    icon: descriptor.icon,
    enabled: descriptor.enabled,
    tone: descriptor.tone,
  }))
}

export function createRunAsyncRegistry(args: {
  env: RunEnv
  state: RunTurnState
  abort: AbortController
  userId: string
  session: SessionRecord
  /**
   * The participant whose run this is: a job's mid-run note and its exit notice go back to it,
   * not its colleagues.
   */
  agentId: string
  assistantMessageId: string
  /** Tool names that declared `background: true` — drives stream-job detection generically. */
  backgroundToolNames: ReadonlySet<string>
  /** Final model roster result for context-recovery reminder wording. */
  recoveryToolAvailable?: boolean
}): AsyncToolRegistry {
  const { env, state, abort, userId, session, agentId, assistantMessageId } = args
  const { actionRegistry, work } = env.state
  const owner = { userId, sessionId: session.id }
  // Background producers report cumulative output. Publishing the whole assistant
  // message on every producer tick amplifies one growing command into O(total
  // message size × tick rate) websocket traffic. Keep one shared resync cadence for
  // the run and ship monotonic output growth as addressed item appends in between.
  const BACKGROUND_SNAPSHOT_RESYNC_MS = 1000
  let lastBackgroundSnapshotAt = 0
  const publishedOutputs = new Map<string, { value: string; key?: string }>()
  const actionLifecycles = new Map<string, { forgotten: boolean }>()
  /**
   * A `notify` job's exit notice, ARMED AS THE JOB STARTS rather than sent when it ends: the
   * process may die with the server, and then only an armed notice still owes the agent the one
   * wake it was promised (`../exit-notices`).
   */
  const exitNotices = new Map<string, Promise<ExitNotice | null>>()
  const armExitNotice = (toolCallId: string, record: WorkRecord) => {
    const port = env.deps.exitNotices
    if (!port) return
    const restartNotice = wrapDelegatedWake(
      `[Background job ${record.displayId} lost: ${record.label}] The server restarted while it ran, so it was stopped and how it ended is unknown. Check what it was doing before relying on its result.`,
    )
    exitNotices.set(
      toolCallId,
      port
        .arm({ userId, sessionId: session.id, agentId, source: 'bg-job', restartNotice })
        .catch(() => null),
    )
  }

  const publishActionSnapshot = (toolCallId: string, actions?: Record<string, ToolAction>) => {
    const currentItems = state.currentPayload?.items ?? []
    const descriptors = describeToolActions(toolCallId, actions)
    let changed = false
    const items = currentItems.map((item) => {
      if (!isToolBackedItem(item) || item.toolCallId !== toolCallId) return item
      changed = true
      return { ...item, actions: descriptors }
    })
    if (!changed) return
    state.currentPayload = { ...state.currentPayload, items }
    void env
      .persistAndPublish(
        userId,
        session.id,
        assistantMessageId,
        state.currentPayload,
        state.assistantCreatedAt,
      )
      .catch((error) =>
        console.warn('[agent-runner] failed to persist tool action snapshot', error),
      )
  }

  const rememberPublishedOutputs = () => {
    for (const item of state.currentPayload.items ?? []) {
      if (!isToolBackedItem(item)) continue
      const output = (item as { output?: unknown }).output
      if (typeof output === 'string') {
        publishedOutputs.set(item.id, { value: output })
        continue
      }
      if (output && typeof output === 'object' && !Array.isArray(output)) {
        const nested = (output as { output?: unknown }).output
        if (typeof nested === 'string') {
          publishedOutputs.set(item.id, { value: nested, key: 'output' })
        }
      }
    }
  }

  return {
    registerActions(toolCallId, actions, options) {
      // Tag the owner HERE, where it is known. Sourcing it from `backgroundJobs`
      // below only covered the subset that lands there; the interact gate needs an
      // owner for EVERY registrant.
      const lifecycle = { forgotten: false }
      actionLifecycles.set(toolCallId, lifecycle)
      actionRegistry.set(toolCallId, {
        userId,
        sessionId: session.id,
        actions,
        lifecycle,
      })
      publishActionSnapshot(toolCallId, actions)
      // Record manageable background jobs so the model can list + stop them
      // across turns via the `jobs` tool. Two kinds qualify:
      //   - background bash: registers kill + send_input
      //   - declared background tools (e.g. a live data stream): register kill only
      // Sub-agents (delegate) also register kill only, but they are managed
      // separately (they surface as child sessions), so they stay excluded —
      // we distinguish a background stream by the tool's declared `background`
      // flag, not its action set or a hardcoded name.
      const pendingName = state.pendingTools.get(toolCallId)?.name
      const isBackgroundStream = pendingName ? args.backgroundToolNames.has(pendingName) : false
      // A registrant that NAMES its job is declaring itself one. That is how work with no
      // process and no stdin — a call promoted for outrunning its budget — becomes visible to
      // `jobs`, counts toward the per-session cap, and can be stopped, instead of being an
      // opaque wait with an action nobody can find.
      if (actions.kill && (actions.send_input || isBackgroundStream || options?.label)) {
        const pendingInput = state.pendingTools.get(toolCallId)?.input as
          | { command?: string; file_path?: string; channel?: string; notify?: boolean }
          | undefined
        // The registrant's own label wins. Guessing from the call's arguments works for a
        // shell command and produced the placeholder "background job" for everything else.
        const label =
          options?.label ??
          (isBackgroundStream
            ? `stream → ${pendingInput?.file_path ?? 'job'}${pendingInput?.channel ? ` [${pendingInput.channel}]` : ''}`
            : (pendingInput?.command ?? `${pendingName ?? 'tool'} job`))
        const record = work.start({
          owner,
          agentId,
          kind: options?.kind ?? (isBackgroundStream ? 'stream' : 'job'),
          label,
          toolCallId,
          messageId: assistantMessageId,
          // A monitor names itself (`mon-1`) in the wake that reaches the agent; that id came
          // from this same registry's allocator, so adopting it cannot collide.
          ...(options?.jobId ? { displayId: options.jobId } : {}),
        })
        if (pendingInput?.notify === true) armExitNotice(toolCallId, record)
      }
      return () => {
        actionRegistry.delete(toolCallId)
        // A handle that goes away without having reported an end was stopped.
        work.release(toolCallId)
        publishActionSnapshot(toolCallId)
        // A session-forget kill may synchronously invoke this disposer before
        // the process reports its terminal result. Retain that one tombstone in
        // this run-scoped closure so the late emit is still suppressed.
        if (!lifecycle.forgotten) actionLifecycles.delete(toolCallId)
      }
    },
    getActions(toolCallId) {
      // The owner tag is a HOST concern (the interact gate); the SDK contract is
      // the actions themselves, so it never leaves this module.
      return actionRegistry.get(toolCallId)?.actions
    },
    /** Live jobs owned by THIS session — the gate's occupancy, read off the same
     *  records the jobs tool lists, so the two can never disagree. */
    countBackgroundJobs() {
      return work.count(owner)
    },
    getBackgroundJobId(toolCallId) {
      return work.get(toolCallId)?.displayId
    },
    setBackgroundJobTerminalId(toolCallId, terminalId) {
      if (terminalId) work.setTerminal(toolCallId, terminalId)
    },
    abortSession() {
      abort.abort('killed-by-user')
    },
    // External-agent child sessions — implementation lives in
    // child-sessions.ts (createChildSessionManager).
    emitBackground(toolCallId, rawOutput, rawOpts) {
      // Deleting an idle session kills jobs that intentionally outlived their
      // spawning run. Process exit still resolves afterward and producers emit
      // one final update; accepting it would repopulate reminders and persist to
      // a message/session row that is being deleted.
      if (actionLifecycles.get(toolCallId)?.forgotten) return

      // A background job is the ONE tool shape whose output never crosses a result boundary: the
      // `bash` call returns a job id immediately, and everything after that arrives here and goes
      // straight to the DB and the wire. So `sanitizeToolResult` never runs on it, and this writer
      // bypasses the item accumulator's sanitizer too (it rebuilds the item with `buildToolItem`
      // rather than going through `setTool`). Both halves are shielded HERE, at the top, so every
      // path below — the snapshot, the `message.delta` append, and the `notify` wake turn — sees only
      // the redacted text. `bash-background.ts` passes `details.command` as the EXECUTED command, and
      // `buildToolItem` prefers it over the (already shielded) item input.
      //
      // Sanitizing before the delta bookkeeping is deliberate: `publishedOutputs` then holds the
      // redacted string, so a secret split across two flushes cannot slip through as an append —
      // the prefix check simply fails and the code falls back to a full snapshot.
      const shield = env.deps.sanitizeToolInput
      const output = shield ? ((shield(userId, rawOutput) as string | undefined) ?? '') : rawOutput
      const opts =
        rawOpts?.details && shield
          ? { ...rawOpts, details: shield(userId, rawOpts.details) as typeof rawOpts.details }
          : rawOpts
      // Capture the PTY terminal id (first flush carries it) so `jobs action="read"`
      // can map a job_id back to its terminal scrollback.
      const terminalId = (opts?.details as { terminalId?: string } | undefined)?.terminalId
      if (terminalId) work.setTerminal(toolCallId, terminalId)
      const done = opts?.done === true
      const jobStatus =
        opts?.jobStatus ?? (done ? (opts?.exitCode === 0 ? 'completed' : 'failed') : 'running')
      const itemStatus: AgentItemStatus = !done
        ? 'running'
        : jobStatus === 'killed' || jobStatus === 'timeout'
          ? 'aborted'
          : opts?.exitCode === 0
            ? 'completed'
            : 'failed'
      // Rebuild the background tool's item with the latest output (live on every
      // flush, terminal on done) — it rides the message snapshot, no tool.* event.
      const updatedItems = (state.currentPayload.items ?? []).map((it) =>
        isToolBackedItem(it) && it.toolCallId === toolCallId
          ? buildToolItem({
              toolCallId,
              name: it.name,
              status: itemStatus,
              input: it.input,
              details: {
                ...opts?.details,
                output,
                isStreaming: !done,
                isBackground: true,
                exitCode: opts?.exitCode,
                wallTimeMs: opts?.wallTimeMs,
                jobStatus,
              },
              resultText: done ? output : it.resultText,
              standalone: it.standalone,
              presentation: it.presentation,
              actions: describeToolActions(toolCallId, actionRegistry.get(toolCallId)?.actions),
              activeVerb: isToolCallItem(it) ? it.activeVerb : 'Running',
            })
          : it,
      )
      state.currentPayload = { ...state.currentPayload, items: updatedItems }
      const nowMs = Date.now()
      const previousOutput = publishedOutputs.get(toolCallId)
      const canAppend =
        !done &&
        previousOutput !== undefined &&
        output.length > previousOutput.value.length &&
        output.startsWith(previousOutput.value)
      const snapshotDue =
        done ||
        lastBackgroundSnapshotAt === 0 ||
        nowMs - lastBackgroundSnapshotAt >= BACKGROUND_SNAPSHOT_RESYNC_MS ||
        (previousOutput !== undefined && output !== previousOutput.value && !canAppend)

      if (snapshotDue) {
        lastBackgroundSnapshotAt = nowMs
        rememberPublishedOutputs()
        // `bun` kills the process on an unhandled rejection and this app installs no
        // handler, so a fire-and-forget DB write MUST carry its own catch — one failed
        // snapshot would otherwise take down every session in the process. Warn and carry
        // on: the next snapshot rewrites the same row, so a lost one costs freshness, not
        // data. (`createKeyedSerializer` protects the chain, not the returned promise.)
        void env
          .persistAndPublish(
            userId,
            session.id,
            assistantMessageId,
            state.currentPayload,
            state.assistantCreatedAt,
          )
          .catch((error) =>
            console.warn('[agent-runner] failed to persist background snapshot', error),
          )
      } else if (canAppend) {
        env.deps.streamRegistry.publish(userId, session.id, {
          type: 'message.delta',
          sessionId: session.id,
          messageId: assistantMessageId,
          itemAppends: [
            {
              itemId: toolCallId,
              slot: 'output',
              ...(previousOutput.key ? { key: previousOutput.key } : {}),
              append: output.slice(previousOutput.value.length),
            },
          ],
        })
        publishedOutputs.set(toolCallId, { ...previousOutput, value: output })
      }
      if (done) {
        const cmd =
          work.end(toolCallId, {
            status: workStatusOfJob(jobStatus),
            exitCode: opts?.exitCode ?? null,
            // The same condition the notify wake below is sent on: that turn reports this end.
            wakesAgent: opts?.notify === true && jobStatus !== 'killed',
          })?.label ?? 'background job'
        // Without notify, completion used to be SILENT: the wake channel is the only one this
        // path had, and the agent must not be interrupted by a job it didn't ask to be notified
        // about. So its only way to learn the job ended was to poll `jobs` — the very sleep-loop
        // the background-jobs reminder forbids. Queue a note instead: it rides the agent's next
        // tool result mid-turn, costs a line, and carries no output — only a pointer to the copy
        // the `persistAndPublish` above just stored on this item.
        const remind = () =>
          env.queueMidRunReminder(
            { sessionId: session.id, agentId },
            backgroundJobFinishedReminder(
              cmd,
              opts?.exitCode ?? undefined,
              toolCallId,
              args.recoveryToolAvailable,
              jobStatus,
            ),
          )
        const notice = exitNotices.get(toolCallId)
        exitNotices.delete(toolCallId)
        // A killed job is not news the caller waits for: the model stopped it (`jobs stop`) or
        // the user did (the Stop button), and either already knows. A wake here bought one
        // whole model turn to acknowledge "yes, it stopped" — measured on a probe session.
        if (opts?.notify && jobStatus !== 'killed') {
          // notify: the job's exit is its armed notice's one fire — a new turn, so the agent
          // reacts without hanging. A notice that could not be armed degrades to the reminder.
          const content = wrapDelegatedWake(
            `[Background job finished: ${cmd}] exit=${opts?.exitCode ?? '?'}\n\n${output}`,
          )
          void (notice ?? Promise.resolve(null)).then((armed) =>
            armed ? armed.fire(content) : remind(),
          )
        } else {
          void notice?.then((armed) => armed?.dismiss(jobStatus))
          remind()
        }
      }
    },
  }
}
