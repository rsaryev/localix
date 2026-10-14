import os from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import type { LogLevel } from './logger'

/**
 * The environment contract. Two halves, one vocabulary:
 *
 * - {@link loadEnv} — the SERVER's boot config (port, host, db file …), validated
 *   once in `bootstrap.ts` and threaded as a typed `AppEnv`.
 * - {@link envFlag} / {@link envInt} / {@link envString} — the ad-hoc switches read
 *   deep in the tree (debug dumps, kill switches, timeouts, path overrides), where
 *   threading `AppEnv` down would mean rewiring half the call graph. They still go
 *   through ONE parser per type, so every var accepts the same spellings and no var
 *   silently mis-parses.
 *
 * Every value a user can type MUST come through here — never `process.env.X` at a
 * call site. `env-contract.test.ts` enforces that: it fails on a raw read, and the
 * exceptions it does permit (OS vars, config-supplied var NAMES) are listed there
 * with a reason.
 */

/**
 * The ONE root every persisted store hangs off: `~/.localix`.
 *
 * `os.homedir()`, never `process.env.HOME` — and never a `'.'` fallback. `HOME` is
 * a POSIX convention that Windows does not set (its home var is `USERPROFILE`), and
 * a service manager can scrub it anywhere. `os.homedir()` handles both: it prefers
 * `HOME` when set and falls back to the OS's own account APIs, so it always yields a
 * real absolute home.
 *
 * A `process.env.HOME ?? '.'` root is not a cwd-relative feature, it is scatter: the
 * store then lands in WHATEVER directory the process happened to start in, so the
 * same user gets a different store per launch — and, for the secrets vault and the
 * MCP OAuth tokens, drops credentials into whatever project the app was started from
 * (a git repo, ready to be committed). See `localix-home.test.ts`.
 *
 * Two roots derive from this one, and only two:
 *   - MACHINE-level key/token state → here (`~/.localix/vault`, `~/.localix/mcp-oauth`);
 *   - host-owned blobs that belong to a DB row → beside the db — move the db and
 *     its blobs must move with it. Plugin data roots come from PluginContext.
 */
export function localixHome(): string {
  return path.join(userHome(), '.localix')
}

/**
 * The user's home, for a caller that must be TOLD it (plugin discovery and staging take it as
 * `homeDir`). The production value of every such parameter comes from here; a test passes a
 * fixture, since Bun reads the home once per process and reassigning `HOME` changes nothing.
 */
export function userHome(): string {
  return os.homedir()
}

/**
 * `~/.localix/workspace` — the default project's directory, and the NEUTRAL cwd for any agent
 * tool or plugin host that was given none.
 *
 * The defect it replaces: those fallbacks read `process.cwd()`, the API's launch directory —
 * the monorepo checkout in development, the install directory in a packaged build — so a call
 * without a cwd ran inside the host application itself. Owned here (not in `features/projects`)
 * because agent-core and the plugin hosts need it and must not import a feature to get it.
 */
export function localixWorkspaceDir(): string {
  return path.join(localixHome(), 'workspace')
}

/** Canonical DB location — the single source of truth for `LOCALIX_DB_FILE`'s default.
 *
 * Everything the app persists roots at {@link localixHome} (tmp/sessions,
 * workspace, media), so the database lives alongside them on every platform, Windows
 * included.
 *
 * Exported so nothing re-hardcodes the path: a changed default here must move every
 * host store that sits beside the db, not silently split state onto a second file.
 *
 * Desktop must NOT override `LOCALIX_DB_FILE` or it ends up on a separate db.
 */
export function defaultDbFile(): string {
  return path.join(localixHome(), 'localix.db')
}

/** The resolved DB path: the override when set, else the canonical default. */
export function resolveDbFile(source: Record<string, string | undefined> = process.env): string {
  return envString('LOCALIX_DB_FILE', source) ?? defaultDbFile()
}

/** Canonical single-user id — the default for `LOCALIX_DEFAULT_USER_ID`. */
export const DEFAULT_USER_ID = 'local-user'

/** The resolved user id. Localix is single-user; every store that roots its files
 *  per user resolves it here rather than re-stating the fallback. */
export function resolveDefaultUserId(
  source: Record<string, string | undefined> = process.env,
): string {
  return envString('LOCALIX_DEFAULT_USER_ID', source) ?? DEFAULT_USER_ID
}

/**
 * Read a string setting (a path override, a directory relocation). Trimmed; a
 * missing OR blank value yields `undefined` so the caller's `?? fallback` is the
 * ONE place the default lives.
 *
 * The blank case is the point: a raw empty path override (`''`) is not nullish and
 * could silently repoint discovery at the process cwd. Same spelling rule as
 * {@link envFlag}/{@link envInt}: blank means unset, everywhere.
 */
export function envString(
  name: string,
  source: Record<string, string | undefined> = process.env,
): string | undefined {
  const raw = source[name]?.trim()
  return raw ? raw : undefined
}

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on'])
const FALSE_VALUES = new Set(['0', 'false', 'no', 'off'])

/**
 * Read a boolean switch. Accepts `1/true/yes/on` and `0/false/no/off`
 * (case-insensitive, trimmed); anything else — including an empty string or a
 * typo — falls back to `fallback` rather than guessing.
 *
 * ONE spelling rule for every flag. Before this, `LOCALIX_WIRE_DUMP=true` worked
 * while `LOCALIX_CACHE_DIAGNOSTICS=true` silently did nothing (it compared to the
 * literal `'1'`), which is exactly the kind of thing nobody debugs — they just
 * conclude the flag is broken.
 */
export function envFlag(
  name: string,
  fallback = false,
  source: Record<string, string | undefined> = process.env,
): boolean {
  const raw = source[name]?.trim().toLowerCase()
  if (!raw) return fallback
  if (TRUE_VALUES.has(raw)) return true
  if (FALSE_VALUES.has(raw)) return false
  return fallback
}

/**
 * Read a positive integer (a timeout, a budget). A missing, non-numeric, zero, or
 * negative value falls back — never `NaN`, which is the real hazard here:
 * `setTimeout(fn, NaN)` fires IMMEDIATELY, so a typo in a timeout var used to make
 * the HITL prompt auto-answer itself before the user could reach the keyboard.
 */
export function envInt(
  name: string,
  fallback: number,
  source: Record<string, string | undefined> = process.env,
): number {
  const raw = source[name]?.trim()
  if (!raw) return fallback
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback
}

const envSchema = z.object({
  // Let Bun bind port 0 directly. Probe-then-bind "free port" helpers have a
  // race in which another process can claim the released port.
  PORT: z.coerce.number().int().nonnegative().default(5051),
  HOST: z.string().min(1).default('127.0.0.1'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  LOCALIX_DB_FILE: z
    .string()
    .min(1)
    .default(() => defaultDbFile()),
  LOCALIX_DEFAULT_USER_ID: z.string().min(1).default(DEFAULT_USER_ID),
  /** Absolute or relative path to the pre-built UI dist folder to serve on root. */
  LOCALIX_UI_DIR: z.string().optional(),
  /**
   * Comma-separated exact page origins allowed to drive the API besides the packaged app's
   * (`lib/local-origin-guard.ts`). Set by the dev launcher to the Vite origin; never a wildcard.
   */
  LOCALIX_UI_ORIGINS: z.string().optional(),
  /** Absolute path to the bundled `localix` CLI shim (bin/localix.mjs) the desktop
   *  shell stages — backs the "install localix in PATH" launcher. */
  LOCALIX_CLI_ENTRY: z.string().optional(),
})

export interface AppEnv {
  PORT: number
  HOST: string
  LOG_LEVEL: LogLevel
  LOCALIX_DB_FILE: string
  LOCALIX_DEFAULT_USER_ID: string
  LOCALIX_UI_DIR?: string
  LOCALIX_UI_ORIGINS?: string
  LOCALIX_CLI_ENTRY?: string
}

export function loadEnv(source: Record<string, string | undefined> = process.env): AppEnv {
  return envSchema.parse(source)
}
