import type { defineAgentTool } from '@localixai/agent/agents'
import type { z } from 'zod'

import type { UiNavigationAction } from '../ui/anchors'
import type { MiniAppHelpers } from './helpers'
import type { MiniAppOAuth } from './oauth'
import type { MiniAppHostServices } from './host-services'
import type { TerminalRead } from './terminal-read'

export type { MiniAppScreenSnapshot, TerminalRead } from './terminal-read'

/**
 * Watch a file or directory on this machine; returns the release.
 *
 * WHY THE HOST OWNS IT. Bun's `node:fs.watch({ recursive: true })` on macOS delivers only part of
 * a burst — a measured 3 of 14 changes, deletes and renames often none — so a mini app that trusts
 * it as its change signal misses updates until a backstop poll. The host's watcher runs on the
 * native backend (FSEvents / inotify / ReadDirectoryChangesW) and reports a dropped-events
 * overflow as an ERROR instead of going quiet. It is a host capability because that backend is a
 * per-platform native addon only the host bundles.
 *
 * `onEvent` gets the changed entry's path RELATIVE to `path` (the file's own name when `path` is a
 * file), or `null` when unknown. `onError` means events may have been lost: re-read once.
 * `recursive: false` reports direct entries only.
 */
export type MiniAppPathWatch = (
  path: string,
  recursive: boolean,
  onEvent: (name: string | null) => void,
  onError: () => void,
) => () => void

/** Resolved mini app config values (declared defaults overlaid with stored values). */
export type MiniAppConfigValues = Record<string, string | number | boolean>

/**
 * Runtime environment facts about the HOST instance, handed to a mini app so it never
 * has to reconstruct the host's address by guessing env vars. The host resolves it
 * from the same single source its system prompt uses, so a mini app and the agent
 * always agree on how to reach this instance.
 */
export interface MiniAppRuntimeInfo {
  /** Loopback-normalized host reachable by callers on the same machine. */
  host: string
  /** The listen port. */
  port: number
  /** Absolute origin, e.g. `http://127.0.0.1:5051`. */
  baseUrl: string
  /** This instance's inbound-webhook URL — `POST {sessionId,prompt,source}` to message a session. */
  webhookUrl: string
}

export interface MiniAppUiDestination {
  /** Canonical read-only `localix://ui/...` or `localix://resource/...` URI. */
  uri: string
  /** Compact transcript label retained as a manual reopen affordance. */
  label: string
  description?: string
}

/**
 * Host-owned UI intents available to every native mini app tool.
 *
 * A mini app returns the produced object as `AgentToolResult.details`; the frontend
 * resolves the URI through the owning mini app contribution and renders a manual button.
 * A mini app never reveals a view on its own: the host tells the model the offered URI,
 * and the agent decides whether to show it with the core `open` tool.
 */
export interface MiniAppUi {
  offer(destination: MiniAppUiDestination): UiNavigationAction
}

/**
 * A problem a mini app wants a PERSON to see — addressed to the chat it happened in, when
 * there is one.
 *
 * The three slots are the product-wide ones: `message` is one classified sentence
 * ("the webhook endpoint rejected the delivery"), `detail` is the raw thing the HTTP
 * layer / filesystem / CLI actually said, kept for an operator and never rendered on
 * the line itself. `source` names the part of the mini app that produced it, the way a
 * Claude Code hook's notice names the hook event it came from.
 */
export interface MiniAppProblem {
  /**
   * The chat the problem belongs to. Hooks take it from the event they were handed —
   * a mini app context is built once per SCOPE (user + project + cwd) and shared by a
   * parent run and every child that inherits it, so the session cannot be baked in.
   *
   * Omit it where no chat is involved (a backend's `register`, a route, a channel): the
   * problem is then filed under the mini app alone, and no transcript line is drawn.
   */
  sessionId?: string
  /** ONE human sentence. Never a status code, never raw engine output. */
  message: string
  /** The raw text behind the sentence. Operators only. */
  detail?: string
  /** What inside the mini app produced this, e.g. `onAssistantMessage`. */
  source?: string
}

/** One agent a mini app may name — as the owner of a card, say. `id` is what to store. */
export interface MiniAppAgentSummary {
  /** The stable registry identity; a name can be changed, this cannot. */
  readonly id: string
  /** The name people and the model address it by (its Claude Code `name`). */
  readonly name: string
  readonly description?: string
}

/**
 * The agents available in one chat, READ-ONLY.
 *
 * A mini app that records who should do something (a board card's assignee) has to store a name
 * that means one agent and keeps meaning it. Accepting any string stores a typo that nothing can
 * ever act on; resolving it against a list the mini app keeps itself drifts from the registry the
 * moment an agent is renamed or disabled. So the host answers from its registry: the ENABLED agents
 * of the session's scope (its project's agents included), after checking the user owns the session.
 * A stale or foreign session rejects.
 *
 * Deliberately a listing and nothing more: a mini app cannot invite an agent, start one or change
 * it.
 */
export interface MiniAppAgentDirectory {
  list(userId: string, sessionId: string): Promise<readonly MiniAppAgentSummary[]>
  /**
   * Tell the person something now waits on them in this chat (a card assigned to `@human`): the
   * stream frame, the attention item and `onHumanAssigned`. Best-effort; absent on hosts that
   * cannot.
   */
  notifyHuman?(
    userId: string,
    sessionId: string,
    notice: { key: string; from?: string; text: string },
  ): Promise<void>
}

/** Context handed to a mini app's native `register(ctx)` / hooks. */
export interface MiniAppContext {
  /** The resolved host user identity for user-scoped mini app state and tools. */
  userId: string
  /** Resolved config (declared defaults overlaid with stored values, incl. secrets). */
  config: MiniAppConfigValues
  /** Absolute mini app directory — read bundled data files relative to this. */
  miniAppDir: string
  miniAppName: string
  /** Log helper, prefixed with the mini app name. */
  log: (message: string) => void
  /**
   * Tell the PERSON something went wrong. `log` tells the server console, which is a
   * different audience: a hooks-only mini app whose deliveries are all being rejected by
   * a mistyped URL wrote a line nobody would ever read, and the user was never told
   * their notifications had stopped. This is the channel that was missing.
   *
   * The host records it in the Event Center as a standing problem, one row per mini app
   * part (`source`) and problem — reporting the same problem again is free, and a
   * different problem from the same `source` replaces the previous row. When the
   * problem names a `sessionId` inside a chat run, it is ALSO drawn as the inline
   * transcript warning a Claude Code hook's non-blocking `systemMessage` produces.
   *
   * Present on every load that runs mini app code: the per-run load, the boot-time
   * backend load and channels. The journal needs no chat, so a backend can report a
   * problem from `register` or a route. Absent only during mini app inspection (Settings
   * reading a mini app's roster), which must not file problems — tolerate its absence.
   *
   * Best-effort and fire-and-forget: it never throws and never blocks the turn.
   *
   * NOT for things the MODEL should act on: a tool that failed says so in its own
   * result. This is for a standing condition a HUMAN has to fix.
   */
  reportProblem?: (problem: MiniAppProblem) => void
  /**
   * The HOST's zod instance. Build tool input schemas with this — a mini app installed
   * to ~/.localix/mini-apps has no node_modules, so `import 'zod'` would fail to
   * resolve AND would be a different module instance than the runtime validates with.
   */
  z: typeof z
  /** The host's tool factory — wrap your tool definitions so required fields are inferred. */
  defineTool: typeof defineAgentTool
  /**
   * The session's working directory (workspace root / sandbox). Use as the cwd for shell/git
   * commands a tool runs (e.g. `git stash` in a git-checkpoint mini app). Always a real path —
   * never '/' (the host creates a per-session sandbox when no project is selected).
   */
  cwd: string
  /**
   * Read a live terminal this chat session owns.
   *
   * WHY THIS EXISTS. A mini app that watches external agents could previously only see the screens
   * the MODEL happened to look at — `onPostToolCall` carries whatever the bash tool just rendered,
   * which makes state an observation log rather than a reading. A delegation that changed state
   * since the model last screened it showed a stale answer with a timestamp saying when.
   *
   * READ-ONLY on purpose. The host's own `TerminalControl` also writes, and exposing that would let
   * a mini app type into a pane the user is watching — a far larger decision than reading one, and
   * one that should be taken deliberately rather than inherited from a convenience.
   *
   * Ownership is the host's, not the caller's: the user comes from the mini app context and the
   * session must be passed, because the terminal service owns panes per USER and without the
   * session component one chat could read another chat's live shell.
   */
  terminalRead?: TerminalRead
  /**
   * Native file watching (see {@link MiniAppPathWatch}). Present on the boot-time backend load;
   * absent on per-run tool/hook loads, so a backend singleton keeps the one it was given.
   */
  watchPath?: MiniAppPathWatch
  /** Shared utilities (config coercion, error results, timeouts, JSON state). */
  helpers: MiniAppHelpers
  /**
   * Provider-neutral UI intents for tool results. Mini apps address their own
   * registered surfaces by canonical URI; the host owns the concrete tab/panel.
   */
  ui: MiniAppUi
  /**
   * Generic OAuth-PKCE utilities for tools that connect third-party accounts
   * (Spotify, Google, …). Persist credentials yourself under `stateDir`.
   */
  oauth: MiniAppOAuth
  /**
   * Writable per-mini-app state directory (`~/.localix/mini-app-state/<app>`) for
   * data that must survive restarts but is not user-facing config (e.g. a
   * channel's conversation→session bindings). Created on context build.
   */
  stateDir: string
  /**
   * Writable durable data directory (`~/.localix/mini-app-data/<app>`).
   *
   * Unlike `stateDir`, this is inspectable global mini app data shared across chat
   * sessions. For data owned by exactly one session, use {@link sessionStorage}.
   */
  dataDir: string
  /**
   * The mini app's folder for ONE chat session — for anything that belongs to that chat (a game
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
    /**
     * Every session folder this mini app already has, without creating any — for cleanup that
     * spans chats (a deleted agent unassigned from every board). Absent on hosts that cannot.
     */
    listDataDirs?(): Promise<readonly { sessionId: string; dir: string }[]>
  }
  /**
   * The agents a chat can name (see {@link MiniAppAgentDirectory}). Present on every load — the
   * boot-time backend (routes) and each run's tools alike — so a route and a tool resolve a name
   * against the same registry.
   */
  agents?: MiniAppAgentDirectory
  /**
   * Host runtime facts (address + inbound-webhook URL). Use this instead of
   * reconstructing the host's address from env — the host is the authority on
   * how it can be reached (it knows the real HOST/PORT and the route path).
   */
  runtime: MiniAppRuntimeInfo
  /**
   * Generic host-service capabilities for a bundled BACKEND subsystem (see
   * {@link MiniAppHostServices}). Present only on the boot-time backend load; a mini app
   * that reads it must tolerate its absence (undefined) on the per-run tool/hook load.
   */
  host?: MiniAppHostServices
}
