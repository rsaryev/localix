/**
 * The monitor SERVICE: start a watch, stop it, read what it saw — and, at boot, take back the
 * watches a restart resumed.
 *
 * It holds no registry of its own any more. A monitor is a TRIGGER (`./record`: when it fires and
 * with what) and a WORK record (`features/work`: that it runs, what it has seen, how it ended).
 * The process-wide map this replaced filtered by owner in every accessor, minted ids with its own
 * scope, and forgot every watch on restart; the trigger engine and the work registry each already
 * answer one of those questions durably, behind one owner filter.
 *
 * What stays here is what only a running process has: the `watch` mode's live command (a stream
 * trigger's source, with its batcher and deadline — `./runner`), and validation at start, where a
 * refusal is a sentence the model can act on rather than a watch that never fires.
 */
import type { TriggerEngine } from '../triggers/engine'
import type { WorkRegistry } from '../work/registry'
import { validateCondition } from './conditions'
import { MONITOR_MAX_PER_SESSION, type MonitorEndReason, type MonitorSpec } from './contracts'
import type { MonitorCredentials } from './credentials'
import { MONITOR_ACTION, monitorLabel, monitorPayload, type MonitorPayload } from './record'
import type { MonitorHooks, MonitorReport } from './report'
import { startMonitorRun, type MonitorRun, type MonitorRunDeps } from './runner'
import type { SecretPreflight } from './secrets'
import { createCommandSource } from './sources/command'
import { nativeBackgroundSpawn } from './sources/native'
import type { BackgroundSpawn, MonitorSource } from './sources'

/** Who started the monitor, and the tool call whose card shows it. */
export interface MonitorOwner {
  userId: string
  sessionId: string
  agentId: string
  toolCallId: string
}

export type MonitorStartResult =
  | { ok: true; id: string; label: string }
  | { ok: false; error: string }

export interface MonitorServiceDeps {
  triggers: Pick<TriggerEngine, 'arm' | 'end' | 'emit' | 'get' | 'list'>
  work: Pick<WorkRegistry, 'mint' | 'adopt'>
  report: MonitorReport
  credentials: MonitorCredentials
  spawn?: BackgroundSpawn
  /** Test seam: supply a `watch` source instead of spawning anything. */
  createSource?: (payload: MonitorPayload, executable: string) => MonitorSource
  /** Batcher/deadline tuning, so a test does not wait out real windows or timeouts. */
  tuning?: Pick<
    MonitorRunDeps,
    'batchWindowMs' | 'rateWindowMs' | 'maxPerWindow' | 'setTimer' | 'clearTimer'
  >
  now?: () => number
  logger?: { warn: (msg: string) => void }
}

type Prepared = Extract<SecretPreflight, { ok: true }>

export function createMonitorService(deps: MonitorServiceDeps) {
  const { triggers, report } = deps
  const now = deps.now ?? Date.now
  const spawn = deps.spawn ?? nativeBackgroundSpawn
  const warn = (msg: string) => deps.logger?.warn(msg)
  /** The live command of each `watch` monitor, by trigger id. Absent ⇒ it is not ours to end. */
  const runs = new Map<string, { sessionId: string; run: MonitorRun }>()

  const monitorsOf = (userId: string, sessionId: string) =>
    triggers.list({ userId, sessionId, action: MONITOR_ACTION })
  const find = (userId: string, sessionId: string, displayId: string) =>
    monitorsOf(userId, sessionId).find((t) => monitorPayload(t).displayId === displayId)

  /** A stop: end the trigger, then close the card — never a wake, the person already knows. */
  const stopped = async (triggerId: string, reason: MonitorEndReason) => {
    const trigger = triggers.get(triggerId)
    deps.credentials.forget(triggerId)
    if (!trigger) return
    const ended = await triggers.end(triggerId, reason)
    if ('error' in ended) warn(ended.error)
    await report.ended(trigger, { reason }, null)
  }

  /** `watch`: the command's lines become the stream trigger's events. */
  const startWatch = (
    triggerId: string,
    sessionId: string,
    payload: MonitorPayload,
    prepared: Prepared,
    timeoutMs: number | null,
  ) => {
    const source =
      deps.createSource?.(payload, prepared.executable) ??
      createCommandSource({
        command: prepared.executable,
        cwd: payload.cwd,
        spawn,
        ...(payload.pathPrefix ? { pathPrefix: payload.pathPrefix } : {}),
        ...(Object.keys(prepared.env).length > 0 ? { env: prepared.env } : {}),
      })
    const emit = (event: Record<string, unknown>) =>
      void triggers.emit(triggerId, event).then((refused) => refused && warn(refused))
    const run = startMonitorRun({
      source,
      timeoutMs,
      ...deps.tuning,
      onEvents: (events) => emit({ events }),
      onEnd: (reason, detail, events) => {
        // Not in `runs` any more ⇒ a shutdown or a deleted session took it: leave the trigger
        // as it is, for the next boot's recovery (or the cascade) to settle.
        if (!runs.delete(triggerId)) return
        deps.credentials.forget(triggerId)
        if (reason === 'killed') return void stopped(triggerId, reason)
        emit({ events, ended: { reason, ...(detail ? { detail } : {}) } })
      },
    })
    runs.set(triggerId, { sessionId, run })
  }

  return {
    async start(
      owner: MonitorOwner,
      spec: MonitorSpec,
      hooks?: MonitorHooks,
    ): Promise<MonitorStartResult> {
      if (!spec.watch && !spec.until)
        return { ok: false, error: 'A monitor needs either `watch` or `until`.' }
      if (spec.until) {
        const invalid = validateCondition(spec.until.when)
        if (invalid) return { ok: false, error: invalid }
      }
      const running = monitorsOf(owner.userId, owner.sessionId)
      if (running.length >= MONITOR_MAX_PER_SESSION) {
        return {
          ok: false,
          error: `This session already has ${running.length} monitors running (the limit). Stop one with jobs action="stop" before starting another: ${running
            .map((t) => `${monitorPayload(t).displayId} (${monitorPayload(t).description})`)
            .join(', ')}`,
        }
      }

      const displayId = deps.work.mint(owner, 'monitor')
      // The command as WRITTEN — `${secret:KEY}` intact. The only form anything ever shows.
      const command = spec.until?.check ?? spec.watch ?? ''
      const prepared = await deps.credentials.prepare(
        owner.userId,
        { command, displayId },
        Boolean(spec.watch) && spec.timeoutMs === null,
      )
      if (!prepared.ok) return { ok: false, error: prepared.error }
      const payload: MonitorPayload = {
        mode: spec.until ? 'until' : 'watch',
        description: spec.description,
        command,
        cwd: spec.cwd,
        ...(spec.pathPrefix ? { pathPrefix: spec.pathPrefix } : {}),
        ...(prepared.keys.length > 0 ? { secretKeys: prepared.keys } : {}),
        ...(spec.until ? { when: spec.until.when, emit: spec.until.emit } : {}),
        displayId,
        toolCallId: owner.toolCallId,
      }
      const expiresAt =
        spec.timeoutMs === null ? null : new Date(now() + spec.timeoutMs).toISOString()
      const armed = await triggers.arm({
        userId: owner.userId,
        sessionId: owner.sessionId,
        owner: { kind: 'agent', agentId: owner.agentId },
        action: MONITOR_ACTION,
        // A watch's deadline is its run's (`./runner`): the process it ends dies with the server.
        ...(spec.until
          ? { kind: 'poll', spec: { everySeconds: spec.until.everySeconds, expiresAt } }
          : { kind: 'stream', spec: {} }),
        payload: { ...payload },
      })
      if ('error' in armed) return { ok: false, error: armed.error }
      deps.credentials.remember(armed.id, prepared)
      if (hooks) report.attach(armed.id, hooks)
      if (spec.watch) startWatch(armed.id, owner.sessionId, payload, prepared, spec.timeoutMs)
      return { ok: true, id: displayId, label: monitorLabel(payload) }
    },

    /** Stop one monitor the caller owns. False when there is no such running monitor. */
    stop(userId: string, sessionId: string, displayId: string): boolean {
      const trigger = find(userId, sessionId, displayId)
      if (!trigger) return false
      const live = runs.get(trigger.id)
      // A watch ends through its run, so the lines it already batched join the ending.
      if (live) live.run.stop('killed')
      else void stopped(trigger.id, 'killed')
      return true
    },

    /** Recent events for `jobs action="read"` — a monitor has no PTY scrollback. */
    read(userId: string, sessionId: string, displayId: string): { text: string } | null {
      if (!find(userId, sessionId, displayId)) return null
      return { text: report.log(sessionId, displayId) ?? '' }
    },

    /**
     * Once at boot, after the triggers loaded: every monitor the restart resumed takes its work
     * back. One whose work never reached a row has nothing to report into, so it ends.
     */
    async resume(): Promise<void> {
      for (const trigger of triggers.list({ action: MONITOR_ACTION })) {
        if (deps.work.adopt(monitorPayload(trigger).toolCallId)) continue
        const ended = await triggers.end(trigger.id, 'orphaned')
        if ('error' in ended) warn(ended.error)
      }
    },

    /** A deleted session must not leave a watch running against it. Its rows cascade. */
    stopAllForSession(sessionId: string): void {
      for (const [id, live] of runs)
        if (live.sessionId === sessionId) {
          runs.delete(id)
          live.run.stop('killed')
        }
    },

    /**
     * Shutdown: kill every live command. The triggers stay as they are — the next boot ends the
     * watches with `restart` and tells their owners, and resumes the polled waits.
     */
    disposeAll(): void {
      const live = [...runs.values()]
      runs.clear()
      for (const { run } of live) run.stop('killed')
    },
  }
}

export type MonitorService = ReturnType<typeof createMonitorService>
