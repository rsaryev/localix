import { join } from 'node:path'

import { isCredentialEnvName } from '../../lib/credential-env-name'
import type { PluginConfigValues } from '../plugins/config'
import { normalizeTokenKey } from './manifest-substitute'

/**
 * `${KEY}` substitution for a plugin MCP server entry.
 *
 * ## Plugin options (Claude Code parity)
 *
 * Claude Code substitutes `${user_config.KEY}` everywhere in an MCP server's config — `command`,
 * `args`, `env`, `url`, `headers` — sensitive options included: none of those strings reaches a
 * shell, so a value stays data. The one exception is `headersHelper`, a command Claude Code hands
 * to a shell, where a value containing `$(…)`, a backtick or `;` would run as code. A server whose
 * `headersHelper` references `${user_config.*}` (or `${CLAUDE_PLUGIN_OPTION_*}`) therefore fails
 * to load with {@link McpShellUserConfigError}; the check runs on the template, so it fails even
 * before a value is configured.
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
 * Resolves to `~/.localix/plugin-data/<id>`, `<id>` the plugin identifier (`name@marketplace`, or
 * the bare name for a plugin from no marketplace) with non-alphanumeric chars replaced by `-` (mirrors the CC spec which uses `~/.claude/plugins/data/<id>` —
 * we are a different host, so OUR canonical data dir is the substitution value).
 * Native plugins receive the same path as `ctx.dataDir`; opaque runtime state stays
 * separately under `ctx.stateDir`.
 * Lives here (not `./mcp`) so the cc-hooks feature can import it without pulling
 * in MCP record synthesis; `./mcp` re-exports it for historical importers.
 */
export function pluginDataDir(pluginId: string, home: string): string {
  const root = join(home, '.localix', 'plugin-data')
  const dir = join(root, pluginId.replace(/[^a-zA-Z0-9_-]/g, '-'))
  return dir
}

export interface McpSubstitutionResult {
  /** The server entry with tokens substituted. */
  value: Record<string, unknown>
}

export type McpEnvironmentPolicy = 'declared' | 'claude-code'

const REMOTE_FIELDS = new Set(['url', 'headers'])

interface SubstituteCtx {
  config: PluginConfigValues
  allowedEnvKeys: ReadonlySet<string>
  environment: McpEnvironmentPolicy
  /** The top-level field being substituted (`url`, `args`, …). */
  field: string
}

// A packaged server's option is `${user_config.<server>.<key>}`, and a server name may hold `-`.
const TOKEN_RE = /\$\{([\w.-]+)(?::-([^}]*))?\}/g

/** Server fields Claude Code runs through a shell: a plugin option there would be re-parsed. */
const SHELL_FIELDS = ['headersHelper'] as const

/** A plugin-option token — `${user_config.KEY}` or its `${CLAUDE_PLUGIN_OPTION_KEY}` alias. */
const OPTION_TOKEN_RE = /\$\{(?:user_config\.|CLAUDE_PLUGIN_OPTION_)[\w.-]+(?::-[^}]*)?\}/

/** An MCP server whose shell-run field references a plugin option: it does not load. */
export class McpShellUserConfigError extends Error {
  constructor(serverName: string) {
    super(
      `headersHelper for MCP server '${serverName}' references \${user_config.*}. The substituted value would be passed to a shell; read the value inside the helper script instead (e.g. from an env var set in the server's "env" block).`,
    )
    this.name = 'McpShellUserConfigError'
  }
}

/** The shell-run field of a raw server entry that references a plugin option, if any. */
export function mcpShellFieldReferencingOption(raw: Record<string, unknown>): string | null {
  for (const field of SHELL_FIELDS) {
    const value = raw[field]
    if (typeof value === 'string' && OPTION_TOKEN_RE.test(value)) return field
  }
  return null
}

function substituteString(text: string, ctx: SubstituteCtx): string {
  return text.replace(TOKEN_RE, (_full, key: string, fallback: string | undefined) => {
    const bare = normalizeTokenKey(key)
    const v = ctx.config[bare]
    if (v !== undefined && v !== '') return String(v)
    const fromEnv = envAllowed(bare, ctx) ? process.env[bare] : undefined
    if (fromEnv !== undefined && fromEnv !== '') return fromEnv
    return fallback ?? ''
  })
}

function envAllowed(key: string, ctx: SubstituteCtx): boolean {
  if (ctx.environment === 'declared') return ctx.allowedEnvKeys.has(key)
  return !(REMOTE_FIELDS.has(ctx.field) && isCredentialEnvName(key))
}

function walk(value: unknown, ctx: SubstituteCtx): unknown {
  if (typeof value === 'string') return substituteString(value, ctx)
  if (Array.isArray(value)) return value.map((v) => walk(v, ctx))
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) out[k] = walk(v, ctx)
    return out
  }
  return value
}

/**
 * Substitute `${KEY}` tokens in one raw MCP server entry. Throws {@link McpShellUserConfigError}
 * when `headersHelper` references a plugin option.
 */
export function substituteMcpServerEntry(
  serverName: string,
  raw: Record<string, unknown>,
  config: PluginConfigValues,
  allowedEnvKeys: ReadonlySet<string>,
  environment: McpEnvironmentPolicy = 'declared',
): McpSubstitutionResult {
  if (mcpShellFieldReferencingOption(raw)) throw new McpShellUserConfigError(serverName)
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(raw)) {
    out[k] = walk(v, { config, allowedEnvKeys, environment, field: k })
  }
  return { value: out }
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
