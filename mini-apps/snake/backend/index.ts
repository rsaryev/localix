import type { MiniAppContext, MiniAppRegistration } from '@localixai/mini-app-sdk/backend'
import { createJsonStoreFeed } from '@localixai/mini-app-sdk/backend'

import { ROUTE_PATH } from '../shared/resource'
import { createGameService } from './game-service'
import { createGameRoutes } from './routes'
import { createGameTools } from './tools'

/**
 * Snake: a board per chat in the workbench, steered by the person or by the host's decision
 * model. `register(ctx)` runs more than once — for the backend, and again for each run's tools —
 * and only the backend load carries `ctx.host`, which is where the decision model's runs start.
 */
export function register(ctx: MiniAppContext): MiniAppRegistration {
  const storage = ctx.sessionStorage
  const games = createGameService({
    ...(storage ? { resolveDir: (...args) => storage.resolveDataDir(...args) } : {}),
    ...(ctx.host?.decisions ? { decisions: ctx.host.decisions } : {}),
  })
  // The open board hears every write to its chat's game — the model's moves included.
  const feed = createJsonStoreFeed({
    watchPath: ctx.watchPath ?? ctx.host?.watchPath,
    miniApp: 'snake',
    resolveDir: async (userId, sessionId) =>
      sessionId && storage ? storage.resolveDataDir(userId, sessionId) : null,
  })
  return {
    backend: [
      {
        id: 'snake:backend',
        routeMount: { path: ROUTE_PATH, app: createGameRoutes(games) },
        wsFrames: feed.wsFrames,
        onShutdown: feed.onShutdown,
      },
    ],
    tools: createGameTools(ctx, games),
  }
}
