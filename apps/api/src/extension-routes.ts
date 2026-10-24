/**
 * What a person adds to Localix, mounted under `/rpc` as one group: MCP servers, Claude Code
 * plugins, mini apps, and the Store that lists, installs and updates every package kind. Each
 * owner keeps its own routes for its own pages (X3); the Store reaches them only through the
 * providers `bootstrap/` hands it (`docs/internals/store.md`).
 *
 * One module so a new package kind adds a route here, not a line to `app.ts`, which is the
 * composition of the whole API and is held to its size pin.
 */
import { Hono } from 'hono'

import type { AppContext } from './app'
import { createMcpRoutes, type McpRoutesService } from './features/mcp/routes'
import { createMiniAppRoutes, type MiniAppRoutesService } from './features/mini-apps/routes'
import { createPluginRoutes, type PluginRoutesService } from './features/plugins/routes'
import { createStoreRoutes } from './features/store/routes'
import { createEmptyStoreService } from './features/store/empty'
import type { StoreService } from './features/store/service'

export interface ExtensionRouteDeps {
  mcpService: McpRoutesService
  pluginService: PluginRoutesService
  miniAppService: MiniAppRoutesService
  /** The Store over every provider; a harness without one gets a Store with none. */
  storeService?: StoreService
}

export function createExtensionRoutes(deps: ExtensionRouteDeps) {
  return new Hono<AppContext>()
    .route('/mcp', createMcpRoutes(deps.mcpService))
    .route('/plugins', createPluginRoutes(deps.pluginService))
    .route('/mini-apps', createMiniAppRoutes(deps.miniAppService))
    .route('/store', createStoreRoutes(deps.storeService ?? createEmptyStoreService()))
}
