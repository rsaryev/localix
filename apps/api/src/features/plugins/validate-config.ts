import type { DiscoveredPlugin } from './discovery'
import type { MiniAppConfigValues } from './config'
import { collectMcpConfigTokens, mcpShellFieldReferencingOption } from './mcp'
import { collectHookUserConfigTokens } from '../cc-hooks/config'
import { isRequiredConfigMissing } from '../ext/manifest-validate'

/**
 * Built-in path variables always injected into MCP config substitution — never need a
 * `config` declaration and must NOT trigger the "undeclared key" warning.
 */
const BUILTIN_PLUGIN_VARS = new Set([
  'CLAUDE_PLUGIN_ROOT',
  'CLAUDE_PLUGIN_DATA',
  'CLAUDE_PROJECT_DIR',
])

/** Accumulate configuration diagnostics in the caller's existing validation order. */
export function validatePluginConfig(
  plugin: DiscoveredPlugin,
  warnings: string[],
  opts?: { config?: MiniAppConfigValues },
): void {
  // `${KEY}` tokens in MCP config that aren't declared in `config` resolve to '' and
  // can't read host env — flag them so a typo doesn't silently blank a value.
  // Exception: built-in path vars (BUILTIN_PLUGIN_VARS) are always injected.
  const declaredKeys = new Set(Object.keys(plugin.manifest.config ?? {}))
  for (const key of declaredKeys) {
    // Warn if a config key shadows a built-in plugin path var.
    if (BUILTIN_PLUGIN_VARS.has(key)) {
      warnings.push(
        `Config key "${key}" shadows the built-in path variable \${${key}} — the built-in value always wins; rename the key to avoid confusion.`,
      )
    }
    // Config keys used in ${KEY} substitution must be valid word characters.
    if (!/^\w+$/.test(key)) {
      warnings.push(
        `Config key "${key}" contains non-word characters — it can't be referenced as \${${key}} in templates (use letters, digits, and underscores only).`,
      )
    }
  }
  // A Claude Code-format plugin reads undeclared `${VAR}` from the environment, as there.
  const readsEnvironment = plugin.layout !== 'legacy'
  for (const token of collectMcpConfigTokens(plugin.entrypoints.mcpServers)) {
    if (!readsEnvironment && !declaredKeys.has(token) && !BUILTIN_PLUGIN_VARS.has(token)) {
      warnings.push(
        `MCP config references "\${${token}}" which isn't declared in "config" (it resolves to empty).`,
      )
    }
  }

  // Options, sensitive ones included, substitute anywhere in an MCP server's config, as in Claude
  // Code — except `headersHelper`, which runs through a shell: such a server does not load.
  for (const [name, server] of Object.entries(plugin.entrypoints.mcpServers)) {
    const field = mcpShellFieldReferencingOption(server)
    if (field) {
      warnings.push(
        `MCP server "${name}" references \${user_config.*} in "${field}" — the value would be re-parsed by a shell, so the server does not load. Read the value inside the helper script (e.g. from an env var set in the server's "env" block).`,
      )
    }
  }

  // Hook commands / http urls are SHELL-form strings — `${user_config.KEY}` there
  // never substitutes sensitive values (CC spec: shell-form rejects sensitive
  // substitution). A sensitive token in a hook command is left unsubstituted at
  // load time, so warn the author to route the value through env instead.
  const hookTokens = new Set<string>()
  for (const rawHooks of plugin.entrypoints.hookConfigs) {
    for (const token of collectHookUserConfigTokens(rawHooks)) hookTokens.add(token)
  }
  for (const token of hookTokens) {
    if (plugin.manifest.config?.[token]?.secret) {
      warnings.push(
        `Hook command references sensitive key "\${user_config.${token}}" — sensitive values are never substituted into hook commands (shell strings); the token is left unsubstituted. Read the value from the environment instead.`,
      )
    }
  }

  // `${KEY}` tokens in promptSections content that aren't declared in `config` resolve to ''.
  // Built-in path vars are exempt (substituted by the loader).
  for (const section of plugin.manifest.promptSections ?? []) {
    for (const m of section.content.matchAll(/\$\{([\w.]+)\}/g)) {
      const key = m[1].startsWith('user_config.') ? m[1].slice('user_config.'.length) : m[1]
      if (!declaredKeys.has(key) && !BUILTIN_PLUGIN_VARS.has(key)) {
        warnings.push(
          `promptSection "${section.title}" content references "\${${m[1]}}" which isn't declared in "config" (it resolves to empty).`,
        )
      }
    }
  }

  // Validate config fields — description, required+default inconsistency, type mismatch, and unset required.
  for (const [key, opt] of Object.entries(plugin.manifest.config ?? {})) {
    if (!opt.description.trim()) {
      warnings.push(
        `Config "${key}" has no description — add a description so users know what to enter in Settings.`,
      )
    }
    if (opt.required && opt.default !== undefined) {
      warnings.push(
        `Config "${key}" is "required: true" but also has a default — either remove "required" or remove the default (a default makes it not truly required).`,
      )
    }
    // Config key name or description looks like a credential but isn't marked secret.
    // Matches: exact credential names + suffix patterns (*_API_KEY, *_TOKEN, *_SECRET).
    const looksLikeSecret =
      /^(api_?key|api_?token|access_?token|auth_?token|secret_?key|private_?key|bot_?token|auth_?key|password|credential|SECRET)$/i.test(
        key,
      ) ||
      /_(api_?key|api_?token|access_?token|auth_?token|secret|webhook_?token|bot_?token|password)$/i.test(
        key,
      ) ||
      /\b(api key|api token|access token|auth token|secret key|private key|bot token|password)\b/i.test(
        opt.description,
      )
    if (looksLikeSecret && !opt.secret) {
      warnings.push(
        `Config "${key}" looks like a credential but "secret: false" — add "secret: true" to mask the value in Settings.`,
      )
    }
    if (opt.secret && opt.default !== undefined && opt.default !== '') {
      warnings.push(
        `Config "${key}" is "secret: true" but also has a non-empty default — the default value will be visible in the manifest, defeating the purpose of marking it secret.`,
      )
    }
    if (opt.default !== undefined) {
      const defaultType = opt.default === null ? 'null' : typeof opt.default
      if (opt.type === 'number' && defaultType !== 'number') {
        warnings.push(
          `Config "${key}" has type "number" but its default value "${opt.default}" is ${defaultType}.`,
        )
      } else if (opt.type === 'boolean' && defaultType !== 'boolean') {
        warnings.push(
          `Config "${key}" has type "boolean" but its default value "${opt.default}" is ${defaultType}.`,
        )
      }
    }
    if (opts?.config) {
      const value = opts.config[key]
      if (isRequiredConfigMissing(opt, value)) {
        warnings.push(`Required config "${key}" is not set.`)
      }
    }
  }
}
