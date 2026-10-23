import { createStoreChangeFeed } from '@localixai/mini-app-sdk/backend'
import type { MiniAppContext, MiniAppRegistration } from '@localixai/mini-app-sdk/backend'

import { createLearningRoutes } from './routes'
import { LearningService } from './service'
import { LearningTutor } from './tutor'
import { createLearningCourseTool } from './tool'
import { createLearningContextProvider } from './context-provider'
import { createLearningResourceProvider } from './resource-provider'

export function register(ctx: MiniAppContext): MiniAppRegistration {
  const storage = ctx.sessionStorage ?? ctx.host?.sessionStorage
  const service = new LearningService(async (userId, sessionId) => {
    if (!storage) throw new Error('Session storage is unavailable')
    return storage.resolveDataDir(userId, sessionId)
  })
  const tutor = new LearningTutor(service, ctx.host?.wake)
  const feed = createStoreChangeFeed({
    miniApp: 'learning',
    watchPath: ctx.watchPath ?? ctx.host?.watchPath,
    resolveDir: async (userId, sessionId) =>
      sessionId && storage ? storage.resolveDataDir(userId, sessionId) : null,
    subscribeWrites: () => () => {},
  })
  const resourceProvider = createLearningResourceProvider(service)
  return {
    backend: [
      {
        id: 'learning:backend',
        wsFrames: feed.wsFrames,
        onShutdown: feed.onShutdown,
        routeMount: {
          path: '/rpc/learning',
          app: createLearningRoutes(service, tutor),
        },
        resourceProvider,
        contextProviders: [createLearningContextProvider(service)],
      },
    ],
    tools: [createLearningCourseTool(ctx, service, tutor)],
  }
}
