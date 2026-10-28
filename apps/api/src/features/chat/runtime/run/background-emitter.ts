/** Sanitizes and publishes cumulative background output, then settles its work and exit notice. */
import {
  isToolBackedItem,
  isToolCallItem,
  type AgentItemStatus,
  type AsyncToolRegistry,
  type ToolBackedItem,
} from '@localixai/agent/agents'
import { buildToolItem } from '../items'
import { backgroundJobFinishedReminder, backgroundJobOutcome } from '../mid-run-reminders'
import { wrapDelegatedWake } from '../wake-envelope'
import type { ExitNotice } from '../exit-notices'
import { workStatusOfJob } from '../../../work/contracts'
import type { createOwnedItemUpdater } from './owned-item-updater'
import type { RunAsyncRegistryArgs } from './async-registry-types'
import { describeToolActions } from './tool-action-descriptors'

interface BackgroundEmitterContext {
  args: RunAsyncRegistryArgs
  itemOwners: ReadonlyMap<string, string>
  actionLifecycles: ReadonlyMap<string, { forgotten: boolean }>
  exitNotices: Map<string, Promise<ExitNotice | null>>
  /** Share the action writer's serialized lanes when patching a sealed message row. */
  updateOwnedItem: ReturnType<typeof createOwnedItemUpdater>
  currentRow: () => string
}

export function createBackgroundEmitter({
  args,
  itemOwners,
  actionLifecycles,
  exitNotices,
  updateOwnedItem,
  currentRow,
}: BackgroundEmitterContext): AsyncToolRegistry['emitBackground'] {
  const { env, state, userId, session, assistantMessageId } = args
  const { actionRegistry, work } = env.state
  // Background producers report cumulative output. Publishing the whole assistant
  // message on every producer tick amplifies one growing command into O(total
  // message size × tick rate) websocket traffic. Keep one shared resync cadence for
  // the run and ship monotonic output growth as addressed item appends in between.
  const BACKGROUND_SNAPSHOT_RESYNC_MS = 1000
  let lastBackgroundSnapshotAt = 0
  const publishedOutputs = new Map<string, { value: string; key?: string }>()

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

  return function emitBackground(toolCallId, rawOutput, rawOpts) {
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
    // The item is the CALL that started the job, and that call succeeded: a job later stopped
    // (by the agent, the person, its own timeout, or a stop signal) did what it was asked until
    // then. `aborted` read as "this tool call was cancelled"; the job's own outcome rides
    // `details.jobStatus`. Only a job that exited non-zero on its own failed; a job with no
    // process (a workflow) says how it ended through `jobStatus` alone.
    const itemStatus: AgentItemStatus = !done
      ? 'running'
      : jobStatus === 'completed' ||
          jobStatus === 'killed' ||
          jobStatus === 'timeout' ||
          opts?.exitCode === 0
        ? 'completed'
        : 'failed'
    // Rebuild the background tool's item with the latest output (live on every
    // flush, terminal on done) — it rides the message snapshot, no tool.* event.
    const messageId = itemOwners.get(toolCallId) ?? assistantMessageId
    const ownsCurrentRow = currentRow() === messageId
    const rebuild = (it: ToolBackedItem) => {
      const details = {
        ...opts?.details,
        output,
        isStreaming: !done,
        isBackground: true,
        exitCode: opts?.exitCode,
        wallTimeMs: opts?.wallTimeMs,
        jobStatus,
      }
      if (ownsCurrentRow)
        args.patchLiveItem?.(toolCallId, {
          status: itemStatus,
          details,
          ...(done ? { resultText: output } : {}),
        })
      const rebuilt = buildToolItem({
        ...it,
        toolCallId,
        name: it.name,
        status: itemStatus,
        input: it.input,
        details,
        resultText: done ? output : it.resultText,
        standalone: it.standalone,
        presentation: it.presentation,
        actions: describeToolActions(toolCallId, actionRegistry.get(toolCallId)?.actions),
        activeVerb: isToolCallItem(it) ? it.activeVerb : 'Running',
      })
      if (!ownsCurrentRow) {
        const value = (rebuilt as { output?: unknown }).output
        if (typeof value === 'string') publishedOutputs.set(toolCallId, { value })
        else if (
          value &&
          typeof value === 'object' &&
          'output' in value &&
          typeof value.output === 'string'
        )
          publishedOutputs.set(toolCallId, { value: value.output, key: 'output' })
      }
      return rebuilt
    }
    if (ownsCurrentRow) {
      const updatedItems = (state.currentPayload.items ?? []).map((it) =>
        isToolBackedItem(it) && it.toolCallId === toolCallId ? rebuild(it) : it,
      )
      state.currentPayload = { ...state.currentPayload, items: updatedItems }
      state.payload = state.currentPayload
    }
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
      if (ownsCurrentRow) rememberPublishedOutputs()
      // `bun` kills the process on an unhandled rejection and this app installs no
      // handler, so a fire-and-forget DB write MUST carry its own catch — one failed
      // snapshot would otherwise take down every session in the process. Warn and carry
      // on: the next snapshot rewrites the same row, so a lost one costs freshness, not
      // data. (`createKeyedSerializer` protects the chain, not the returned promise.)
      const snapshot = ownsCurrentRow
        ? env.persistAndPublish(
            userId,
            session.id,
            messageId,
            state.currentPayload,
            state.assistantCreatedAt,
          )
        : updateOwnedItem(messageId, toolCallId, rebuild)
      void snapshot.catch((error) =>
        console.warn('[agent-runner] failed to persist background snapshot', error),
      )
    } else if (canAppend) {
      env.deps.streamRegistry.publish(userId, session.id, {
        type: 'message.delta',
        sessionId: session.id,
        messageId,
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
          session.id,
          backgroundJobFinishedReminder(
            cmd,
            opts?.exitCode ?? undefined,
            toolCallId,
            args.recoveryToolAvailable,
            jobStatus,
            opts?.stop,
          ),
        )
      const notice = exitNotices.get(toolCallId)
      exitNotices.delete(toolCallId)
      // A killed job is not news the caller waits for: the model stopped it (`TaskStop`) or
      // the user did (the Stop button), and either already knows. A wake here bought one
      // whole model turn to acknowledge "yes, it stopped" — measured on a probe session.
      if (opts?.notify && jobStatus !== 'killed') {
        // notify: the job's exit is its armed notice's one fire — a new turn, so the agent
        // reacts without hanging. A notice that could not be armed degrades to the reminder.
        const content = wrapDelegatedWake(
          // The outcome in words, as the mid-run note has it: a bare `exit=143` read as a result.
          `[Background job ended: ${cmd}] It ${backgroundJobOutcome(opts?.exitCode, jobStatus, opts?.stop)}.\n\n${output}`,
        )
        void (notice ?? Promise.resolve(null)).then((armed) =>
          armed ? armed.fire(content) : remind(),
        )
      } else {
        void notice?.then((armed) => armed?.dismiss(jobStatus))
        // The agent's own `TaskStop` already answered it: a reminder repeating it is noise.
        if (opts?.stop?.by !== 'agent') remind()
      }
    }
  }
}
