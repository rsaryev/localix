/**
 * The HOST-SIDE half of the plugin backend seam: the process-wide capabilities the host
 * hands a plugin on the boot-time backend load, and the vocabulary they speak.
 *
 * GENERIC host-service seam handed to a plugin's `register(ctx)` so a bundled BACKEND
 * subsystem can reach a narrow, process-wide host capability without importing the core
 * feature that owns it. Deliberately minimal + subsystem-agnostic — any future plugin
 * backend consumes the same shape; the host names no individual plugin here. Populated
 * on the boot-time backend load, and absent (undefined) on the per-run tool/hook load —
 * a backend singleton captures it once at boot.
 *
 * Separate from `context.ts` because these are what the HOST implements, not what a
 * plugin is handed per run: every interface here is a capability the host may or may not
 * offer, each with its own reasoning about what it deliberately does NOT allow. Reading
 * `MiniAppContext` should not mean reading all of that first.
 */

import type {
  MiniAppAgentDirectory,
  MiniAppContext,
  MiniAppPathWatch,
  MiniAppScreenSnapshot,
} from './context'
import type { ChangeFeedHost } from './changes'
import type { DecisionHost } from './decision'
import type { SemanticIndexHost } from './semantic'

/** Host-side terminal reader: the same calls, with the user the host resolves. */
export interface TerminalReadHost {
  screen(input: {
    userId: string
    sessionId: string | null
    terminalId: string
  }): Promise<MiniAppScreenSnapshot | null>
  finalScreen(input: {
    userId: string
    sessionId: string | null
    terminalId: string
  }): Promise<MiniAppScreenSnapshot | null>
  list(input: { userId: string; sessionId: string | null }): {
    terminalId: string
    command?: string
  }[]
  watch?(
    input: { userId: string; sessionId: string | null; terminalId: string },
    onEvent: (event: 'output' | 'exit') => void,
  ): (() => void) | null
}

/**
 * Ownership-checked workspace lookup for project-local plugin data.
 *
 * The returned path is host authority, never a path supplied by plugin UI or encoded in an
 * opaque resource URI. This keeps project-local providers usable from background registry
 * calls (resource expansion/search), where there is no HTTP `MiniAppRouteContext` carrying cwd.
 */
export interface WorkspaceScopeHost {
  resolveSessionRoot(userId: string, sessionId: string): Promise<string | null>
  resolveProjectRoot(userId: string, projectId: string): Promise<string | null>
}

/**
 * WHAT, inside a plugin, is using a vault key — the unit a person would name when asked
 * "who uses this credential?".
 *
 * Deliberately opaque to the host: `type` and `id` are the plugin's own vocabulary (an API
 * request's name, a database connection's id), and the host only stores and echoes them back.
 * A host that understood them would need a case for every plugin, which is the coupling this
 * whole seam exists to avoid.
 */
export interface SecretConsumer {
  /** The plugin's kind of object, e.g. `api-request`. */
  type: string
  /** That object's id within the plugin, e.g. the saved request's name. */
  id: string
  /** Which field of it holds the reference, e.g. `auth.token`. */
  field: string
  /** Human label for the vault UI. Falls back to `id`. */
  label?: string
}

/**
 * The user's PROJECTS, for a plugin whose resource tree is rooted in them rather than in the one
 * session it was called from.
 *
 * Distinct from {@link WorkspaceScopeHost} on purpose: that answers "where does this id live?" for
 * an id the caller already has, while a resource-ref provider is asked for its ROOTS with nothing
 * but a userId — it has to enumerate. Folding enumeration into the scope host would give every
 * consumer of a narrow resolver the ability to list a user's whole workspace.
 *
 * The host owns ownership: every method takes the userId it filters by.
 */
export interface WorkspacesHost {
  // ── Projects ─────────────────────────────────────────────────────────────────────────────
  /** Every project the user owns. `workingDirectory` is null for a project with no local root. */
  listProjects(
    userId: string,
  ): Promise<readonly { id: string; name: string; workingDirectory: string | null }[]>
  /** The project's local root, or null when unknown / not owned by this user. */
  resolveProjectDirectory(userId: string, projectId: string): Promise<string | null>

  // ── Sessions ─────────────────────────────────────────────────────────────────────────────
  //
  // OPTIONAL, and the `?` is load-bearing rather than defensive: the host does not own these yet.
  // Declaring them required would have this seam describe a host that does not exist — a contract
  // nothing satisfies is worse than an honest gap, because it typechecks. A consumer must branch
  // on absence.

  /** The session's working directory — the project root, or its scratch sandbox. */
  resolveSessionDirectory?(userId: string, sessionId: string): Promise<string | null>
  /** The little that a commit trailer needs about the run that produced it; null when unknown. */
  readSessionMetadata?(userId: string, sessionId: string): Promise<{ model?: string | null } | null>
}

/**
 * One turn a plugin asks for: something happened in the plugin — a person moved in its view, a
 * condition it watches came true — and the agent should act on it now, through the plugin's tools.
 *
 * The plugin names the session, what happened and which of ITS OWN tools answer it; the host does
 * the rest. The turn that answers carries the plugin's tools on the wire — for that turn, not
 * stored on the session — so the agent does not spend its first call finding them; it frames the
 * message so the agent can tell it from something
 * the person typed; and it stamps the provenance itself ("via Plugin"), so a plugin cannot pose as
 * a person or a loop.
 */
export interface MiniAppWakeRequest {
  /** The session's owner: `c.env.userId` in a route, the user who armed a watcher. */
  userId: string
  /** The session to wake — for a view, the one open beside it (`c.env.sessionId`). */
  sessionId: string
  /** What happened, in a sentence or two, for the agent to read. */
  message: string
  /**
   * The plugin's own tools the agent answers with. Each must be one this plugin registered; a wake
   * naming any other is refused, and the reason names it.
   */
  tools?: readonly string[]
  /**
   * Makes a repeat the same delivery: a second wake with this key, while the first still waits for
   * its turn, joins it instead of starting another — a double click, a retried request. Letters,
   * digits and `.:_-`, at most 120 characters.
   */
  key?: string
}

/**
 * What became of a wake. Answered, never thrown: when nobody will answer, the plugin decides what
 * happens instead — a game plays its own move, a watcher keeps its alert for later.
 */
export type MiniAppWakeOutcome =
  /** Queued for a turn: the session takes it now, or right after the run in flight. */
  | { status: 'delivered' }
  /** The session is gone or cannot take a wake. Nothing to retry. */
  | { status: 'missed'; reason: string }
  /** The request broke this contract: an empty message, a tool the plugin does not own. */
  | { status: 'refused'; reason: string }
  /** The host failed to take it. */
  | { status: 'failed'; reason: string }

/**
 * Which session one of the plugin's manifest `monitors` reports to.
 *
 * The defect this exists to stop: a manifest monitor runs process-wide, and its every stdout line
 * used to wake EVERY root chat of the user — a CI watcher's line landed in a chat about a recipe,
 * because nothing said which conversation the watcher was for. A line now goes only to the sessions
 * its monitor was armed for, and a line no session armed is delivered to nobody (the host logs it
 * as undelivered). The plugin names the session; the host never picks one.
 */
export interface MiniAppMonitorArmRequest {
  /** The session's owner: `c.env.userId` in a route. */
  userId: string
  /** The session the monitor's lines wake — for a view, the one open beside it (`c.env.sessionId`). */
  sessionId: string
  /** The `name` of one of THIS plugin's manifest monitors. */
  monitor: string
}

export type MiniAppMonitorArmOutcome =
  /** The monitor's lines now wake this session, until it is disarmed or the session goes. */
  | { status: 'armed' }
  /** Not this plugin's monitor, not the user's session, or not a user monitors run for. */
  | { status: 'refused'; reason: string }

/**
 * Arm and disarm the plugin's own manifest monitors for a session. An arm lasts the process: the
 * monitor itself restarts with the process, so a plugin that keeps an arm across restarts stores
 * it and arms again when its backend registers.
 */
export interface MiniAppMonitorsHost {
  arm(request: MiniAppMonitorArmRequest): Promise<MiniAppMonitorArmOutcome>
  /** Stop waking this session. Disarming a session that was not armed is a no-op. */
  disarm(request: MiniAppMonitorArmRequest): void
}

export interface MiniAppHostServices {
  /** Resolve a trusted project root for session/project-scoped plugin resources. */
  workspaceScope?: WorkspaceScopeHost
  /** Enumerate the user's projects — the roots of a project-rooted resource provider. */
  workspaces?: WorkspacesHost
  /**
   * Read a live terminal. The host binds the user; the plugin passes the session.
   *
   * READ-ONLY by construction — there is no `write` here. The host's own terminal control does
   * write, and handing that to plugins would let one type into a pane the user is watching. That
   * is a decision to take on purpose, not one to inherit from a convenience.
   */
  terminalRead?: TerminalReadHost
  /** Native file watching for the plugin's own paths (see {@link MiniAppPathWatch}). */
  watchPath?: MiniAppPathWatch
  /**
   * Session-isolated durable artifact storage for the owning plugin.
   *
   * The host binds this capability to the plugin name and verifies that `userId`
   * owns `sessionId` before returning a directory. Plugins never construct
   * `~/.localix` paths themselves; a request for one session never reaches another's folder.
   * Only the backend's own cleanup lists the folders it already has (`listDataDirs`).
   */
  sessionStorage?: MiniAppContext['sessionStorage']
  /** The enabled agents of a session's scope, read-only (see {@link MiniAppAgentDirectory}). */
  agents?: MiniAppAgentDirectory
  /** The embedding seam: the index of the plugin's own collections, and vectors on demand. */
  semantic?: SemanticIndexHost
  /** The decision-model seam (see {@link DecisionHost}); spend is recorded per session. */
  decisions?: DecisionHost
  changes?: ChangeFeedHost
  /**
   * Provider-neutral desktop file intents. Plugins may prepare an artifact, while
   * the host remains the sole owner of platform launch mechanics.
   *
   * REJECTS when the operating system refuses, with the reason it gave. These used
   * to resolve `{ opened: true }` no matter what happened, so a plugin could not
   * tell an artifact the user is now looking at from one that went nowhere.
   */
  files?: {
    open(path: string): Promise<{ opened: true }>
    openWith(path: string, application: string): Promise<{ opened: true }>
    reveal(path: string): Promise<{ opened: true }>
  }
  /**
   * Resolve one `${secret:KEY}` value for a user against the central write-only vault.
   * Returns undefined when the secret is absent. Resolution ONLY — it never lists or
   * enumerates keys, so a plugin can fill a stored token (a DB connection URL/password)
   * without gaining read access to the vault.
   *
   * `consumer` names WHAT inside the plugin is using the key, and the host folds it into the
   * vault's audit context. Without it the trail names only the extension, which is
   * useless when that extension owns many saved objects. With it the entry
   * names the request. Optional, so a plugin that has only one consumer stays as it was.
   */
  resolveSecret: (
    userId: string,
    key: string,
    consumer?: SecretConsumer,
  ) => Promise<string | undefined>
  /**
   * Store one value in the vault under `key` — ONLY when `key` is free. Resolves `false` when it
   * was taken and nothing was written; the caller picks another name.
   *
   * The counterpart of {@link resolveSecret}, and deliberately the WEAKER half of the host's own
   * `set`. It exists for one job: a plugin holding a literal credential the user gave it (pasted
   * in a cURL command, typed into a connection form) can move that literal into the vault and keep
   * only a `${secret:KEY}` reference — so the plaintext never settles in the plugin's own store.
   * Without it a plugin can USE the vault but never fill it, which leaves "paste a token" and
   * "keep the token out of a plaintext file" as mutually exclusive.
   *
   * Three things it deliberately is NOT:
   *   - not an overwrite: a plugin cannot replace a credential another integration depends on;
   *   - not a read: writing a key grants no ability to resolve it back, here or anywhere;
   *   - not an enumeration: a plugin still cannot learn which keys exist, and a `false` says only
   *     that THIS name is taken — which it must be told, or it cannot pick a free one.
   */
  storeSecret: (userId: string, key: string, value: string) => Promise<boolean>
  /**
   * Declare that one of the plugin's own objects REFERENCES a vault key.
   *
   * This is not a permission and grants nothing: it is the plugin telling the vault who its
   * consumers are, so the vault can answer "what breaks if I delete this?" — which it already
   * refuses to do blindly (`remove` reports `in_use` rather than orphaning a reference).
   *
   * Resolves `false` when the key does not exist, so a caller can distinguish "recorded" from
   * "you referenced something that is not there". Optional: a host without a binding registry
   * simply omits it, and the plugin keeps working with a less informative vault.
   */
  bindSecret?: (userId: string, key: string, consumer: SecretConsumer) => Promise<boolean>
  /**
   * Start a turn in a session, answered through this plugin's tools — see
   * {@link MiniAppWakeRequest}. Wake-only: a plugin can wake a session it was given the id of,
   * never read one.
   *
   * For events the agent did not cause: a person acting in the plugin's view, a condition a
   * watcher saw. Never from the plugin's own tool — the agent's call would wake the agent, whose
   * next call would wake it again.
   *
   * Optional: a leaner host omits it, and the plugin carries on without the agent.
   */
  wake?: (request: MiniAppWakeRequest) => Promise<MiniAppWakeOutcome>
  /**
   * Point the plugin's manifest `monitors` at a session — see {@link MiniAppMonitorArmRequest}.
   * Without an arm a monitor still runs, and its lines reach no one.
   */
  monitors?: MiniAppMonitorsHost
  /**
   * The host's media store (chat uploads / generated artifacts), by-id only — a
   * plugin can read the bytes behind a media id it was handed (e.g. a dropped
   * document to extract) and persist bytes it produced (e.g. a generated .docx)
   * so chat/UI can address them. No listing/enumeration.
   */
  media?: {
    /** Bytes for a media id, or null when the id is unknown. */
    getBytes(id: string): Promise<Uint8Array | null>
    /** Persist bytes; returns the media id chat/UI address them by. */
    putBytes(bytes: Uint8Array, mediaType: string): Promise<{ id: string }>
  }
}
