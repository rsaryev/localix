import { localixWorkspaceDir } from '../../lib/env'
import type { McpServerRecord } from '../mcp/repository'
import { buildPluginCatalog } from './catalog'
import { catalogMcpServers } from './catalog-kit'
import type { LocalixPluginHost } from './kit'
import { pluginLoadBlockReason } from './load-block'
import type { DeclarativeLoadOptions } from './loader-declarative'
import { buildMcpRecords } from './mcp'

/**
 * The enabled plugins' MCP server records for one scope, built from manifest data alone — the
 * same records the full loader hands a run (`loader.ts`), without importing any plugin code. The
 * boot uses it to start a Claude Code channel a chat was bound to (`mcp/mcp-channels.ts`). The
 * enable state and the load block stay the trust gate, as in every other load.
 */
export async function loadEnabledPluginMcpServers(
  opts: DeclarativeLoadOptions & { pluginHost: LocalixPluginHost; now?: () => string },
): Promise<McpServerRecord[]> {
  const cwd = opts.cwd ?? localixWorkspaceDir()
  const catalog = await buildPluginCatalog({
    repo: opts.repo,
    availability: opts.availability,
    userId: opts.userId,
    projectId: opts.projectId ?? '',
    cwd,
    homeDir: opts.homeDir,
  })
  const servers = await catalogMcpServers(opts.pluginHost, catalog, {
    cwd,
    homeDir: opts.homeDir,
  })
  const at = (opts.now ?? (() => new Date().toISOString()))()
  return catalog.enabled.flatMap(({ plugin }) =>
    pluginLoadBlockReason(plugin) ? [] : buildMcpRecords(plugin, servers, opts.userId, at),
  )
}
