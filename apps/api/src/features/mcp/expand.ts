/**
 * Claude-Code-compatible environment variable expansion for MCP server configs.
 *
 * Supported syntax (per the CC `.mcp.json` reference):
 *   - `${VAR}`          → the value of `VAR`; unset and without a default, the `${VAR}` text stays
 *                         as written, as Claude Code keeps it
 *   - `${VAR:-default}` → the value of `VAR` when set, otherwise `default`
 * In `url` and `headers` — what reaches a remote server — a credential name reads as empty,
 * default or not (`lib/credential-env-name.ts`).
 *
 * Expansion is applied at CONNECT time (not when a record is stored) so the same
 * config works across machines: it's read fresh from `process.env` plus a small
 * set of injected extras (e.g. `CLAUDE_PROJECT_DIR`). Applied to `command`,
 * `args`, `env` values, `url`, and `headers` — the fields CC documents.
 *
 * Pure module: the environment map is injected so it's trivially testable.
 */
import { isCredentialEnvName } from '../../lib/credential-env-name'

const REMOTE = { remote: true }

const VAR_RE = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g

/** Expand `${VAR}` / `${VAR:-default}` in a single string against `env`. */
export function expandString(
  input: string,
  env: Record<string, string | undefined>,
  options: { remote?: boolean } = {},
): string {
  return input.replace(VAR_RE, (full, name: string, fallback: string | undefined) => {
    if (options.remote && isCredentialEnvName(name)) return ''
    const value = env[name]
    if (value !== undefined && value !== '') return value
    return fallback ?? full
  })
}

function expandStringArray(
  values: unknown,
  env: Record<string, string | undefined>,
): string[] | undefined {
  if (!Array.isArray(values)) return undefined
  return values.map((v) => (typeof v === 'string' ? expandString(v, env) : String(v)))
}

function expandStringRecord(
  record: unknown,
  env: Record<string, string | undefined>,
  options: { remote?: boolean } = {},
): Record<string, string> | undefined {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return undefined
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(record as Record<string, unknown>)) {
    if (typeof v === 'string') out[k] = expandString(v, env, options)
  }
  return out
}

/**
 * Return a copy of a server `config` with `${VAR}` expansion applied to every
 * documented field. Non-documented fields (tool filters, timeout) pass through
 * untouched. `env` defaults to `process.env` merged with `extraEnv`.
 */
export function expandServerConfig(
  config: Record<string, unknown>,
  options: {
    env?: Record<string, string | undefined>
    /** Injected extras (e.g. `{ CLAUDE_PROJECT_DIR: cwd }`) layered over `env`. */
    extraEnv?: Record<string, string | undefined>
  } = {},
): Record<string, unknown> {
  const env: Record<string, string | undefined> = {
    ...(options.env ?? process.env),
    ...options.extraEnv,
  }
  const out: Record<string, unknown> = { ...config }

  if (typeof config.command === 'string') {
    out.command = expandString(config.command, env)
  } else if (Array.isArray(config.command)) {
    out.command = expandStringArray(config.command, env)
  }
  const args = expandStringArray(config.args, env)
  if (args) out.args = args
  const cfgEnv = expandStringRecord(config.env, env)
  if (cfgEnv) out.env = cfgEnv
  if (typeof config.url === 'string') out.url = expandString(config.url, env, REMOTE)
  const headers = expandStringRecord(config.headers, env, REMOTE)
  if (headers) out.headers = headers

  return out
}

/**
 * The config a server connects with: {@link expandServerConfig} applied, unless the record's
 * config was resolved when it was built (`configExpanded`, a plugin's server). Expanding that
 * one again would read `${VAR}` out of a substituted VALUE — a plugin option whose value is
 * `${GITHUB_TOKEN}` would put the host credential in a remote server's headers.
 */
export function connectServerConfig(
  server: { config: Record<string, unknown>; configExpanded?: boolean },
  options: Parameters<typeof expandServerConfig>[1] = {},
): Record<string, unknown> {
  if (server.configExpanded) return { ...server.config }
  return expandServerConfig(server.config, options)
}
