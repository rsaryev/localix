import type { MiniAppContext, MiniAppRegistration } from '@localixai/mini-app-sdk/backend'
import { ROUTE_PATH } from '../shared/resource'
import { createGameService } from './game-service'
import { createGameRoutes } from './routes'
import { createJsonStoreFeed } from '@localixai/mini-app-sdk/backend'
import { createGameTools } from './tools'

export function register(ctx: MiniAppContext): MiniAppRegistration {
  const storage = ctx.sessionStorage
  const games = createGameService({
    ...(storage ? { resolveDir: (...args) => storage.resolveDataDir(...args) } : {}),
    ...(ctx.host?.wake ? { wake: ctx.host.wake } : {}),
    ...(ctx.host?.decisions ? { decisions: ctx.host.decisions } : {}),
  })
  // The open board hears every write to its chat's game — the agent's moves included — instead
  // of polling for them. The folder is the host's, resolved with the socket's own user.
  const feed = createJsonStoreFeed({
    watchPath: ctx.watchPath ?? ctx.host?.watchPath,
    miniApp: 'game-2048',
    resolveDir: async (userId, sessionId) =>
      sessionId && storage ? storage.resolveDataDir(userId, sessionId) : null,
  })
  return {
    backend: [
      {
        id: 'game-2048:backend',
        routeMount: { path: ROUTE_PATH, app: createGameRoutes(games) },
        wsFrames: feed.wsFrames,
        onShutdown: feed.onShutdown,
      },
    ],
    tools: createGameTools(ctx, games),
  }
}
