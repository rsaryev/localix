import type { AvailabilityReader } from '../capabilities/availability'
import type { CapabilitySourceRepository } from '../capabilities/source-repository'
import type { PluginConditions } from '../notifications/conditions/plugins'
import type { MonitorNotification, MonitorSpawner } from './monitor-stream'
import type { SkillInvocationInput } from './monitor-skill-trigger'

/** The plugin monitor host's ports and surface (`monitor-host.ts`). */

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
  /**
   * A chat ran a turn: its lines of every `always` monitor reach it, from a process in its working
   * directory, as Claude Code starts them with each session.
   */
  sessionActive(input: { userId: string; sessionId: string; cwd?: string }): Promise<void>
  /** A skill ran in a chat: start the monitors waiting for it, arm them; resolves their keys. */
  skillInvoked(input: SkillInvocationInput): Promise<string[]>
}

export interface MonitorArmInput {
  userId: string
  sessionId: string
  pluginName: string
  monitorName: string
}

export type MonitorArmOutcome = { status: 'armed' } | { status: 'refused'; reason: string }
