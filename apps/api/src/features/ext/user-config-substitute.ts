import { join } from 'node:path'

import type { PluginConfigValues } from '../plugins/config'
import { normalizeTokenKey } from './manifest-substitute'

/**
 * Section-aware `${KEY}` substitution for a plugin MCP server entry.
 *
 * ## Secret boundary (CC spec parity)
 *
 * Per the Claude Code plugin spec, `${user_config.KEY}` substitution in MCP
 * server configs excludes sensitive values EXCEPT inside the server's `env`
 * block — env is the sanctioned channel for secrets to reach the spawned
 * server process. Concretely:
 *
 *   - `env` values MAY substitute sensitive config keys;
 *   - every other string field (command, args, url, headers, headersHelper, …)
 *     substitutes only NON-sensitive keys — a sensitive key referenced there is
 *     left UNSUBSTITUTED (the literal `${…}` token survives) and reported in
 *     {@link McpSubstitutionResult.blockedSensitiveKeys} so the caller can warn.
 *
 * A key resolves from plugin config first; if unset, from host `process.env` by the
 * `environment` policy:
 *   - `declared` (a legacy manifest): ONLY when the plugin DECLARED that key in its manifest
 *     `config`; an undeclared `${KEY}` resolves to '' — such a plugin can't silently read host
 *     environment it never asked for.
 *   - `claude-code` (a plugin in the Claude Code format): any variable, as Claude Code expands
 *     them — except that a credential-like name reads as empty in a remote server's `url` and
 *     `headers`, as it does there. A stdio server inherits that environment anyway.
 * `${KEY:-default}` fallback is supported.
 * Token keys are normalized via the shared `normalizeTokenKey` (strips the
 * `CLAUDE_PLUGIN_OPTION_` / `user_config.` prefixes, never coerces casing).
 *
 * Pure module — no chat/UI imports.
 */

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v)
}

/**
 * CC `${CLAUDE_PLUGIN_DATA}` — persistent directory for plugin-owned user artifacts.
 * Resolves to `~/.localix/plugin-data/<id>` where `<id>` replaces non-alphanumeric
 * chars with `-` (mirrors the CC spec which uses `~/.claude/plugins/data/<id>` —
 * we are a different host, so OUR canonical data dir is the substitution value).
 * Native plugins receive the same path as `ctx.dataDir`; opaque runtime state stays
 * separately under `ctx.stateDir`.
 * Lives here (not `./mcp`) so the cc-hooks feature can import it without pulling
 * in MCP record synthesis; `./mcp` re-exports it for historical importers.
 */
export function pluginDataDir(pluginName: string, home: string): string {
  const id = pluginName.replace(/[^a-zA-Z0-9_-]/g, '-')
  return join(home, '.localix', 'plugin-data', id)
}

/**
 * `~/.localix/plugin-state/<name>` — the plugin's opaque runtime state (`ctx.stateDir`).
 *
 * Both roots take the home they live in, the same one discovery was given. They read the process
 * home themselves, and every plugin context a test built — about thirty fixture plugins — left a
 * `plugin-state/` and `plugin-data/` directory in the developer's real `~/.localix`.
 */
export function pluginStateDir(pluginName: string, home: string): string {
  return join(home, '.localix', 'plugin-state', pluginName)
}

export interface McpSubstitutionResult {
  /** The server entry with tokens substituted (secret policy applied). */
  value: Record<string, unknown>
  /** Sensitive config keys referenced OUTSIDE `env` — left unsubstituted. */
  blockedSensitiveKeys: string[]
}

export type McpEnvironmentPolicy = 'declared' | 'claude-code'

/** Names Claude Code treats as credentials: empty in a remote server's `url` and `headers`. */
const CREDENTIAL_NAME =
  /TOKEN|SECRET|PASSWORD|PASSWD|API_?KEY|ACCESS_?KEY|PRIVATE_?KEY|CREDENTIAL|AUTH/i
const REMOTE_FIELDS = new Set(['url', 'headers'])

interface SubstituteCtx {
  config: PluginConfigValues
  allowedEnvKeys: ReadonlySet<string>
  environment: McpEnvironmentPolicy
  /** The top-level field being substituted (`url`, `args`, …). */
  field: string
  isSensitive: (key: string) => boolean
  blocked: Set<string>
}

const TOKEN_RE = /\$\{([\w.]+)(?::-([^}]*))?\}/g

function substituteString(text: string, inEnv: boolean, ctx: SubstituteCtx): string {
  return text.replace(TOKEN_RE, (full, key: string, fallback: string | undefined) => {
    const bare = normalizeTokenKey(key)
    if (!inEnv && ctx.isSensitive(bare)) {
      // Sensitive value outside the sanctioned env channel: keep the literal
      // token (never leak the value into command/args/url/headers) and record
      // the key so the caller can surface a warning.
      ctx.blocked.add(bare)
      return full
    }
    const v = ctx.config[bare]
    if (v !== undefined && v !== '') return String(v)
    const fromEnv = envAllowed(bare, ctx) ? process.env[bare] : undefined
    if (fromEnv !== undefined && fromEnv !== '') return fromEnv
    return fallback ?? ''
  })
}

function envAllowed(key: string, ctx: SubstituteCtx): boolean {
  if (ctx.environment === 'declared') return ctx.allowedEnvKeys.has(key)
  return !(REMOTE_FIELDS.has(ctx.field) && CREDENTIAL_NAME.test(key))
}

function walk(value: unknown, inEnv: boolean, ctx: SubstituteCtx): unknown {
  if (typeof value === 'string') return substituteString(value, inEnv, ctx)
  if (Array.isArray(value)) return value.map((v) => walk(v, inEnv, ctx))
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) out[k] = walk(v, inEnv, ctx)
    return out
  }
  return value
}

/** Substitute `${KEY}` tokens in one raw MCP server entry (secret policy applied). */
export function substituteMcpServerEntry(
  raw: Record<string, unknown>,
  config: PluginConfigValues,
  allowedEnvKeys: ReadonlySet<string>,
  isSensitive: (key: string) => boolean,
  environment: McpEnvironmentPolicy = 'declared',
): McpSubstitutionResult {
  const blocked = new Set<string>()
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(raw)) {
    const ctx: SubstituteCtx = {
      config,
      allowedEnvKeys,
      isSensitive,
      blocked,
      environment,
      field: k,
    }
    // Only the server's TOP-LEVEL `env` object is the sanctioned secret channel.
    out[k] = walk(v, k === 'env', ctx)
  }
  return { value: out, blockedSensitiveKeys: [...blocked].sort() }
}

/** Collect every `${KEY}` token referenced anywhere in a plugin's MCP config (for validation). */
export function collectMcpConfigTokens(
  servers: Record<string, Record<string, unknown>>,
): Set<string> {
  const tokens = new Set<string>()
  const walkTokens = (value: unknown): void => {
    if (typeof value === 'string') {
      for (const m of value.matchAll(TOKEN_RE)) tokens.add(normalizeTokenKey(m[1]))
    } else if (Array.isArray(value)) {
      for (const v of value) walkTokens(v)
    } else if (isPlainObject(value)) {
      for (const v of Object.values(value)) walkTokens(v)
    }
  }
  walkTokens(servers)
  return tokens
}

/**
 * `${user_config.KEY}` tokens ONLY — the explicit CC form. Deliberately narrower
 * than {@link TOKEN_RE}: in a SHELL string a bare `${KEY}` is legitimate shell
 * parameter expansion (`${HOME}`, `${PATH:-/bin}`) and must never be rewritten.
 */
const USER_CONFIG_TOKEN_RE = /\$\{user_config\.([\w.-]+)(?::-([^}]*))?\}/g

export interface ShellSubstitutionResult {
  /** The text with non-sensitive `${user_config.KEY}` tokens substituted. */
  value: string
  /** Sensitive config keys referenced — left unsubstituted (token survives). */
  blockedSensitiveKeys: string[]
}

export interface ShellBindingResult extends ShellSubstitutionResult {
  /** The variables the rewritten command reads — every one set, empty when unset in config. */
  env: Record<string, string>
}

/** The shell variable a `${user_config.KEY}` token reads: CC's `CLAUDE_PLUGIN_OPTION_<KEY>`. */
export function userConfigShellVar(key: string): string {
  return `CLAUDE_PLUGIN_OPTION_${key.replace(/[^A-Za-z0-9_]/gu, '_')}`
}

/**
 * Bind `${user_config.KEY}` tokens in a SHELL command (a hook `command`) to environment
 * variables instead of pasting their values into the command text.
 *
 * THE DEFECT THIS STOPS. A pasted value is parsed by `sh -c` as shell SOURCE, so a config value
 * such as `$(touch PWNED)` — or a quote that closes the author's quoting — ran as a command. Each
 * token becomes `${CLAUDE_PLUGIN_OPTION_<KEY>}` (keeping a `:-fallback`), and the value travels in
 * {@link ShellBindingResult.env}: the shell EXPANDS a variable but never re-parses what it expands
 * to, so the value is data wherever the author put the token, quoted or not. Every referenced
 * variable is set — to `''` when the key is unset — so an ambient variable of the same name in the
 * user's login shell cannot stand in for the plugin's own config.
 *
 * A `secret: true` key is never bound (the literal token survives and is reported), exactly as
 * before: per the CC spec a credential does not ride in a shell-form command.
 */
export function bindUserConfigInShell(
  text: string,
  config: PluginConfigValues,
  isSensitive: (key: string) => boolean,
): ShellBindingResult {
  const blocked = new Set<string>()
  const env: Record<string, string> = {}
  const value = text.replace(
    USER_CONFIG_TOKEN_RE,
    (full, key: string, fallback: string | undefined) => {
      if (isSensitive(key)) {
        blocked.add(key)
        return full
      }
      const name = userConfigShellVar(key)
      const v = config[key]
      env[name] = v === undefined || v === null ? '' : String(v)
      return fallback === undefined ? `\${${name}}` : `\${${name}:-${fallback}}`
    },
  )
  return { value, env, blockedSensitiveKeys: [...blocked].sort() }
}

/**
 * Substitute `${user_config.KEY}` tokens in TEXT that is not run by a shell — a hook's http `url`.
 * A `secret: true` key is NEVER substituted here — the literal token survives (and is reported) so
 * a credential can't leak into a URL. Non-sensitive keys substitute normally; an unset key resolves
 * to its `:-fallback` or `''`. A shell command must use {@link bindUserConfigInShell} instead.
 */
export function substituteUserConfigInText(
  text: string,
  config: PluginConfigValues,
  isSensitive: (key: string) => boolean,
): ShellSubstitutionResult {
  const blocked = new Set<string>()
  const value = text.replace(
    USER_CONFIG_TOKEN_RE,
    (full, key: string, fallback: string | undefined) => {
      if (isSensitive(key)) {
        blocked.add(key)
        return full
      }
      const v = config[key]
      if (v !== undefined && v !== '') return String(v)
      return fallback ?? ''
    },
  )
  return { value, blockedSensitiveKeys: [...blocked].sort() }
}

/** Collect the `${user_config.KEY}` keys referenced in one shell-form string. */
export function collectUserConfigShellTokens(text: string): Set<string> {
  const keys = new Set<string>()
  for (const m of text.matchAll(USER_CONFIG_TOKEN_RE)) keys.add(m[1])
  return keys
}

/**
 * Collect `${KEY}` tokens referenced OUTSIDE the servers' top-level `env` blocks —
 * the positions where sensitive config keys are NOT substituted. Static validation
 * intersects this with the manifest's `secret: true` keys to warn authors.
 */
export function collectMcpTokensOutsideEnv(
  servers: Record<string, Record<string, unknown>>,
): Set<string> {
  const outside: Record<string, Record<string, unknown>> = {}
  for (const [name, server] of Object.entries(servers)) {
    if (!isPlainObject(server)) continue
    const { env: _env, ...rest } = server
    outside[name] = rest
  }
  return collectMcpConfigTokens(outside)
}
