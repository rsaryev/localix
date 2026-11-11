import type { KitSession } from './kit'
import type { PluginConditions } from '../notifications/conditions/plugins'
import type { MonitorSpawner } from './monitor-stream'

/** The plugin monitor host's ports and surface (`monitor-host.ts`). */

/** One monitor stdout line, for the chat its monitor belongs to. */
export interface MonitorNotification {
  userId: string
  chatId: string
  pluginName: string
  monitorName: string
  /** The monitor's `description` (shown in the task panel). */
  description: string
  line: string
}

/** A chat's kit session moved: it opened or ran a turn (`sessionId` is a sub-agent's for its runs). */
export interface ChatSessionMoved {
  userId: string
  /** The chat: its monitors' lines go there, and they stop when it ends. */
  chatId: string
  /** The kit session that moved: the chat's own, or one of its sub-agents'. */
  sessionId: string
}

export interface PluginMonitorHostOptions {
  /** The kit session of a chat or sub-agent session (`ChatPluginSessions.get`). */
  sessionOf: (sessionId: string) => KitSession | undefined
  /** Where a monitor's stdout line goes: bound to the wake primitive by boot wiring. */
  deliver: (note: MonitorNotification) => void
  logger?: { info?: (msg: string) => void; warn: (msg: string, meta?: unknown) => void }
  /** Injectable spawner (tests supply a fake). Defaults to the agent's shell, `bash -c`. */
  spawn?: MonitorSpawner
  now?: () => number
  /** A monitor that stopped as a standing Event Center row, cleared when it starts again. */
  conditions?: Pick<PluginConditions, 'monitorStarted' | 'monitorStopped'>
}

export interface PluginMonitorHost {
  /**
   * Start what the moved session hands out now (`kit/monitors.ts`): its `always` monitors when it
   * opens, and the `on-skill-invoke` ones whose skill it expanded. One the chat already runs (a
   * sub-agent's session hands it out again) is not started twice.
   */
  sessionMoved(input: ChatSessionMoved): Promise<void>
  /** The chat ended (deleted, or it can take no wake): its monitors stop. */
  endChat(chatId: string): Promise<void>
  /** Process shutdown: every monitor stops. */
  stop(): Promise<void>
  /** The chat's running monitors, as `<plugin>:<monitor>`, in the order they started. */
  running(chatId: string): string[]
}
