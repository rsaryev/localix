/**
 * Composition-root helper: build the global-search service.
 *
 * ONE registry fans a text query out across domain providers. Each provider is a
 * narrow port over an already-constructed feature service; the SERVICE (not the
 * registry) owns ranking / grouping / pagination so a future agent tool reuses
 * the SAME path. Providers are registered in the order their groups should appear
 * — that order is the contract, so keep it stable.
 *
 * Extracted from `bootstrap.ts` (Long Function): pure composition over explicit
 * params, no shared mutable bootstrap state.
 */
import type { Kysely } from 'kysely'
import type { AppDatabase } from '../db/types'
import { createSearchProviderRegistry } from '../features/agent-core/search/provider'
import { createSearchService } from '../features/search/service'
import { createProjectsSearchProvider } from '../features/projects/search-provider'
import {
  createSessionsSearchProvider,
  createMessagesSearchProvider,
  createFilesSearchProvider,
  shareOverlappingSessionSearchReads,
} from '../features/chat/search-provider'
import { createChatRepository } from '../features/chat/repository'
import { createSecretsSearchProvider } from '../features/secrets/search-provider'
import { createSkillsSearchProvider } from '../features/skills-curator/search-provider'
import { createPluginsSearchProvider } from '../features/plugins/search-provider'
import { createMcpSearchProvider } from '../features/mcp/search-provider'
import { createAgentsSearchProvider } from '../features/agents/search-provider'
import { createModelsSearchProvider } from '../features/catalog/search-provider'
import type { PluginBackendHost } from '../features/plugins/backend-host'
import type { createChatService } from '../features/chat/service'
import type { createProjectsService } from '../features/projects/service'
import type { createSecretsService } from '../features/secrets/service'
import type { createSkillsCuratorService } from '../features/skills-curator/service'
import type { createPluginService } from '../features/plugins/service'
import type { createMcpService } from '../features/mcp/service'
import type { createAgentsService } from '../features/agents/service'
import type { createCatalogService } from '../features/catalog/service'

/** How long eager search may reuse the runtime adapter's model catalog. */
const MODELS_CACHE_TTL_MS = 30_000

export interface SearchCompositionDeps {
  db: Kysely<AppDatabase>
  projectsService: ReturnType<typeof createProjectsService>
  chatService: ReturnType<typeof createChatService>
  /** A bundled subsystem (workbench plugin) contributes its own search provider —
   *  LIVE through the backend host, so a hot plugin toggle adds/removes its group. */
  backendHost: Pick<PluginBackendHost, 'setSearchRegistry'>
  secretsService: ReturnType<typeof createSecretsService>
  skillsCuratorService: ReturnType<typeof createSkillsCuratorService>
  pluginService: ReturnType<typeof createPluginService>
  mcpService: ReturnType<typeof createMcpService>
  agentsService: ReturnType<typeof createAgentsService>
  catalogService: ReturnType<typeof createCatalogService>
}

export function buildSearchService(
  deps: SearchCompositionDeps,
): ReturnType<typeof createSearchService> {
  const {
    db,
    projectsService,
    chatService,
    backendHost,
    secretsService,
    skillsCuratorService,
    pluginService,
    mcpService,
    agentsService,
    catalogService,
  } = deps
  const registry = createSearchProviderRegistry()

  registry.register(
    createProjectsSearchProvider({
      listProjects: async (userId) =>
        (await projectsService.listProjects(userId)).projects.map((p) => ({
          id: p.id,
          name: p.name,
          workingDir: p.workingDir,
        })),
    }),
  )

  const chatRepo = createChatRepository(db)
  const chatSearchPort = {
    listSessions: shareOverlappingSessionSearchReads((userId, projectId) =>
      chatRepo.listSessionSearchRows(userId, projectId),
    ),
    searchMessages: (userId: string, q: string, limit: number) =>
      chatService.searchHistoryDetailed(userId, q, limit),
  }
  registry.register(createSessionsSearchProvider(chatSearchPort))
  registry.register(createMessagesSearchProvider(chatSearchPort))

  // A bundled subsystem's search provider is wired LIVE by the plugin backend host:
  // handing it the registry
  // here registers the already-wired subsystems' providers at this exact spot
  // (between messages and files — that is where their groups appear), and a later
  // hot enable/disable adds/removes providers through the same registry. A
  // hot-enabled provider's group appears last instead of here — cosmetic only.
  backendHost.setSearchRegistry(registry)
  registry.register(
    createFilesSearchProvider({
      findFiles: (userId, sessionId, q) => chatService.findFiles(userId, sessionId, q),
      searchContent: (userId, sessionId, q) => chatService.searchContent(userId, sessionId, q),
    }),
  )
  registry.register(
    createSecretsSearchProvider({
      listItems: async (userId) =>
        (await secretsService.list(userId)).map((item) => ({
          key: item.key,
          label: item.label,
          type: item.type,
        })),
    }),
  )
  registry.register(
    createSkillsSearchProvider({
      listSkills: async (userId, projectId) =>
        (await skillsCuratorService.listSkills(userId, { projectId })).map((s) => ({
          name: s.name,
          description: s.description,
        })),
    }),
  )
  registry.register(
    createPluginsSearchProvider({
      listPlugins: async (userId, projectId) =>
        (await pluginService.listPlugins(userId, { projectId })).plugins.map((p) => ({
          name: p.name,
          displayName: p.displayName,
          description: p.description,
        })),
    }),
  )
  registry.register(
    createMcpSearchProvider({
      listServers: async (userId, projectId) =>
        (await mcpService.listServers(userId, { projectId })).servers.map((s) => ({
          name: s.name,
          description: s.description,
        })),
    }),
  )
  registry.register(
    createAgentsSearchProvider({
      listAgents: async (userId, projectId) =>
        (await agentsService.listAgents(userId, { projectId })).map((agent) => ({
          name: agent.record.handle,
          label: agent.record.label,
          description: agent.record.description,
        })),
    }),
  )
  // Cache the resolved catalog briefly so eager search does not re-enter the adapter
  // per keystroke.
  let modelsCache: { at: number; list: Array<{ id: string; name: string }> } | null = null
  registry.register(
    createModelsSearchProvider({
      listModels: async () => {
        if (modelsCache && Date.now() - modelsCache.at < MODELS_CACHE_TTL_MS)
          return modelsCache.list
        const list = (await catalogService.getCatalog()).models.map((m) => ({
          id: m.id,
          name: m.name,
        }))
        modelsCache = { at: Date.now(), list }
        return list
      },
    }),
  )

  return createSearchService({ registry })
}
