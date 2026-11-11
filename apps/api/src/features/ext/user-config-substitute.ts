import { join } from 'node:path'

import type { PluginConfigValues } from '../plugins/config'

/**
 * `${user_config.KEY}` substitution in the shell text of a plugin's hooks and helpers, and the
 * plugin data folder. A plugin's MCP servers are resolved by the plugin kit
 * (`plugins/kit/scope-session.ts`).
 *
 * Pure module — no chat/UI imports.
 */

/**
 * CC `${CLAUDE_PLUGIN_DATA}` — persistent directory for plugin-owned user artifacts.
 * Resolves to `~/.localix/plugin-data/<id>`, `<id>` the plugin identifier (`name@marketplace`, or
 * the bare name for a plugin from no marketplace) with non-alphanumeric chars replaced by `-` (mirrors the CC spec which uses `~/.claude/plugins/data/<id>` —
 * we are a different host, so OUR canonical data dir is the substitution value).
 * Native plugins receive the same path as `ctx.dataDir`; opaque runtime state stays
 * separately under `ctx.stateDir`.
 */
export function pluginDataDir(pluginId: string, home: string): string {
  const root = join(home, '.localix', 'plugin-data')
  const dir = join(root, pluginId.replace(/[^a-zA-Z0-9_-]/g, '-'))
  return dir
}

/** Server fields Claude Code runs through a shell: a plugin option there would be re-parsed. */
const SHELL_FIELDS = ['headersHelper'] as const

/** A plugin-option token — `${user_config.KEY}` or its `${CLAUDE_PLUGIN_OPTION_KEY}` alias. */
const OPTION_TOKEN_RE = /\$\{(?:user_config\.|CLAUDE_PLUGIN_OPTION_)[\w.-]+(?::-[^}]*)?\}/

/** The shell-run field of a raw server entry that references a plugin option, if any. */
export function mcpShellFieldReferencingOption(raw: object): string | null {
  for (const field of SHELL_FIELDS) {
    const value: unknown = Reflect.get(raw, field)
    if (typeof value === 'string' && OPTION_TOKEN_RE.test(value)) return field
  }
  return null
}

/**
 * `${user_config.KEY}` tokens ONLY — the explicit CC form. Deliberately narrower
 * than a plain token: in a SHELL string a bare `${KEY}` is legitimate shell
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
