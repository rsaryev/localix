import type { defineAgentTool } from '@localixai/agent/agents'
import type { z } from 'zod'

import type { UiNavigationAction } from '../ui/anchors'
import type { PluginHelpers } from './helpers'
import type { PluginOAuth } from './oauth'
import type { PluginHostServices } from './host-services'

/** The visible screen of a terminal, already VT-emulated by the host. */
export interface PluginScreenSnapshot {
  /** Visible rows joined with '\n', trailing blanks trimmed. */
  readonly text: string
  readonly cursor: { readonly row: number; readonly col: number }
  readonly cols: number
  readonly rows: number
}

/**
 * Watch a file or directory on this machine; returns the release.
 *
 * WHY THE HOST OWNS IT. Bun's `node:fs.watch({ recursive: true })` on macOS delivers only part of
 * a burst — a measured 3 of 14 changes, deletes and renames often none — so a plugin that trusts
 * it as its change signal misses updates until a backstop poll. The host's watcher runs on the
 * native backend (FSEvents / inotify / ReadDirectoryChangesW) and reports a dropped-events
 * overflow as an ERROR instead of going quiet. It is a host capability because that backend is a
 * per-platform native addon only the host bundles.
 *
 * `onEvent` gets the changed entry's path RELATIVE to `path` (the file's own name when `path` is a
 * file), or `null` when unknown. `onError` means events may have been lost: re-read once.
 * `recursive: false` reports direct entries only.
 */
export type PluginPathWatch = (
  path: string,
  recursive: boolean,
  onEvent: (name: string | null) => void,
  onError: () => void,
) => () => void

export interface TerminalRead {
  /** Current visible screen, or null when the terminal is not this session's or no longer exists. */
  screen(input: {
    sessionId: string | null
    terminalId: string
  }): Promise<PluginScreenSnapshot | null>
  /**
   * The retained final screen of a terminal that has EXITED. Separate from `screen` so a finished
   * process is never mistaken for a live one.
   */
  finalScreen(input: {
    sessionId: string | null
    terminalId: string
  }): Promise<PluginScreenSnapshot | null>
  /** Live terminals bound to this chat session. */
  list(input: { sessionId: string | null }): { terminalId: string; command?: string }[]
}

/** Resolved plugin config values (declared defaults overlaid with stored values). */
export type PluginConfigValues = Record<string, string | number | boolean>

/**
 * Runtime environment facts about the HOST instance, handed to a plugin so it never
 * has to reconstruct the host's address by guessing env vars. The host resolves it
 * from the same single source its system prompt uses, so a plugin and the agent
 * always agree on how to reach this instance.
 */
export interface PluginRuntimeInfo {
  /** Loopback-normalized host reachable by callers on the same machine. */
  host: string
  /** The listen port. */
  port: number
  /** Absolute origin, e.g. `http://127.0.0.1:5051`. */
  baseUrl: string
  /** This instance's inbound-webhook URL — `POST {sessionId,prompt,source}` to message a session. */
  webhookUrl: string
}

export interface PluginUiDestination {
  /** Canonical read-only `localix://ui/...` or `localix://resource/...` URI. */
  uri: string
  /** Compact transcript label retained as a manual reopen affordance. */
  label: string
  description?: string
}

/**
 * Host-owned UI intents available to every native plugin tool.
 *
 * A plugin returns the produced object as `AgentToolResult.details`; the frontend
 * resolves the URI through the owning plugin contribution and renders a manual button.
 * A plugin never reveals a view on its own: the host tells the model the offered URI,
 * and the agent decides whether to show it with the core `open` tool.
 */
export interface PluginUi {
  offer(destination: PluginUiDestination): UiNavigationAction
}

/**
 * A problem a plugin wants a PERSON to see — addressed to the chat it happened in, when
 * there is one.
 *
 * The three slots are the product-wide ones: `message` is one classified sentence
 * ("the webhook endpoint rejected the delivery"), `detail` is the raw thing the HTTP
 * layer / filesystem / CLI actually said, kept for an operator and never rendered on
 * the line itself. `source` names the part of the plugin that produced it, the way a
 * Claude Code hook's notice names the hook event it came from.
 */
export interface PluginProblem {
  /**
   * The chat the problem belongs to. Hooks take it from the event they were handed —
   * a plugin context is built once per SCOPE (user + project + cwd) and shared by a
   * parent run and every child that inherits it, so the session cannot be baked in.
   *
   * Omit it where no chat is involved (a backend's `register`, a route, a channel): the
   * problem is then filed under the plugin alone, and no transcript line is drawn.
   */
  sessionId?: string
  /** ONE human sentence. Never a status code, never raw engine output. */
  message: string
  /** The raw text behind the sentence. Operators only. */
  detail?: string
  /** What inside the plugin produced this, e.g. `onAssistantMessage`. */
  source?: string
}

/** One agent a plugin may name — as the owner of a card, say. `id` is what to store. */
export interface PluginAgentSummary {
  /** The stable registry identity; a handle can be renamed, this cannot. */
  readonly id: string
  /** The name people and the model address it by, without `@`. */
  readonly handle: string
  readonly description?: string
}

/**
 * The agents available in one chat, READ-ONLY.
 *
 * A plugin that records who should do something (a board card's assignee) has to store a name
 * that means one agent and keeps meaning it. Accepting any string stores a typo that nothing can
 * ever act on; resolving it against a list the plugin keeps itself drifts from the registry the
 * moment an agent is renamed or disabled. So the host answers from its registry: the ENABLED agents
 * of the session's scope (its project's agents included), after checking the user owns the session.
 * A stale or foreign session rejects.
 *
 * Deliberately a listing and nothing more: a plugin cannot invite an agent, start one or change it.
 */
export interface PluginAgentDirectory {
  list(userId: string, sessionId: string): Promise<readonly PluginAgentSummary[]>
}

/** Context handed to a plugin's native `register(ctx)` / hooks. */
export interface PluginContext {
  /** The resolved host user identity for user-scoped plugin state and tools. */
  userId: string
  /** Resolved config (declared defaults overlaid with stored values, incl. secrets). */
  config: PluginConfigValues
  /** Absolute plugin directory — read bundled data files relative to this. */
  pluginDir: string
  pluginName: string
  /** Log helper, prefixed with the plugin name. */
  log: (message: string) => void
  /**
   * Tell the PERSON something went wrong. `log` tells the server console, which is a
   * different audience: a hooks-only plugin whose deliveries are all being rejected by
   * a mistyped URL wrote a line nobody would ever read, and the user was never told
   * their notifications had stopped. This is the channel that was missing.
   *
   * The host records it in the Event Center as a standing problem, one row per plugin
   * part (`source`) and problem — reporting the same problem again is free, and a
   * different problem from the same `source` replaces the previous row. When the
   * problem names a `sessionId` inside a chat run, it is ALSO drawn as the inline
   * transcript warning a Claude Code hook's non-blocking `systemMessage` produces.
   *
   * Present on every load that runs plugin code: the per-run load, the boot-time
   * backend load and channels. The journal needs no chat, so a backend can report a
   * problem from `register` or a route. Absent only during plugin inspection (Settings
   * reading a plugin's roster), which must not file problems — tolerate its absence.
   *
   * Best-effort and fire-and-forget: it never throws and never blocks the turn.
   *
   * NOT for things the MODEL should act on: a tool that failed says so in its own
   * result. This is for a standing condition a HUMAN has to fix.
   */
  reportProblem?: (problem: PluginProblem) => void
  /**
   * The HOST's zod instance. Build tool input schemas with this — a plugin installed
   * to ~/.localix/plugins has no node_modules, so `import 'zod'` would fail to
   * resolve AND would be a different module instance than the runtime validates with.
   */
  z: typeof z
  /** The host's tool factory — wrap your tool definitions so required fields are inferred. */
  defineTool: typeof defineAgentTool
  /**
   * The session's working directory (workspace root / sandbox). Use as the cwd for shell/git
   * commands a tool runs (e.g. `git stash` in a git-checkpoint plugin). Always a real path —
   * never '/' (the host creates a per-session sandbox when no project is selected).
   */
  cwd: string
  /**
   * Read a live terminal this chat session owns.
   *
   * WHY THIS EXISTS. A plugin that watches external agents could previously only see the screens
   * the MODEL happened to look at — `onPostToolCall` carries whatever the bash tool just rendered,
   * which makes state an observation log rather than a reading. A delegation that changed state
   * since the model last screened it showed a stale answer with a timestamp saying when.
   *
   * READ-ONLY on purpose. The host's own `TerminalControl` also writes, and exposing that would let
   * a plugin type into a pane the user is watching — a far larger decision than reading one, and
   * one that should be taken deliberately rather than inherited from a convenience.
   *
   * Ownership is the host's, not the caller's: the user comes from the plugin context and the
   * session must be passed, because the terminal service owns panes per USER and without the
   * session component one chat could read another chat's live shell.
   */
  terminalRead?: TerminalRead
  /**
   * Native file watching (see {@link PluginPathWatch}). Present on the boot-time backend load;
   * absent on per-run tool/hook loads, so a backend singleton keeps the one it was given.
   */
  watchPath?: PluginPathWatch
  /** Shared utilities (config coercion, error results, timeouts, JSON state). */
  helpers: PluginHelpers
  /**
   * Provider-neutral UI intents for tool results. Plugins address their own
   * registered surfaces by canonical URI; the host owns the concrete tab/panel.
   */
  ui: PluginUi
  /**
   * Generic OAuth-PKCE utilities for tools that connect third-party accounts
   * (Spotify, Google, …). Persist credentials yourself under `stateDir`.
   */
  oauth: PluginOAuth
  /**
   * Writable per-plugin state directory (`~/.localix/plugin-state/<plugin>`) for
   * data that must survive restarts but is not user-facing config (e.g. a
   * channel's conversation→session bindings). Created on context build.
   */
  stateDir: string
  /**
   * Writable durable data directory (`~/.localix/plugin-data/<plugin>`).
   *
   * Unlike `stateDir`, this is inspectable global plugin data shared across chat
   * sessions. For data owned by exactly one session, use {@link sessionStorage}.
   */
  dataDir: string
  /**
   * The plugin's folder for ONE chat session — for anything that belongs to that chat (a game
   * board, an export) and must go when it does. The host removes it with the session and every
   * session beneath it, whether or not the chat is filed in a project.
   *
   * Present on EVERY load: the boot-time backend (routes) and each run's tools alike, with the
   * same folder for the same session. Pass the session the host gave you — `c.env.sessionId` in
   * a route (present only once its ownership was checked), `context.session.id` in a tool's
   * `execute`. The host verifies `userId` owns `sessionId` before returning, so a stale or
   * foreign id rejects instead of recreating a deleted session's folder.
   */
  sessionStorage?: {
    resolveDataDir(userId: string, sessionId: string): Promise<string>
  }
  /**
   * The agents a chat can name (see {@link PluginAgentDirectory}). Present on every load — the
   * boot-time backend (routes) and each run's tools alike — so a route and a tool resolve a name
   * against the same registry.
   */
  agents?: PluginAgentDirectory
  /**
   * Host runtime facts (address + inbound-webhook URL). Use this instead of
   * reconstructing the host's address from env — the host is the authority on
   * how it can be reached (it knows the real HOST/PORT and the route path).
   */
  runtime: PluginRuntimeInfo
  /**
   * Generic host-service capabilities for a bundled BACKEND subsystem (see
   * {@link PluginHostServices}). Present only on the boot-time backend load; a plugin
   * that reads it must tolerate its absence (undefined) on the per-run tool/hook load.
   */
  host?: PluginHostServices
}
