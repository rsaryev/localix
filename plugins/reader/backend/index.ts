import { join } from 'node:path'

import { createStoreChangeFeed } from '@localixai/plugin-sdk/backend'
import type { PluginContext, PluginRegistration } from '@localixai/plugin-sdk/backend'

import { createReaderContextProvider } from './context-provider'
import { createReaderResourceProvider } from './resource-provider'
import { createReaderRoutes } from './routes'
import { createReaderResearchTool } from './research-tool'
import { createReaderSearchProvider } from './search-provider'
import { ReaderService } from './service'
import { ReaderStatsService } from './stats'

export function register(context: PluginContext): PluginRegistration {
  const service = new ReaderService(context.host, {
    filePath: join(context.dataDir, 'library.json'),
    helpers: context.helpers,
  })
  const feed = createStoreChangeFeed({
    plugin: 'reader',
    resolveDir: async () => context.dataDir,
    subscribeWrites: () => () => {},
    watchPath: context.watchPath ?? context.host?.watchPath,
    onExternalChange: () => service.invalidateLibrary(),
    acceptPath: (_userId, file) => file === join(context.dataDir, 'library.json'),
  })
  const resourceProvider = createReaderResourceProvider(service)
  const statsService = new ReaderStatsService({
    filePath: join(context.dataDir, 'stats.json'),
    helpers: context.helpers,
  })
  return {
    backend: [
      {
        id: 'reader:backend',
        wsFrames: feed.wsFrames,
        onShutdown: feed.onShutdown,
        routeMount: {
          path: '/rpc/reader',
          app: createReaderRoutes(service, statsService),
        },
        resourceProvider,
        searchProvider: createReaderSearchProvider(service),
        contextProviders: [createReaderContextProvider(resourceProvider)],
      },
    ],
    tools: [createReaderResearchTool(context, service)],
  }
}
