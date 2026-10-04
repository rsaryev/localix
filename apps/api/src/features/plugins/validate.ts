import { basename } from 'node:path'

import type { DiscoveredPlugin } from './discovery'
import { PLUGIN_API_VERSION, type PluginValidation } from './contracts'
import type { PluginConfigValues } from './config'
import { collectMcpConfigTokens, collectMcpTokensOutsideEnv } from './mcp'
import { collectHookUserConfigTokens } from '../cc-hooks/config'
import { validateCompatibility } from './validate-compat'
import { validatePluginSkills } from './validate-skill'
import { validatePluginCommands, validatePluginAgents } from './validate-fields'
import { checkApiVersion, isRequiredConfigMissing } from '../ext/manifest-validate'

/**
 * Core plugin/skill validation — the single source of truth surfaced as structured
 * errors/warnings in `/plugin list` and Settings → Plugins. Dependency-light
 * (node:fs only) so it can run during discovery without importing plugin code.
 *
 * Errors are blocking problems (a malformed manifest, a skill missing required
 * frontmatter); warnings are non-fatal hygiene issues (an empty prompt/body, a
 * name that doesn't match its directory). The runtime can choose to load anyway.
 */

/**
 * Built-in path variables always injected into MCP config substitution — never need a
 * `config` declaration and must NOT trigger the "undeclared key" warning.
 */
const BUILTIN_PLUGIN_VARS = new Set([
  'CLAUDE_PLUGIN_ROOT',
  'CLAUDE_PLUGIN_DATA',
  'CLAUDE_PROJECT_DIR',
])

/**
 * Validate a discovered plugin's static surface. Checks (76 total):
 * manifest parse, API version, discoverability metadata (description/author/version),
 * defaultEnabled trust gate, dir name; commands (unique names, description, prompt,
 * arg order/duplicates/argHint, choice options/duplicates/empty values/placeholder,
 * allowedTools/disallowedTools); agents (unique names, description, prompt, tools,
 * effort, pinnedSkills, credential-like names); panel/promptSection
 * deduplication; MCP shape; config quality (description, credential-not-secret,
 * secret+default, required+default, type mismatch, invalid keys, builtin-var shadowing);
 * required config not set; CC compat (validateCompatibility).
 * All are warnings except manifest parse + API over-version.
 */
export function validatePlugin(
  plugin: DiscoveredPlugin,
  opts?: {
    config?: PluginConfigValues
    /**
     * CC `--strict` mode: promote all warnings to errors. Useful in CI to
     * catch misspelled fields or leftover foreign manifest keys before publishing.
     */
    strict?: boolean
  },
): PluginValidation {
  const errors: string[] = []
  const warnings: string[] = []

  // Manifest parse / read failure → hard error.
  if (plugin.error) errors.push(plugin.error)
  for (const diagnostic of plugin.entrypoints.diagnostics ?? []) {
    errors.push(`${diagnostic.message}: ${diagnostic.path}`)
  }

  // API version compatibility. Missing → assume current (with a nudge); newer → block.
  checkApiVersion('Plugin', PLUGIN_API_VERSION, plugin.manifest.apiVersion, errors, warnings)

  // Warn on missing discoverability metadata: descriptions explain purpose, Settings shows
  // authors, and explicit versions let users track updates.
  if (!plugin.error && !plugin.manifest.description.trim()) {
    warnings.push('Manifest has no description — add one so users know what this plugin does.')
  }
  if (!plugin.error && !plugin.manifest.author) {
    warnings.push(
      'Manifest has no author — add "author" for plugin attribution (shown in Settings).',
    )
  }
  // `version` defaults to "0.0.0" if absent; nudge to set an explicit semver string.
  if (!plugin.error && plugin.rawManifest && !('version' in plugin.rawManifest)) {
    warnings.push('Manifest has no version — add "version": "1.0.0" to help users track updates.')
  }
  if (!plugin.error && plugin.rawManifest && !('license' in plugin.rawManifest)) {
    warnings.push(
      'Manifest has no license — add an SPDX identifier and preserve separate upstream notices for adapted work.',
    )
  }

  // `defaultEnabled: true` only applies to bundled plugins — installed/dropped-in ones
  // are always opt-in (the trust gate), so the flag is silently ignored for them.
  if (plugin.manifest.defaultEnabled === true && !plugin.bundled) {
    warnings.push(
      '"defaultEnabled": true is ignored for an installed plugin — enable it manually (the trust gate keeps dropped-in plugins opt-in).',
    )
  }

  // The directory name is the install/dedup key (install copies to <root>/<name>,
  // remove deletes by it) — a mismatch makes Settings show one name while the disk
  // shows another, so nudge authors to keep them aligned.
  const dirName = basename(plugin.dir)
  if (!plugin.error && dirName !== plugin.manifest.name) {
    warnings.push(
      `Manifest name "${plugin.manifest.name}" doesn't match its directory "${dirName}" — installs/removals key on the manifest name.`,
    )
  }

  // Inline command + custom-agent declarations are validated in focused helpers
  // (./validate-fields) — each accumulates its own errors/warnings, merged here.
  const cmdValidation = validatePluginCommands(plugin)
  errors.push(...cmdValidation.errors)
  warnings.push(...cmdValidation.warnings)
  const agentValidation = validatePluginAgents(plugin)
  errors.push(...agentValidation.errors)
  warnings.push(...agentValidation.warnings)

  // Panels and promptSections are both keyed by a name/title — duplicates silently
  // shadow or compound. Errors for load-time entities (panel); warnings for
  // runtime/prompt contributions (promptSections).
  const dedupeInto = (
    bucket: string[],
    kind: string,
    values: (string | undefined)[],
    suffix = 'must be unique within a plugin',
  ): void => {
    const seen = new Set<string>()
    for (const v of values) {
      if (!v) continue
      if (seen.has(v)) bucket.push(`Duplicate ${kind} "${v}" — ${suffix}.`)
      seen.add(v)
    }
  }
  dedupeInto(
    errors,
    'view',
    (plugin.manifest.views ?? []).map((v) => v.id),
  )
  // Duplicate arg names within a command make it unpredictable.
  for (const cmd of plugin.commands) {
    if (cmd.args.length > 1) {
      dedupeInto(
        errors,
        `command "${cmd.name}" arg`,
        cmd.args.map((a) => a.name),
      )
    }
  }
  dedupeInto(
    warnings,
    'promptSection title',
    (plugin.manifest.promptSections ?? []).map((s) => s.title),
    'use distinct titles to avoid redundant system-prompt sections',
  )
  // Whitespace-only content passes zod min(1) but contributes nothing to the system prompt.
  for (const section of plugin.manifest.promptSections ?? []) {
    if (!section.content.trim()) {
      warnings.push(
        `promptSection "${section.title}" has whitespace-only content — it adds nothing to the system prompt.`,
      )
    }
  }
  // A `promptSection` injects STATIC text into the shared, cacheable system prompt for
  // every applicable run. It is a compatibility path only: dynamic, per-run or
  // per-resource context must come through a Context Fabric contribution
  // (`BackendSubsystem.contextProviders`), which is destination-scoped, budgeted,
  // policy-filtered and content-diagnosed — never appended verbatim to the global
  // prompt. Flag (never block) so authors migrate dynamic context off the prompt.
  if ((plugin.manifest.promptSections ?? []).length > 0) {
    warnings.push(
      'promptSections inject STATIC text into the shared system prompt (compatibility path, capped at 3×2000 chars). For dynamic or per-resource context prefer a Context Fabric provider (contextProviders) — it is destination-scoped, budgeted and privacy-filtered.',
    )
  }

  // MCP server entries should look shaped (a launchable command or a remote url).
  for (const [name, server] of Object.entries(plugin.entrypoints.mcpServers)) {
    // command can be a string (shell form) or a non-empty string array (exec form).
    const hasCommand =
      (typeof server.command === 'string' && server.command.length > 0) ||
      (Array.isArray(server.command) &&
        server.command.length > 0 &&
        typeof server.command[0] === 'string')
    const hasUrl = typeof server.url === 'string' && server.url.length > 0
    if (!hasCommand && !hasUrl) {
      warnings.push(`MCP server "${name}" declares neither a command nor a url.`)
    }
  }

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
  for (const token of collectMcpConfigTokens(plugin.entrypoints.mcpServers)) {
    if (!declaredKeys.has(token) && !BUILTIN_PLUGIN_VARS.has(token)) {
      warnings.push(
        `MCP config references "\${${token}}" which isn't declared in "config" (it resolves to empty).`,
      )
    }
  }

  // Sensitive (`secret: true`) config keys are substituted ONLY into an MCP server's
  // `env` block (CC spec: `${user_config.KEY}` excludes sensitive values elsewhere).
  // A sensitive token in command/args/url/headers is left unsubstituted at load time.
  for (const token of collectMcpTokensOutsideEnv(plugin.entrypoints.mcpServers)) {
    if (plugin.manifest.config?.[token]?.secret) {
      warnings.push(
        `MCP config references sensitive key "\${${token}}" outside "env" — sensitive values are only substituted into the server's "env" block; the token is left unsubstituted. Move it to "env".`,
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
        `Config "${key}" is "secret: true" but also has a non-empty default — the default value will be visible in plugin.json, defeating the purpose of marking it secret.`,
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

  // Cross-spec compatibility (Claude Code fields/shapes this host won't honor).
  const compat = validateCompatibility(plugin)
  warnings.push(...compat.warnings)

  // `--strict` mode: promote all warnings to errors (mirrors CC `claude plugin validate --strict`).
  if (opts?.strict && warnings.length > 0) {
    return { errors: [...errors, ...warnings], warnings: [] }
  }
  return { errors, warnings }
}

/**
 * The CANONICAL full validation of a plugin: the synchronous manifest / commands /
 * agents / compat checks ({@link validatePlugin}) merged with the async SKILL.md
 * checks ({@link validatePluginSkills}). This is the single source of truth reused by
 * BOTH the plugin service (Settings → Plugins / `/plugins`) and the dev CLI
 * (`scripts/validate-plugins.ts`) — callers must not re-implement the merge. `strict`
 * promotes the COMBINED warning set (manifest + skills) to errors.
 */
export async function validatePluginFull(
  plugin: DiscoveredPlugin,
  opts?: { config?: PluginConfigValues; strict?: boolean },
): Promise<PluginValidation> {
  const [manifest, skills] = await Promise.all([
    Promise.resolve(validatePlugin(plugin, { config: opts?.config })),
    validatePluginSkills(plugin),
  ])
  const errors = [...manifest.errors, ...skills.errors]
  const warnings = [...manifest.warnings, ...skills.warnings]
  if (opts?.strict && warnings.length > 0) return { errors: [...errors, ...warnings], warnings: [] }
  return { errors, warnings }
}
