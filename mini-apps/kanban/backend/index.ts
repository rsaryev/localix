import type { MiniAppContext, MiniAppRegistration } from '@localixai/mini-app-sdk/backend'

import { ROUTE_PATH } from '../shared/resource'
import { createBoardResourceProvider, createBoardSearchProvider } from './references'
import { createBoardRoutes } from './routes'
import { createBoardService } from './service'
import { createKanbanTools } from './tools'
import { followAgentDeletions } from './unassign'
import { createBoardWsFrames } from './ws-frames'

/**
 * The Kanban board: one passive task board per chat, kept in that chat's own folder.
 *
 * `register(ctx)` runs for the backend and again for each run's tools. Every load carries
 * `ctx.sessionStorage` and `ctx.agents`, so the tool and the routes resolve the same board and
 * assign from the same registry; the store orders their writes and announces them to every
 * open view, whichever load made them (`store.ts`). The boot-time backend alone (it has
 * `ctx.host`) follows the core's agent deletions and unassigns that agent's cards (`unassign.ts`).
 */
export function register(ctx: MiniAppContext): MiniAppRegistration {
  const storage = ctx.sessionStorage
  const boards = createBoardService({
    resolveDir: async (userId, sessionId) => {
      if (!storage) throw new Error('This host keeps no per-chat mini app data.')
      return storage.resolveDataDir(userId, sessionId)
    },
    ...(ctx.agents ? { agents: ctx.agents } : {}),
  })
  const following = ctx.host
    ? followAgentDeletions(ctx.host.changes, storage?.listDataDirs?.bind(storage)).catch(
        (error) => {
          ctx.log(`cannot follow agent deletions: ${String(error)}`)
          return null
        },
      )
    : null
  return {
    backend: [
      {
        id: 'kanban:backend',
        routeMount: { path: ROUTE_PATH, app: createBoardRoutes(boards, ctx.agents) },
        wsFrames: createBoardWsFrames(boards),
        resourceProvider: createBoardResourceProvider(boards),
        searchProvider: createBoardSearchProvider(boards),
        onShutdown: () => void following?.then((stop) => stop?.()),
      },
    ],
    tools: createKanbanTools(ctx, boards),
  }
}
