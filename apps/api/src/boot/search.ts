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
import {
  createSearchProviderRegistry,
  type SearchProvider,
} from '../features/agent-core/search/provider'
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
import type { MiniAppBackendHost } from '../features/mini-apps/backend-host'
import type { createChatService } from '../features/chat/service'
import type { createProjectsService } from '../features/projects/service'
import type { createSecretsService } from '../features/secrets/service'
import type { createSkillsCuratorService } from '../features/skills-curator/service'
import type { createPluginService } from '../features/plugins/service'
import type { createMcpService } from '../features/mcp/service'
import type { createAgentsService } from '../features/agents/service'
import type { createCatalogService } from '../features/catalog/service'
import type { SemanticService } from '../features/embeddings/service'
import { createMessageSearchReads } from '../features/chat/repository-message-search'
import { registerCapabilitySemantics } from '../bootstrap/capability-semantic'

/** How long eager search may reuse the runtime adapter's model catalog. */
const MODELS_CACHE_TTL_MS = 30_000

export interface SearchCompositionDeps {
  db: Kysely<AppDatabase>
  projectsService: ReturnType<typeof createProjectsService>
  chatService: ReturnType<typeof createChatService>
  /** A bundled subsystem (workbench mini app) contributes its own search provider —
   *  LIVE through the backend host, so a hot mini app toggle adds/removes its group. */
  backendHost: Pick<MiniAppBackendHost, 'setSearchRegistry'>
  secretsService: ReturnType<typeof createSecretsService>
  skillsCuratorService: ReturnType<typeof createSkillsCuratorService>
  pluginService: ReturnType<typeof createPluginService>
  mcpService: ReturnType<typeof createMcpService>
  agentsService: ReturnType<typeof createAgentsService>
  catalogService: ReturnType<typeof createCatalogService>
  /** Semantic search: when on, providers with a collection fuse meaning with words. */
  semanticService?: SemanticService
  /** Whose capability catalogs are indexed (the workspace owner). */
  owner: string
  /** The Store's packages not yet installed: its group comes after everything installed. */
  storeSearchProvider?: SearchProvider
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
    semanticService,
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
    hybridReads: createMessageSearchReads(db),
  }
  registry.register(createSessionsSearchProvider(chatSearchPort))
  registry.register(createMessagesSearchProvider(chatSearchPort))

  // A bundled subsystem's search provider is wired LIVE by the mini app backend host:
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

  if (deps.storeSearchProvider) registry.register(deps.storeSearchProvider)

  // The meaning half of the skill, plugin, MCP and agent groups: each its own collection.
  if (semanticService) {
    registerCapabilitySemantics({
      db,
      owner: deps.owner,
      semantic: semanticService,
      projects: projectsService,
      skills: skillsCuratorService,
      plugins: pluginService,
      mcp: mcpService,
      agents: agentsService,
    })
  }

  return createSearchService({
    registry,
    ...(semanticService
      ? {
          strategy: {
            note: () => semanticService.strategy(),
            queryFor: (userId: string, text: string) =>
              semanticService.reader.queryFor(userId, text),
          },
        }
      : {}),
  })
}
