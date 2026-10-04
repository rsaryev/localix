import { childEnv } from '../../lib/login-shell-env'
import { localixWorkspaceDir } from '../../lib/env'
import { withTimeout } from '../../lib/timeout'
import { createDebouncer } from '../../lib/debounce'
import type { CapabilitySourceRepository } from '../capabilities/source-repository'
import type { PluginConditions } from '../notifications/conditions/plugins'

import type { LoadedPluginMonitor } from './loader'
import { loadEnabledPluginMonitors } from './loader-declarative'
import type { AvailabilityReader } from '../capabilities/availability'
import { isAlwaysMonitor, monitorSkillTrigger } from './contracts-monitors'
import { createMonitorArms } from './monitor-arms'
import {
  MAX_LINES_PER_WINDOW,
  createRateGate,
  defaultSpawn,
  pumpLines,
  substituteCommand,
  type MonitorNotification,
  type MonitorProc,
  type MonitorSpawner,
} from './monitor-stream'

export type { MonitorNotification, MonitorProc, MonitorSpawner } from './monitor-stream'

/**
 * Process-wide host for plugin background MONITORS — long-running commands whose
 * every stdout line is delivered to the model as a notification (Claude Code
 * `monitors`, experimental). Mirrors the CHANNEL host: monitors live for the process
 * lifetime, are (re)started for every ENABLED plugin's `when:"always"` monitor, and
 * are torn down on plugin-state change / shutdown. Enablement is the trust gate — a
 * monitor runs UNSANDBOXED at hook trust level, so only enabled plugins spawn one.
 *
 * Delivery seam: the host does not know how a line reaches the model — it calls the
 * injected {@link MonitorHostOptions.deliver}. Boot wiring binds that to the shared
 * `wakeSession` wake primitive (the same one /loop, sleep, the background-job monitor
 * and cc-hooks asyncRewake use). A per-monitor rate cap (see monitor-stream) keeps a
 * chatty stream from flooding the seam.
 *
 * Targeting: a line goes to the sessions the monitor was ARMED for (`arm`, which the
 * plugin reaches through its `monitors` host service) and to no other — see
 * monitor-arms.ts for the broadcast this replaced. A line with no armed session is
 * handed to {@link MonitorHostOptions.unaddressed} once per silent stretch.
 *
 * DEFERRED: `on-skill-invoke:<skill>` monitors are parsed + validated + registered but
 * NOT started here — the skill-invocation seam is not yet hooked. They are logged so
 * the author knows the lazy start is pending; `when:"always"` monitors run today.
 */

export interface MonitorHostOptions {
  /**
   * What the rules say about this user's plugins. A PORT: this host owns no storage, and
   * the composition root is the only place that can bind the rule store.
   *
   * No agent is named because a monitor runs beside every turn rather than inside one; the
   * root binds it to the agent that always exists (`DEFAULT_AGENT_ID`).
   */
  availabilityFor: (userId: string) => Promise<AvailabilityReader>
  repo: CapabilitySourceRepository
  userId: string
  /** Where a monitor stdout line goes — bound to the wake primitive by boot wiring. */
  deliver: (note: MonitorNotification) => void
  /** A line no session was armed for: delivered to nobody, reported once per silent stretch. */
  unaddressed?: (note: Omit<MonitorNotification, 'sessionIds'>) => void
  /** Discovery + spawn cwd (`${CLAUDE_PROJECT_DIR}`); defaults to `~/.localix/workspace`. */
  cwd?: string
  /** The user's home (see `discoverPlugins`); `userHome()` in production, a fixture in a test. */
  homeDir: string
  logger?: { info?: (msg: string) => void; warn: (msg: string, meta?: unknown) => void }
  /** Injectable spawner (tests supply a fake). Defaults to `Bun.spawn`. */
  spawn?: MonitorSpawner
  now?: () => number
  /** A monitor that stopped as a standing Event Center row, cleared when it starts again. */
  conditions?: Pick<PluginConditions, 'monitorStarted' | 'monitorStopped'>
}

export interface PluginMonitorHost {
  start(): Promise<void>
  refresh(): void
  stop(): Promise<void>
  /** Names of currently running monitors, as `<plugin>:<monitor>`. */
  running(): string[]
  /**
   * Point a monitor's lines at a session. Refused for a monitor the plugin does not declare
   * and for a user this host does not run monitors for; the SESSION's ownership is the
   * caller's to check (the host has no session store).
   */
  arm(input: MonitorArmInput): Promise<MonitorArmOutcome>
  disarm(input: MonitorArmInput): void
  /** A session that cannot take a wake any more leaves every monitor. */
  disarmSession(sessionId: string): void
}

export interface MonitorArmInput {
  userId: string
  sessionId: string
  pluginName: string
  monitorName: string
}

export type MonitorArmOutcome = { status: 'armed' } | { status: 'refused'; reason: string }

const REFRESH_DEBOUNCE_MS = 500
const MONITOR_STOP_GRACE_MS = 3_000

interface RunningMonitor {
  key: string
  proc: MonitorProc
  controller: AbortController
  done: Promise<void>
}

export function createPluginMonitorHost(options: MonitorHostOptions): PluginMonitorHost {
  const { repo, userId, availabilityFor, deliver, logger } = options
  const spawn = options.spawn ?? defaultSpawn
  const now = options.now ?? (() => Date.now())
  const cwd = options.cwd ?? localixWorkspaceDir()
  let monitors: RunningMonitor[] = []
  /** Every `<plugin>:<monitor>` the latest load declared, lazy ones included. */
  let declaredKeys = new Set<string>()
  // A plugin backend may arm while its own register() runs at boot, before the idle start has
  // read anything — an empty set then would refuse a monitor the plugin does declare.
  let declaredRead = false
  const arms = createMonitorArms()
  const refreshDebouncer = createDebouncer(REFRESH_DEBOUNCE_MS)
  let lifecycle: Promise<void> = Promise.resolve()

  function startMonitor(m: LoadedPluginMonitor): RunningMonitor {
    const key = `${m.pluginName}:${m.monitor.name}`
    const controller = new AbortController()
    // The `${CLAUDE_*}` placeholders stay in the command; `env` below supplies their values.
    const command = substituteCommand(m.monitor.command, m)
    const env = childEnv({
      CLAUDE_PROJECT_DIR: cwd,
      CLAUDE_PLUGIN_ROOT: m.pluginRoot,
      CLAUDE_PLUGIN_DATA: m.dataDir,
    })
    const proc = spawn(command, { cwd, env: env as Record<string, string | undefined> })
    const gate = createRateGate(now, () =>
      logger?.warn(`monitor "${key}" exceeded ${MAX_LINES_PER_WINDOW} lines/s — dropping excess`),
    )
    const done = pumpLines(proc, controller.signal, (line) => {
      if (controller.signal.aborted || !gate(line)) return
      const note = {
        pluginName: m.pluginName,
        monitorName: m.monitor.name,
        description: m.monitor.description,
        line,
      }
      const sessionIds = arms.sessionsFor(key)
      if (sessionIds.length > 0) deliver({ ...note, sessionIds })
      else if (arms.firstUnaddressed(key)) options.unaddressed?.(note)
    })
      .catch(() => undefined)
      // Output ending without a stop is the monitor dying — it was silent, so a watcher that
      // exited on its first line looked exactly like one with nothing to say.
      .then(async () => {
        if (controller.signal.aborted) return
        const code = await proc.exited.catch(() => null)
        if (controller.signal.aborted) return
        logger?.warn(`monitor "${key}" stopped`, { exitCode: code })
        options.conditions?.monitorStopped(
          m.pluginName,
          m.monitor.name,
          code === null ? 'Its command ended.' : `Its command exited with code ${code}.`,
        )
      })
    logger?.info?.(`monitor started: ${key}`)
    options.conditions?.monitorStarted(m.pluginName, m.monitor.name)
    return { key, proc, controller, done }
  }

  async function stopRunning(stopping: RunningMonitor[]): Promise<void> {
    for (const r of stopping) {
      r.controller.abort()
      try {
        r.proc.kill()
      } catch {
        /* already gone */
      }
    }
    await withTimeout(
      Promise.all(stopping.map((r) => Promise.all([r.done, r.proc.exited.catch(() => 0)]))),
      MONITOR_STOP_GRACE_MS,
    ).catch(() => {})
  }

  async function stopAll(): Promise<void> {
    const stopping = monitors
    monitors = []
    await stopRunning(stopping)
  }

  // Declarative-only: a monitor is manifest data, so reading them must not import
  // and `register()` every enabled plugin. This ran the FULL loader at boot —
  // ~9 MB of bundled plugin JS imported and every register() executed — to read an
  // array that no bundled plugin even declares.
  async function readDeclared(): Promise<LoadedPluginMonitor[]> {
    const declared = await loadEnabledPluginMonitors({
      repo,
      availability: await availabilityFor(userId),
      userId,
      projectId: '',
      cwd,
      homeDir: options.homeDir,
    })
    declaredKeys = new Set(declared.map((m) => `${m.pluginName}:${m.monitor.name}`))
    declaredRead = true
    return declared
  }

  async function startAll(): Promise<void> {
    const declared = await readDeclared()
    const started: RunningMonitor[] = []
    try {
      for (const m of declared) {
        if (isAlwaysMonitor(m.monitor)) {
          started.push(startMonitor(m))
        } else {
          // on-skill-invoke:<skill> — lazy start deferred (no skill-invocation seam yet).
          logger?.info?.(
            `monitor "${m.pluginName}:${m.monitor.name}" deferred (waits for skill "${monitorSkillTrigger(m.monitor)}" — lazy start not yet wired)`,
          )
        }
      }
    } catch (err) {
      // Startup is transactional: a later spawn failure must not orphan earlier processes.
      await stopRunning(started)
      throw err
    }
    monitors = started
  }

  function enqueue(task: () => Promise<void>): Promise<void> {
    lifecycle = lifecycle.catch(() => undefined).then(task)
    return lifecycle
  }

  return {
    start: () => enqueue(startAll),
    refresh() {
      refreshDebouncer.schedule(() => {
        void enqueue(async () => {
          await stopAll()
          await startAll()
        })
      })
    },
    stop: () => {
      refreshDebouncer.cancel()
      return enqueue(stopAll)
    },
    running: () => monitors.map((r) => r.key),
    async arm(input) {
      if (input.userId !== userId)
        return { status: 'refused', reason: 'plugin monitors run for the workspace user only' }
      // A start or refresh in flight decides what is declared; judge against its result.
      await lifecycle.catch(() => undefined)
      if (!declaredRead) await readDeclared().catch(() => undefined)
      const key = `${input.pluginName}:${input.monitorName}`
      if (!declaredKeys.has(key))
        return {
          status: 'refused',
          reason: `"${input.monitorName}" is not a monitor this plugin declares`,
        }
      arms.arm(key, input.sessionId)
      return { status: 'armed' }
    },
    disarm(input) {
      if (input.userId !== userId) return
      arms.disarm(`${input.pluginName}:${input.monitorName}`, input.sessionId)
    },
    disarmSession: (sessionId) => arms.disarmSession(sessionId),
  }
}
