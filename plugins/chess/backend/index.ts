import type { PluginContext, PluginRegistration } from '@localixai/plugin-sdk/backend'

import { ROUTE_PATH } from '../shared/resource'
import { createGameService } from './game-service'
import { createGameRoutes } from './routes'
import { createStoreFeed } from './store-feed'
import { createGameTools } from './tools'

/**
 * Chess: a board per chat in the workbench, and the agent in that chat as the opponent.
 *
 * `register(ctx)` runs more than once — for the backend, and again for each run's tools — and only
 * the backend load carries `ctx.host`. That is the right split rather than a limitation: the ROUTES
 * are where a person acts, and only a person's action asks the agent for a move, so only they need
 * `wake`. Both loads carry `ctx.sessionStorage`, so the tools and the routes reach the same board:
 * the one in the chat session's own folder, which the host deletes with the chat.
 */
export function register(ctx: PluginContext): PluginRegistration {
  const storage = ctx.sessionStorage
  const games = createGameService({
    ...(storage ? { resolveDir: (...args) => storage.resolveDataDir(...args) } : {}),
    ...(ctx.host?.wake ? { wake: ctx.host.wake } : {}),
  })
  // The open board hears every write to its chat's game — the agent's move included — instead of
  // polling for it. The folder is the host's, resolved with the socket's own user.
  const feed = createStoreFeed({
    plugin: 'chess',
    resolveDir: async (userId, sessionId) =>
      sessionId && storage ? storage.resolveDataDir(userId, sessionId) : null,
  })
  return {
    backend: [
      {
        id: 'chess:backend',
        routeMount: { path: ROUTE_PATH, app: createGameRoutes(games) },
        wsFrames: feed.wsFrames,
        onShutdown: feed.onShutdown,
      },
    ],
    tools: createGameTools(ctx, games),
  }
}
