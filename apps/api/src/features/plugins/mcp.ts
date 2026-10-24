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
  mcpShellFieldReferencingOption,
  pluginDataDir,
} from '../ext/user-config-substitute'

/**
 * Build the `CLAUDE_PLUGIN_OPTION_<KEY>` env-var map for a plugin's resolved config.
 *
 * Per the CC spec, each declared config key is exported to spawned MCP server processes
 * as `CLAUDE_PLUGIN_OPTION_<KEY>`, the key uppercased as Claude Code names it for hooks. Sensitive
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
      out[`CLAUDE_PLUGIN_OPTION_${key.toUpperCase().replace(/[^A-Z0-9_]/gu, '_')}`] = String(val)
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
  const dataDir = pluginDataDir(plugin.manifest.name, home)
  const enrichedConfig: PluginConfigValues = {
    ...config,
    CLAUDE_PLUGIN_ROOT: plugin.dir,
    CLAUDE_PLUGIN_DATA: dataDir,
    ...(opts?.projectDir ? { CLAUDE_PROJECT_DIR: opts.projectDir } : {}),
  }

  // What a stdio server's process is given beneath its manifest `env`: the plugin's two path
  // variables, which Claude Code exports to the process (manifest reference, "Exported to the
  // process"), and the CLAUDE_PLUGIN_OPTION_<KEY> map of the user's config values.
  const processEnv: Record<string, string> = {
    CLAUDE_PLUGIN_ROOT: plugin.dir,
    CLAUDE_PLUGIN_DATA: dataDir,
    ...buildPluginOptionEnv(config),
  }

  // Sensitive options substitute like any other, as in Claude Code: none of these fields reaches
  // a shell. A `headersHelper` that references one throws, and the server is skipped below.
  const records: McpServerRecord[] = []
  for (const [serverName, raw] of Object.entries(plugin.entrypoints.mcpServers)) {
    // A packaged server with a required setting that has no saved value does not start (CC).
    const missing = (plugin.entrypoints.mcpBundles?.required[serverName] ?? []).filter(
      (key) => config[key] === undefined || config[key] === '',
    )
    if (missing.length) {
      logger?.warn(
        `Bundled MCP server "${serverName}" was not started: it needs configuration (${missing.join(', ')})`,
      )
      continue
    }
    try {
      const { value: substituted } = substituteMcpServerEntry(
        serverName,
        raw,
        enrichedConfig,
        allowedEnvKeys,
        // A plugin expands environment variables as Claude Code does.
        'claude-code',
      )
      // Namespace with the plugin name so tools surface as mcp_<plugin>_<server>_<tool>
      // and never collide with the user's own MCP servers.
      const input = normalizeMcpServerEntry(
        `${plugin.manifest.name}_${serverName}`,
        substituted,
        '',
      )
      const baseConfig = input.config as Record<string, unknown>

      // Manifest-declared env vars take priority — the exported ones only fill keys not set.
      let finalConfig = baseConfig
      if (input.transport === 'stdio') {
        const manifestEnv = (baseConfig.env as Record<string, string> | undefined) ?? {}
        finalConfig = { ...baseConfig, env: { ...processEnv, ...manifestEnv } }
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
