/**
 * Async tool registry for one run: action registration (kill/send_input) and background-job
 * ownership. The stream stage (`stages/stream.ts`) builds one per run; this module wires the
 * shared owners and write lanes into `background-emitter` for live result publication.
 */
import { isToolBackedItem, type AsyncToolRegistry, type ToolAction } from '@localixai/agent/agents'

import { createOwnedItemUpdater } from './owned-item-updater'
import type { ExitNotice } from '../exit-notices'
import type { RunAsyncRegistryArgs } from './async-registry-types'
import { createBackgroundEmitter } from './background-emitter'
import { describeToolActions } from './tool-action-descriptors'

export function createRunAsyncRegistry(args: RunAsyncRegistryArgs): AsyncToolRegistry {
  const { env, state, abort, userId, session, assistantMessageId } = args
  const { actionRegistry, work } = env.state
  const owner = { userId, sessionId: session.id }
  const itemOwners = new Map<string, string>()
  const currentRow = () => state.currentPayload?.id ?? assistantMessageId
  const updateOwnedItem = createOwnedItemUpdater(env, userId, session.id)
  const actionLifecycles = new Map<string, { forgotten: boolean }>()
  /** A `notify` job's exit notice, armed as the job starts (`../exit-notices`). */
  const exitNotices = new Map<string, Promise<ExitNotice | null>>()
  const armExitNotice = (toolCallId: string) => {
    const port = env.deps.exitNotices
    if (!port) return
    exitNotices.set(
      toolCallId,
      port.arm({ userId, sessionId: session.id, source: 'bg-job' }).catch(() => null),
    )
  }

  const publishActionSnapshot = (toolCallId: string, actions?: Record<string, ToolAction>) => {
    const messageId = itemOwners.get(toolCallId) ?? assistantMessageId
    const currentItems = state.currentPayload?.items ?? []
    const descriptors = describeToolActions(toolCallId, actions)
    if (currentRow() !== messageId) {
      void updateOwnedItem(messageId, toolCallId, (item) => ({
        ...item,
        actions: descriptors,
      })).catch((error) => console.warn('[agent-runner] failed to persist tool actions', error))
      return
    }
    args.patchLiveItem?.(toolCallId, {})
    let changed = false
    const items = currentItems.map((item) => {
      if (!isToolBackedItem(item) || item.toolCallId !== toolCallId) return item
      changed = true
      return { ...item, actions: descriptors }
    })
    if (!changed) return
    state.currentPayload = { ...state.currentPayload, items }
    state.payload = state.currentPayload
    void env
      .persistAndPublish(
        userId,
        session.id,
        messageId,
        state.currentPayload,
        state.assistantCreatedAt,
      )
      .catch((error) =>
        console.warn('[agent-runner] failed to persist tool action snapshot', error),
      )
  }

  return {
    registerActions(toolCallId, actions, options) {
      itemOwners.set(toolCallId, currentRow())
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
      // across turns via the `Jobs` tool. Two kinds qualify:
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
        work.start({
          owner,
          kind: options?.kind ?? (isBackgroundStream ? 'stream' : 'job'),
          label,
          toolCallId,
          messageId: currentRow(),
          // A monitor names itself (`mon-1`) in the wake that reaches the agent; that id came
          // from this same registry's allocator, so adopting it cannot collide.
          ...(options?.jobId ? { displayId: options.jobId } : {}),
        })
        if (pendingInput?.notify === true || options?.notify) armExitNotice(toolCallId)
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
    emitBackground: createBackgroundEmitter({
      args,
      itemOwners,
      actionLifecycles,
      exitNotices,
      updateOwnedItem,
      currentRow,
    }),
  }
}
