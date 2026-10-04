import type { PluginContext, PluginRegistration } from '@localixai/plugin-sdk/backend'

import { ROUTE_PATH } from '../shared/resource'
import { createBoardResourceProvider, createBoardSearchProvider } from './references'
import { createBoardRoutes } from './routes'
import { createBoardService } from './service'
import { createKanbanTools } from './tools'
import { createBoardWsFrames } from './ws-frames'

/**
 * The Kanban board: one passive task board per chat, kept in that chat's own folder.
 *
 * `register(ctx)` runs for the backend and again for each run's tools. Every load carries
 * `ctx.sessionStorage` and `ctx.agents`, so the tool and the routes resolve the same board and
 * assign from the same registry; the store orders their writes and announces them to every
 * open view, whichever load made them (`store.ts`).
 */
export function register(ctx: PluginContext): PluginRegistration {
  const storage = ctx.sessionStorage
  const boards = createBoardService({
    resolveDir: async (userId, sessionId) => {
      if (!storage) throw new Error('This host keeps no per-chat plugin data.')
      return storage.resolveDataDir(userId, sessionId)
    },
    ...(ctx.agents ? { agents: ctx.agents } : {}),
  })
  return {
    backend: [
      {
        id: 'kanban:backend',
        routeMount: { path: ROUTE_PATH, app: createBoardRoutes(boards, ctx.agents) },
        wsFrames: createBoardWsFrames(boards),
        resourceProvider: createBoardResourceProvider(boards),
        searchProvider: createBoardSearchProvider(boards),
      },
    ],
    tools: createKanbanTools(ctx, boards),
  }
}
