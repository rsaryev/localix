import type { DiscoveredPlugin } from './discovery'
import type { PluginValidation } from './contracts'
import { isUnsafeRelPath, isKebabCase } from '../ext/manifest-validate'
import { CC_HOOK_EVENTS, CC_INERT_HOOK_EVENTS } from '../cc-hooks/contracts'
import { pluginLspNotes, summarizePluginLspServers } from '../lsp'

/**
 * Claude Code compatibility advisories. Emits only WARNINGS — never blocks load.
 *
 * What Claude Code's own manifest rules find (an unknown field, a field of the wrong shape, a
 * path that escapes the plugin) is reported by its parser, as the plugin's `manifestIssues`
 * (`layout/compose.ts`); this adds what is particular to running the plugin in Localix.
 *
 * NOTE: `dependencies` IS honored — resolved/auto-installed on marketplace install and cascaded
 * on enable; see dependencies.ts. A plugin's `bin/` DIRECTORY is supported — an enabled plugin's
 * `<dir>/bin` is appended to the bash tool's PATH (see plugins/loader.ts `binDirs`).
 */

/**
 * Compatibility check against the composed runtime manifest (`layout/claude-code.ts`). Emits
 * only WARNINGS — never blocks: the author is told what runs differently in this host.
 */
export function validateCompatibility(plugin: DiscoveredPlugin): PluginValidation {
  const warnings: string[] = []
  const raw = plugin.rawManifest
  if (!raw) return { errors: [], warnings }

  // Declarative hooks: the manifest `hooks` field (a path string, array of paths,
  // or an inline object) IS honored — resolved into the same cc-hooks pipeline the
  // settings-file hooks + `hooks/hooks.json` use. All five handler types run
  // (command, http, mcp_tool, prompt, agent — each on the events the CC matrix
  // allows; see features/cc-hooks/contracts.ts). Only advisory: the few Claude Code
  // events with no Localix lifecycle point never fire. Both lists are imported from
  // cc-hooks so they can't drift.
  if (raw.hooks !== undefined) {
    warnings.push(
      `Claude Code "hooks" are loaded: all handler types (command, http, mcp_tool, prompt, agent) run on the dispatched events — ${CC_HOOK_EVENTS.join(', ')}. Hooks on ${Object.keys(CC_INERT_HOOK_EVENTS).join(', ')} are accepted but never fire: Localix has no lifecycle point for them.`,
    )
  }

  // Path traversal + absolute path checks for string path fields (security + portability nudge).
  for (const field of ['commands', 'agents', 'skills', 'mcpServers'] as const) {
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

  // `defaultDirs.<field>: false` advisory — only when it actually hides an existing
  // default dir (the Claude Code REPLACE rule an imported plugin carries).
  for (const field of plugin.entrypoints.ccReplacedDefaults ?? []) {
    warnings.push(
      `The manifest lists "${field}" paths with defaultDirs.${field} = false, so the default "${field}/" directory is NOT scanned (it exists in this plugin). List "./${field}" explicitly to keep both.`,
    )
  }

  // LSP servers: missing binaries (with an install hint) and built-in overlap.
  warnings.push(...pluginLspNotes(summarizePluginLspServers(plugin.entrypoints.lspServers)))

  // Kebab-case name: our schema accepts underscores/camel, but the Claude.ai
  // marketplace sync requires strict kebab-case.
  if (!plugin.error && !isKebabCase(plugin.manifest.name)) {
    warnings.push(
      `Plugin name "${plugin.manifest.name}" is not kebab-case — this host accepts it, but a Claude Code marketplace sync requires lowercase letters, digits, and hyphens only.`,
    )
  }

  return { errors: [], warnings }
}
