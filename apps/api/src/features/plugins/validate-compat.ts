import type { DiscoveredPlugin } from './discovery'
import type { PluginValidation } from './contracts'
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
  // LSP servers: missing binaries (with an install hint) and built-in overlap. A config the kit
  // refused is in the plugin's own issues and is not among these.
  const lspServers = Object.entries(plugin.entrypoints.lspServers).map(([name, server]) => ({
    name,
    command: server.command,
    extensions: Object.keys(server.extensionToLanguage),
  }))
  warnings.push(...pluginLspNotes(summarizePluginLspServers(lspServers)))

  return { errors: [], warnings }
}
