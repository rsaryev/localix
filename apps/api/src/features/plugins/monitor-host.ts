import { withTimeout } from '../../lib/timeout'
import { errorMessage } from '../../lib/errors'

import { monitorsToLaunch, type MonitorLaunch } from './kit'
import {
  MAX_LINES_PER_WINDOW,
  createRateGate,
  defaultSpawn,
  pumpLines,
  type MonitorProc,
} from './monitor-stream'

export type { MonitorProc, MonitorSpawner } from './monitor-stream'
export type {
  ChatSessionMoved,
  MonitorNotification,
  PluginMonitorHost,
  PluginMonitorHostOptions,
} from './monitor-host-types'
import type {
  ChatSessionMoved,
  PluginMonitorHost,
  PluginMonitorHostOptions,
} from './monitor-host-types'

/**
 * The host of plugin background MONITORS (Claude Code `monitors`, experimental): long-running
 * commands whose every stdout line reaches the model as a notification. A monitor belongs to a
 * chat, as it belongs to a session in Claude Code: the chat's kit session decides which to start
 * and when (`kit/monitors.ts`: its `always` ones when it opens, an `on-skill-invoke` one once its
 * skill ran, each once, none of a plugin the agent did not select), this host spawns them in the
 * session's folder with the environment the kit gave, sends their lines to the chat, and stops
 * them when the chat ends. A plugin turned off meanwhile keeps its running monitors until then,
 * as Claude Code does.
 *
 * Delivery seam: the host does not know how a line reaches the model; it calls the injected
 * {@link PluginMonitorHostOptions.deliver}, which boot wiring binds to the shared wake primitive.
 * A per-monitor rate cap (monitor-stream) keeps a chatty stream from flooding it.
 */

const MONITOR_STOP_GRACE_MS = 3_000

interface RunningMonitor {
  key: string
  proc: MonitorProc
  controller: AbortController
  done: Promise<void>
}

export function createPluginMonitorHost(options: PluginMonitorHostOptions): PluginMonitorHost {
  const { deliver, logger } = options
  const spawn = options.spawn ?? defaultSpawn
  const now = options.now ?? (() => Date.now())
  /**
   * The running monitors of each chat, by `<plugin id>:<monitor>`. A chat's sub-agent runs in a
   * kit session of its own, which hands out the chat's `always` monitors again: one runs once.
   */
  const chats = new Map<string, Map<string, RunningMonitor>>()
  let lifecycle: Promise<void> = Promise.resolve()

  const enqueue = (task: () => Promise<void>): Promise<void> => {
    lifecycle = lifecycle.catch(() => undefined).then(task)
    return lifecycle
  }

  function startMonitor(launch: MonitorLaunch, moved: ChatSessionMoved): RunningMonitor {
    const { pluginName, name } = launch
    const key = `${pluginName}:${name}`
    const controller = new AbortController()
    const proc = spawn(launch.command, { cwd: launch.cwd, env: { ...launch.env } })
    const gate = createRateGate(now, () =>
      logger?.warn(`monitor "${key}" exceeded ${MAX_LINES_PER_WINDOW} lines/s — dropping excess`),
    )
    const done = pumpLines(proc, controller.signal, (line) => {
      if (controller.signal.aborted || !gate(line)) return
      const { userId, chatId } = moved
      deliver({
        userId,
        chatId,
        pluginName,
        monitorName: name,
        description: launch.description,
        line,
      })
    })
      // Output ending without a stop is the monitor dying — it was silent, so a watcher that
      // exited on its first line looked exactly like one with nothing to say.
      .then(async () => {
        if (controller.signal.aborted) return
        const code = await proc.exited.catch(() => null)
        if (controller.signal.aborted) return
        logger?.warn(`monitor "${key}" stopped`, { exitCode: code })
        options.conditions?.monitorStopped(
          pluginName,
          name,
          code === null ? 'Its command ended.' : `Its command exited with code ${code}.`,
        )
      })
    logger?.info?.(`monitor started: ${key}`)
    options.conditions?.monitorStarted(pluginName, name)
    return { key, proc, controller, done }
  }

  async function stopRunning(stopping: readonly RunningMonitor[]): Promise<void> {
    for (const running of stopping) {
      running.controller.abort()
      try {
        running.proc.kill()
      } catch {
        /* already gone */
      }
    }
    await withTimeout(
      Promise.all(stopping.map((r) => Promise.all([r.done, r.proc.exited.catch(() => 0)]))),
      MONITOR_STOP_GRACE_MS,
    ).catch(() => {})
  }

  async function launch(moved: ChatSessionMoved): Promise<void> {
    const session = options.sessionOf(moved.sessionId)
    if (!session) return
    const { launches, problems } = await monitorsToLaunch(session)
    for (const problem of problems) logger?.warn(`plugin monitor not started: ${problem}`)
    const running = chats.get(moved.chatId) ?? new Map<string, RunningMonitor>()
    chats.set(moved.chatId, running)
    for (const one of launches) {
      const id = `${one.pluginId}:${one.name}`
      // A sub-agent's session hands out what its chat runs (the reopened chat's does not: its ledger).
      if (running.has(id)) continue
      try {
        running.set(id, startMonitor(one, moved))
      } catch (error) {
        logger?.warn(`monitor "${one.pluginName}:${one.name}" did not start`, errorMessage(error))
        options.conditions?.monitorStopped(
          one.pluginName,
          one.name,
          `Its command did not start: ${errorMessage(error)}`,
        )
      }
    }
  }

  async function end(chatId: string): Promise<void> {
    const running = chats.get(chatId)
    chats.delete(chatId)
    if (running) await stopRunning([...running.values()])
  }

  return {
    sessionMoved: (moved) => enqueue(() => launch(moved)),
    endChat: (chatId) => enqueue(() => end(chatId)),
    stop: () => enqueue(async () => void (await Promise.all([...chats.keys()].map(end)))),
    running: (chatId) => [...(chats.get(chatId)?.values() ?? [])].map((r) => r.key),
  }
}
