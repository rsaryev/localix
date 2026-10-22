/**
 * Per-run teardown: fires plugin onSessionEnd hooks, deregisters live item
 * resolvers, guard-clears this run's registry entries, unsubscribes LSP, and
 * schedules the queued-wake drain. Runs in executeRun's
 * `finally` for every outcome (success/failure/abort). The continuation-guard
 * (only clear the registry entry if it still points at *this* run's abort) is the
 * delicate part and lives here so the orchestration in executeRun stays linear.
 */
import path from 'node:path'
import { rm } from 'node:fs/promises'

import type { LoadedPluginHook } from '../../../plugins/loader'
import { runSessionEndHooks } from '../../../plugins/hooks'
import type { SessionRecord } from '../../repository'
import { consoleWarnLogger } from '../plugin-hook-logger'
import type { RuntimeState } from '../agent-runner-state'
import type { RunEnv } from './types'
import { sessionAttachmentsDirRel } from './attachment-spill'

export interface RunTeardownArgs {
  env: RunEnv
  runtimeState: RuntimeState
  session: SessionRecord
  abort: AbortController
  pluginHooksForRun: readonly LoadedPluginHook[]
  runLiveResolverKeys: Set<string>
  unsubLsp: (() => void) | undefined
  /** Session cwd — used to clean up this session's spilled-attachment dir. */
  defaultCwd: string | undefined
}

export function teardownRun({
  env,
  runtimeState,
  session,
  abort,
  pluginHooksForRun,
  runLiveResolverKeys,
  unsubLsp,
  defaultCwd,
}: RunTeardownArgs): void {
  const { activeRuns, activeRunSessions, stoppedRuntimeSessionIds, liveItemResolvers } =
    runtimeState

  // Plugin onSessionEnd hooks — fired once per RUN, best-effort and
  // non-blocking (per-plugin isolation + timeout live in runSessionEndHooks).
  if (pluginHooksForRun.length > 0) {
    void runSessionEndHooks(pluginHooksForRun, {
      sessionId: session.id,
      logger: consoleWarnLogger,
    })
  }
  // Claude Code's SessionEnd is NOT fired here: a run ending is not the session ending. It fires
  // when the session really ends (`/clear`, deletion) — see agent-runner-lifecycle.ts.
  // Deregister any live item resolvers this run registered but whose child
  // hasn't completed yet (the child outlived the parent run). After this,
  // resolveParentToolItem falls back to the DB-walk path, which is still
  // correct — the run's final payload was persisted by finalizeSuccessfulRun.
  for (const key of runLiveResolverKeys) {
    liveItemResolvers.delete(key)
  }
  runLiveResolverKeys.clear()
  // Guarded cleanup: continuation paths delete this run's
  // entry and synchronously spawn a NEW run that re-registers the same
  // session id BEFORE this finally executes. An unconditional delete here
  // would remove the NEW run's AbortController — runner.stop() would then
  // silently fail to abort it and isRunning() would lie.
  const ownsSession = activeRuns.get(session.id) === abort
  if (ownsSession) {
    activeRuns.delete(session.id)
    activeRunSessions.delete(session.id)
    stoppedRuntimeSessionIds.delete(session.id)
    runtimeState.cascadeStoppedSessionIds.delete(session.id)
    // A stopped run may never emit the tool end that clears its card; settle what it still holds.
    env.deps.hitlRegistry.clearSource(session.id)
  }
  // Clean up this session's spilled-attachment dir when the run truly ends (no
  // continuation re-registered the session). The dir is session-scoped
  // (`<cwd>/.localix/attachments/<sessionId>/`), so removing it only touches THIS
  // session's files, and the next run re-materializes from history. Best-effort
  // and fire-and-forget.
  if (ownsSession && defaultCwd) {
    const dir = path.resolve(defaultCwd, sessionAttachmentsDirRel(session.id))
    void rm(dir, { recursive: true, force: true }).catch(() => {})
  }
  unsubLsp?.()
  // MCP clients are deliberately NOT disposed here — they live in the
  // process-wide mcpClientManager cache and are reused by the next run.
  // disposeAll() in shutdown() (and the manager's own invalidation on
  // config removal) own their teardown.
  // Drain wake messages queued while this run was active (sub-agent / job
  // completions). Scheduled as a microtask so it runs AFTER activeRuns was
  // cleared above — drainPendingAndRun then sees the session as idle.
  // Always ask the durable queue to drain. On restart its in-memory mirror may
  // not have hydrated yet; the async drain owns that startup barrier.
  queueMicrotask(() => {
    void env.drainPendingAndRun(session.id)
  })
}
