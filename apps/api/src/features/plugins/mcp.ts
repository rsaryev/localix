import type { McpServerRecord } from '../mcp/repository'
import { mcpServerShape } from './kit'
import type { DiscoveredPlugin } from './discovery'
import type { Resolved, ResolvedMcpServer } from '@rsaryev/llx-plugin'

// `pluginDataDir` lives in `../ext/user-config-substitute` (shared with cc-hooks).
export { pluginDataDir } from '../ext/user-config-substitute'

/**
 * The MCP server records of one enabled plugin, from the servers its scope's kit session resolved
 * (`kit/scope-session.ts`): each keyed `plugin:<plugin>:<server>`, named `<plugin>_<server>` so its
 * tools surface as `mcp_<plugin>_<server>_<tool>` and never collide with the user's own servers.
 */
export function buildMcpRecords(
  plugin: DiscoveredPlugin,
  servers: Resolved<ResolvedMcpServer>,
  userId: string,
  timestamp: string,
  logger?: { warn: (msg: string, meta?: unknown) => void },
): McpServerRecord[] {
  const prefix = `plugin:${plugin.manifest.name}:`
  return servers.resolved.flatMap((resolved) => {
    if (!resolved.key.startsWith(prefix)) return []
    const name = `${plugin.manifest.name}_${resolved.name}`
    const input = mcpServerShape(name, resolved.server)
    if (!input) {
      logger?.warn(`plugin "${plugin.manifest.name}" MCP server "${resolved.name}" is invalid`)
      return []
    }
    const config = input.config as Record<string, unknown>
    // A stdio process gets the path variables beneath its own `env`; a remote server's helper is
    // a shell command run in the plugin's directory (`kit/settings/mcp-remote.ts`).
    const finalConfig =
      input.transport === 'stdio'
        ? { ...config, env: { ...resolved.environment, ...(config.env as object | undefined) } }
        : typeof config.headersHelper === 'string'
          ? { ...config, headersHelperRoot: plugin.dir }
          : config
    return [
      {
        id: resolved.key,
        userId,
        projectId: plugin.projectId,
        name: input.name,
        description: '',
        transport: input.transport,
        config: finalConfig,
        // The kit resolved every `${…}` token; connecting must not expand the VALUES again (an
        // option set to `${GITHUB_TOKEN}` would read the host credential into a remote header).
        configExpanded: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ]
  })
}
