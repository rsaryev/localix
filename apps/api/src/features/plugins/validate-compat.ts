import type { DiscoveredPlugin } from './discovery'
import type { PluginValidation } from './contracts'
import { editDistance, isUnsafeRelPath, isKebabCase } from '../ext/manifest-validate'
import { CC_HOOK_EVENTS } from '../cc-hooks/contracts'

/**
 * Cross-spec (Claude Code) compatibility checks. Emits only WARNINGS — never blocks load.
 */

/**
 * Claude Code manifest fields this host does NOT implement. A ported Claude Code
 * plugin may declare them; they load harmlessly (our zod schema strips unknown
 * keys) but do nothing here, so the compatibility check warns the author what
 * won't run. Host-ignored fields are surfaced as warnings and never block.
 */
const UNSUPPORTED_CC_FIELDS: Record<string, string> = {
  outputStyles: 'output styles are not a plugin component in this host',
  settings: 'plugin settings.json (default agent activation) is not supported',
  // The removed second loading path. A plugin could mirror its whole `register()` output
  // here and get deferred activation; the mirror had to be exact and complete, which no
  // plugin contributing a resource/search/context provider could satisfy. One loading
  // path now — say so, rather than letting a stale block look load-bearing.
  contributes:
    'native contributions are read from the plugin module, not the manifest — every plugin loads the same way',
}
// NOTE: `dependencies` IS honored — resolved/auto-installed on marketplace install and
// cascaded (trust-gated) on enable; see dependencies.ts. Git-tag version pins
// ({plugin}--v{version}) are deferred, and version ranges are advisory (warn-only) —
// neither warrants a per-manifest warning here.
// NOTE: a plugin's `bin/` DIRECTORY is supported — an enabled plugin's `<dir>/bin`
// is prepended to the bash tool's PATH (see plugins/loader.ts `binDirs`). The
// mechanism keys off the directory convention, so `bin` is not flagged here.

/**
 * Fields that belong in a marketplace.json entry, NOT in a plugin.json manifest.
 * Finding them in plugin.json usually means the manifest was copied from a marketplace
 * catalog entry without cleaning up the extra keys.
 */
const MARKETPLACE_ONLY_FIELDS = new Set(['source', 'strict', 'id'])

/** Known manifest fields (ours + CC metadata) that are silently accepted. */
const KNOWN_FIELDS = new Set([
  'name',
  'version',
  'description',
  'apiVersion',
  'private',
  'defaultEnabled',
  'author',
  'displayName',
  'category',
  'homepage',
  'repository',
  'license',
  'keywords',
  'migratedFrom',
  'surfaces',
  'tools',
  'skills',
  'commands',
  'mcpServers',
  'config',
  'promptSections',
  // `panels` is the pre-unification name for `views`; promoted at parse, warned below.
  'panels',
  'views',
  'agents',
  'contributions',
  'channels',
  'fileAssociations',
  // CC fields we explicitly handle or silently accept:
  'userConfig',
  '$schema',
  'lspServers',
  'hooks',
  'outputStyles',
  'bin',
  'settings',
  'dependencies',
  'monitors',
  'experimental',
  // CC metadata for marketplace entries / plugin discovery
  'links',
  'readme',
  'changelog',
  'icon',
  'categories',
  // Marketplace-only fields (flagged with a specific warning, not "unrecognized")
  'source',
  'strict',
  'id',
])

/**
 * Cross-spec compatibility check against the raw (pre-zod) manifest. Emits only
 * WARNINGS — never blocks. A manifest written for the official Claude Code spec still
 * loads, but the author is told which fields/shapes this host won't honor.
 */
export function validateCompatibility(plugin: DiscoveredPlugin): PluginValidation {
  const warnings: string[] = []
  const raw = plugin.rawManifest
  if (!raw) return { errors: [], warnings }

  // Warn on unrecognized top-level fields; suggest likely intended name when close.
  for (const field of Object.keys(raw)) {
    if (KNOWN_FIELDS.has(field)) continue
    // Linear scan of all known fields for closest-match suggestion.
    let suggestion: string | undefined
    for (const k of KNOWN_FIELDS) {
      if (editDistance(field, k) <= 2) {
        suggestion = k
        break
      }
    }
    warnings.push(
      suggestion
        ? `Unrecognized manifest field "${field}" — did you mean "${suggestion}"?`
        : `Unrecognized manifest field "${field}" — it will be ignored.`,
    )
  }

  // The legacy inspector-panel array. It still LOADS — promoted into `views` before
  // parse — but the two-contracts-one-iframe split is gone, so say so once here rather
  // than letting the author discover it from a tab that opened somewhere unexpected.
  if (raw.panels !== undefined) {
    warnings.push(
      'Manifest field "panels" is the former name of "views" — it is loaded as views (each panel `name` becomes a view `id`) and every view opens as a work-item tab. Rename it to "views".',
    )
  }

  for (const [field, why] of Object.entries(UNSUPPORTED_CC_FIELDS)) {
    if (raw[field] !== undefined) {
      warnings.push(`Claude Code field "${field}" is declared but this host ignores it (${why}).`)
    }
  }

  // Declarative hooks: the manifest `hooks` field (a path string, array of paths,
  // or an inline object) IS honored — resolved into the same cc-hooks pipeline the
  // settings-file hooks + `hooks/hooks.json` use. All five handler types run
  // (command, http, mcp_tool, prompt, agent — each on the events the CC matrix
  // allows; see features/cc-hooks/contracts.ts). Only advisory: events this host
  // does not dispatch (Setup, PostCompact, PermissionRequest, FileChanged, …)
  // never fire. The event list is imported from cc-hooks so it can't drift.
  if (raw.hooks !== undefined) {
    warnings.push(
      `Claude Code "hooks" are loaded: all handler types (command, http, mcp_tool, prompt, agent) run on the dispatched events — ${CC_HOOK_EVENTS.join(', ')}. Hooks on any other Claude Code event (e.g. Setup, PostCompact, PermissionRequest, FileChanged) are not dispatched by this host and never fire.`,
    )
  }

  // Marketplace-only fields in a plugin.json — almost always a copy-paste from a
  // marketplace.json entry. These are silently ignored at load time (unknown keys are
  // stripped by zod), but flagging them prevents silent config drift.
  for (const field of MARKETPLACE_ONLY_FIELDS) {
    if (raw[field] !== undefined) {
      warnings.push(
        `Field "${field}" belongs in a marketplace.json entry, not in plugin.json — it is ignored at runtime.`,
      )
    }
  }

  // `experimental.monitors` (or top-level `monitors`) — background monitors ARE honored.
  // `experimental.monitors` is promoted to top-level `monitors`; a `monitors/monitors.json`
  // file is read when neither is present. `when:"always"` monitors spawn while the plugin
  // is enabled and each stdout line is delivered to the model as a notification (via the
  // wake primitive). Only advisory: `on-skill-invoke:<skill>` monitors are parsed +
  // registered but their lazy start is deferred (no skill-invocation seam yet).
  const experimental = raw.experimental
  const hasExpMonitors =
    experimental &&
    typeof experimental === 'object' &&
    'monitors' in (experimental as Record<string, unknown>)
  if (hasExpMonitors && raw.monitors === undefined) {
    warnings.push(
      '"experimental.monitors" was automatically promoted to top-level "monitors" — consider moving it to the top level directly.',
    )
  } else if (hasExpMonitors && raw.monitors !== undefined) {
    warnings.push(
      'Both "experimental.monitors" and top-level "monitors" are declared — "experimental.monitors" is ignored when "monitors" is already at top level.',
    )
  }
  const declaredMonitors = plugin.entrypoints.monitors ?? []
  if (declaredMonitors.some((m) => m.when !== 'always')) {
    warnings.push(
      'Claude Code "on-skill-invoke:<skill>" monitors are parsed and registered, but their lazy start is deferred (this host does not yet hook skill invocation). "when: always" monitors run while the plugin is enabled.',
    )
  }

  // CC names user config `userConfig`; this host reads `config` (and maps userConfig automatically).
  if (raw.userConfig !== undefined && raw.config === undefined) {
    warnings.push(
      'Claude Code field "userConfig" was automatically mapped to "config" — rename it in the manifest to avoid this warning.',
    )
  } else if (raw.userConfig !== undefined && raw.config !== undefined) {
    warnings.push(
      'Both "userConfig" and "config" are declared — "userConfig" is ignored when "config" is already present.',
    )
  }

  // Path traversal + absolute path checks for string path fields (security + portability nudge).
  for (const field of ['tools', 'commands', 'agents', 'skills', 'mcpServers'] as const) {
    const value = raw[field]
    const entries = Array.isArray(value) ? value : typeof value === 'string' ? [value] : []
    for (const entry of entries) {
      if (typeof entry !== 'string') continue
      if (entry.includes('..')) {
        warnings.push(
          `Manifest "${field}" path "${entry}" contains ".." — paths must stay inside the plugin directory and are dropped on load.`,
        )
      } else if (isUnsafeRelPath(entry)) {
        // Absolute paths (Unix /path, Windows C:\path or \\server\share) are rejected by toAbsList.
        warnings.push(
          `Manifest "${field}" path "${entry}" is absolute — use a relative path starting with "./" (e.g. "./${entry.replace(/^[/\\]+/, '')}")`,
        )
      }
    }
  }

  // CC REPLACE semantics advisory — emitted ONLY when behavior actually differs from
  // the old additive scan: a CC-origin plugin whose manifest lists `commands`/`agents`
  // paths while the default dir also exists (the default dir is now NOT scanned).
  for (const field of plugin.entrypoints.ccReplacedDefaults ?? []) {
    warnings.push(
      `Claude Code REPLACE semantics: the manifest lists "${field}" paths, so the default "${field}/" directory is NOT scanned (it exists in this plugin). List "./${field}" explicitly to keep both.`,
    )
  }

  // Kebab-case name: our schema accepts underscores/camel, but the Claude.ai
  // marketplace sync requires strict kebab-case.
  if (!plugin.error && !isKebabCase(plugin.manifest.name)) {
    warnings.push(
      `Plugin name "${plugin.manifest.name}" is not kebab-case — this host accepts it, but a Claude Code marketplace sync requires lowercase letters, digits, and hyphens only.`,
    )
  }

  return { errors: [], warnings }
}
