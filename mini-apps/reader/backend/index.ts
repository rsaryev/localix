import { join } from 'node:path'

import { createStoreChangeFeed } from '@localixai/mini-app-sdk/backend'
import type { MiniAppContext, MiniAppRegistration } from '@localixai/mini-app-sdk/backend'

import { createReaderContextProvider } from './context-provider'
import { createReaderResourceProvider } from './resource-provider'
import { createReaderRoutes } from './routes'
import { createReaderResearchTool } from './research-tool'
import { createReaderSearchProvider } from './search-provider'
import { ReaderService } from './service'
import { ReaderStatsService } from './stats'

export function register(context: MiniAppContext): MiniAppRegistration {
  const service = new ReaderService(context.host, {
    filePath: join(context.dataDir, 'library.json'),
    helpers: context.helpers,
  })
  const feed = createStoreChangeFeed({
    miniApp: 'reader',
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
