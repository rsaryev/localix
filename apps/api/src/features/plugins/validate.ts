import { basename } from 'node:path'

import type { DiscoveredPlugin } from './discovery'
import { PLUGIN_API_VERSION, type PluginValidation } from './contracts'
import type { PluginConfigValues } from './config'
import { validateCompatibility } from './validate-compat'
import { validatePluginSkills } from './validate-skill'
import { validatePluginConfig } from './validate-config'
import { validatePluginCommands, validatePluginAgents } from './validate-fields'
import { validateAgentContributions } from './validate-agent-contributions'
import { checkApiVersion } from '../ext/manifest-validate'

/**
 * Core plugin/skill validation — the single source of truth surfaced as structured
 * errors/warnings in `/plugin list` and Settings → Plugins. Runs during discovery
 * without importing a plugin's executable code.
 *
 * Errors are blocking problems (a malformed manifest, a skill missing required
 * frontmatter); warnings are non-fatal hygiene issues (an empty prompt/body, a
 * name that doesn't match its directory). The runtime can choose to load anyway.
 */

/**
 * Validate a discovered plugin's static surface. Checks:
 * manifest parse, API version, discoverability metadata (description/author/version),
 * defaultEnabled trust gate, dir name; commands (unique names, description, prompt,
 * arg order/duplicates/argHint, choice options/duplicates/empty values/placeholder,
 * allowedTools/disallowedTools); agents (unique names, description, prompt, tools,
 * effort, pinnedSkills, credential-like names); view/promptSection
 * deduplication; MCP shape; config quality (description, credential-not-secret,
 * secret+default, required+default, type mismatch, invalid keys, builtin-var shadowing);
 * required config not set; CC compat (validateCompatibility).
 * Errors and warnings retain the severity chosen by each owning validator.
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
  errors.push(...validateAgentContributions(plugin))
  for (const diagnostic of plugin.entrypoints.diagnostics ?? []) {
    errors.push(`${diagnostic.message}: ${diagnostic.path}`)
  }

  // API version compatibility. Missing → assume current (with a nudge); newer → block.
  // Authoring nudges (apiVersion/author/license/version) are for plugin AUTHORS; an imported
  // Claude Code plugin was not written for this host, so its user gets no nudges they can't act on.
  const imported = plugin.manifest.origin !== undefined
  const nudges = imported ? [] : warnings
  checkApiVersion('Plugin', PLUGIN_API_VERSION, plugin.manifest.apiVersion, errors, nudges)

  // Warn on missing discoverability metadata: descriptions explain purpose, Settings shows
  // authors, and explicit versions let users track updates.
  if (!plugin.error && !plugin.manifest.description.trim()) {
    warnings.push('Manifest has no description — add one so users know what this plugin does.')
  }
  if (!plugin.error && !plugin.manifest.author) {
    nudges.push('Manifest has no author — add "author" for plugin attribution (shown in Settings).')
  }
  // `version` defaults to "0.0.0" if absent; nudge to set an explicit semver string.
  if (!plugin.error && plugin.rawManifest && !('version' in plugin.rawManifest)) {
    nudges.push('Manifest has no version — add "version": "1.0.0" to help users track updates.')
  }
  if (!plugin.error && plugin.rawManifest && !('license' in plugin.rawManifest)) {
    nudges.push(
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

  // Views and promptSections are keyed by id/title — duplicates silently
  // shadow or compound. Errors for load-time entities (views); warnings for
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

  validatePluginConfig(plugin, warnings, opts)

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
