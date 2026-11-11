import { basename, dirname } from 'node:path'

import type { DiscoveredPlugin } from './discovery'
import type { PluginValidation } from './contracts'
import type { PluginConfigValues } from './config'
import { validateCompatibility } from './validate-compat'
import { validatePluginConfig } from './validate-config'
import { validatePluginCommands, validatePluginAgents } from './validate-fields'
import { issueLine, validatePluginFolder } from './kit'

/**
 * Core plugin/skill validation — the single source of truth surfaced as structured
 * errors/warnings in `/plugin list` and the Store. Runs during discovery
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
  // What the kit found loading the plugin (`kit/catalog`).
  for (const found of plugin.manifestIssues ?? []) {
    const line = issueLine(found)
    if (line !== plugin.error) (found.severity === 'error' ? errors : warnings).push(line)
  }

  // A default `agent` runs one of the plugin's own agents as the main thread; any other name
  // would leave the setting without effect.
  const mainAgent = plugin.entrypoints.components?.settings.agent
  if (
    mainAgent &&
    !plugin.agents.some((agent) =>
      [agent.name, `${plugin.manifest.name}:${agent.name}`].includes(mainAgent),
    )
  )
    warnings.push(`settings "agent" names "${mainAgent}", which is not one of this plugin's agents`)

  // Warn on a missing description: it explains what the plugin is for. Author, version and
  // license nudges are for authors; a Claude Code plugin was not written for this host, so its
  // user gets none they can't act on.
  if (!plugin.error && !plugin.manifest.description.trim()) {
    warnings.push('Manifest has no description — add one so users know what this plugin does.')
  }

  // The directory name is the install/dedup key (install copies to <root>/<name>,
  // remove deletes by it) — a mismatch makes Settings show one name while the disk
  // shows another, so nudge authors to keep them aligned.
  const dirName = basename(plugin.dir)
  // Claude Code's own cache keeps a plugin at `cache/<marketplace>/<name>/<version>`: the version
  // is the folder, and the name is the one above it.
  const inVersionedCache =
    basename(dirname(plugin.dir)) === plugin.manifest.name &&
    basename(dirname(dirname(dirname(plugin.dir)))) === 'cache'
  if (!plugin.error && dirName !== plugin.manifest.name && !inVersionedCache) {
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
 * The CANONICAL full validation of a plugin: what the kit's `claude plugin validate` finds (its
 * SKILL.md files and commands included) and the synchronous Localix checks
 * ({@link validatePlugin}). This is the single source of truth reused by BOTH the plugin service
 * (the Store / `/plugins`) and the dev CLI (`scripts/validate-plugins.ts`) — callers must not
 * re-implement the merge. `strict` promotes the COMBINED warning set to errors.
 */
export async function validatePluginFull(
  plugin: DiscoveredPlugin,
  opts?: { config?: PluginConfigValues; strict?: boolean },
): Promise<PluginValidation> {
  const manifest = validatePlugin(plugin, { config: opts?.config })
  const kit = await validatePluginFolder(plugin.dir)
  // The kit's validation repeats much of what its loading found: each message once.
  const errors = [...new Set([...manifest.errors, ...kit.errors])]
  const warnings = [...new Set([...manifest.warnings, ...kit.warnings])]
  if (opts?.strict && warnings.length > 0) return { errors: [...errors, ...warnings], warnings: [] }
  return { errors, warnings }
}
