import { errorMessage } from '../../lib/errors'
import type { McpServerRecord } from '../mcp/repository'
import { normalizeMcpServerEntry } from '../mcp/normalize'
import type { DiscoveredPlugin } from './discovery'
import { declaredConfigKeys, type PluginConfigValues } from './config'
import { pluginDataDir, substituteMcpServerEntry } from '../ext/user-config-substitute'

// Substitution internals + token collectors + `pluginDataDir` live in
// `../ext/user-config-substitute` (shared with cc-hooks); re-exported here so historical
// importers keep working.
export {
  isPlainObject,
  collectMcpConfigTokens,
  mcpShellFieldReferencingOption,
  pluginDataDir,
} from '../ext/user-config-substitute'

/**
 * Build the `CLAUDE_PLUGIN_OPTION_<KEY>` env-var map for a plugin's resolved config.
 *
 * Per the CC spec, each declared config key is exported to spawned MCP server processes
 * as `CLAUDE_PLUGIN_OPTION_<KEY>` (KEY = the exact declared key, case preserved). Sensitive
 * options ARE included, as they are wherever `${user_config.KEY}` substitutes in an MCP server's
 * config. Only keys with a resolved value are emitted.
 *
 * The caller merges this map AFTER the manifest-declared `env` block so that an explicit
 * manifest env var for the same name is never clobbered.
 */
export function buildPluginOptionEnv(config: PluginConfigValues): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, val] of Object.entries(config)) {
    if (val !== undefined && val !== null) {
      out[`CLAUDE_PLUGIN_OPTION_${key}`] = String(val)
    }
  }
  return out
}

/** Build synthesized MCP records for a plugin's bundled servers (config-substituted). */
export function buildMcpRecords(
  plugin: DiscoveredPlugin,
  config: PluginConfigValues,
  userId: string,
  timestamp: string,
  /** The home the plugin's data root lives in (→ `${CLAUDE_PLUGIN_DATA}`), as discovery was given. */
  home: string,
  logger?: { warn: (msg: string, meta?: unknown) => void },
  opts?: {
    /** Session project working directory → ${CLAUDE_PROJECT_DIR}. */
    projectDir?: string
  },
): McpServerRecord[] {
  const allowedEnvKeys = declaredConfigKeys(plugin.manifest)
  // Inject CC plugin path variables into config so they resolve in MCP entries.
  const enrichedConfig: PluginConfigValues = {
    ...config,
    CLAUDE_PLUGIN_ROOT: plugin.dir,
    CLAUDE_PLUGIN_DATA: pluginDataDir(plugin.manifest.name, home),
    ...(opts?.projectDir ? { CLAUDE_PROJECT_DIR: opts.projectDir } : {}),
  }

  // Build the CLAUDE_PLUGIN_OPTION_<KEY> env map from the plugin's user config values
  // (not enrichedConfig — path vars are not user config and should not be emitted).
  const pluginOptionEnv = buildPluginOptionEnv(config)

  // Sensitive options substitute like any other, as in Claude Code: none of these fields reaches
  // a shell. A `headersHelper` that references one throws, and the server is skipped below.
  const records: McpServerRecord[] = []
  for (const [serverName, raw] of Object.entries(plugin.entrypoints.mcpServers)) {
    try {
      const { value: substituted } = substituteMcpServerEntry(
        serverName,
        raw,
        enrichedConfig,
        allowedEnvKeys,
        // A plugin in the Claude Code format expands environment variables as Claude Code does.
        plugin.layout === 'legacy' ? 'declared' : 'claude-code',
      )
      // Namespace with the plugin name so tools surface as mcp_<plugin>_<server>_<tool>
      // and never collide with the user's own MCP servers.
      const input = normalizeMcpServerEntry(
        `${plugin.manifest.name}_${serverName}`,
        substituted,
        '',
      )
      const baseConfig = input.config as Record<string, unknown>

      // Inject CLAUDE_PLUGIN_OPTION_<KEY> into the MCP server's env block.
      // Manifest-declared env vars take priority — we only add keys not already set.
      let finalConfig = baseConfig
      if (input.transport === 'stdio' && Object.keys(pluginOptionEnv).length > 0) {
        const manifestEnv = (baseConfig.env as Record<string, string> | undefined) ?? {}
        const mergedEnv: Record<string, string> = {
          // Plugin option vars first (lower priority)
          ...pluginOptionEnv,
          // Manifest env vars override (higher priority — never clobbered)
          ...manifestEnv,
        }
        finalConfig = { ...baseConfig, env: mergedEnv }
      }

      records.push({
        id: `plugin:${plugin.manifest.name}:${serverName}`,
        userId,
        projectId: plugin.projectId,
        name: input.name,
        description: input.description ?? '',
        transport: input.transport,
        config: finalConfig,
        // Every `${…}` token was resolved above; connecting must not expand the VALUES again (an
        // option set to `${GITHUB_TOKEN}` would read the host credential into a remote header).
        configExpanded: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
    } catch (err) {
      logger?.warn(`plugin "${plugin.manifest.name}" MCP server "${serverName}" is invalid`, {
        error: errorMessage(err),
      })
    }
  }
  return records
}
