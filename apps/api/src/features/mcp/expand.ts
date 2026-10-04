/**
 * Claude-Code-compatible environment variable expansion for MCP server configs.
 *
 * Supported syntax (per the CC `.mcp.json` reference):
 *   - `${VAR}`          → the value of `VAR`, or '' when unset
 *   - `${VAR:-default}` → the value of `VAR` when set, otherwise `default`
 *
 * Expansion is applied at CONNECT time (not when a record is stored) so the same
 * config works across machines: it's read fresh from `process.env` plus a small
 * set of injected extras (e.g. `CLAUDE_PROJECT_DIR`). Applied to `command`,
 * `args`, `env` values, `url`, and `headers` — the fields CC documents.
 *
 * Pure module: the environment map is injected so it's trivially testable.
 */

const VAR_RE = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g

/** Expand `${VAR}` / `${VAR:-default}` in a single string against `env`. */
export function expandString(input: string, env: Record<string, string | undefined>): string {
  return input.replace(VAR_RE, (_full, name: string, fallback: string | undefined) => {
    const value = env[name]
    if (value !== undefined && value !== '') return value
    return fallback ?? ''
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
): Record<string, string> | undefined {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return undefined
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(record as Record<string, unknown>)) {
    if (typeof v === 'string') out[k] = expandString(v, env)
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
  if (typeof config.url === 'string') out.url = expandString(config.url, env)
  const headers = expandStringRecord(config.headers, env)
  if (headers) out.headers = headers

  return out
}
