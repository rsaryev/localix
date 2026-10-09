import type {
  PluginContext,
  PluginRegistration,
  WorkspaceScopeHost,
} from '@localixai/plugin-sdk/backend'
import { createMotionService } from './service'
import { motionDirectory } from './files'
import { createMotionRoutes } from './routes'
import { createStoreFeed } from './store-feed'
import { createMotionContextProvider, createMotionResourceProvider } from './context'
import { createMotionTool } from './tool'

export const ROUTE_PATH = '/rpc/motion'
export const createRoutes = createMotionRoutes
let workspaceScope: WorkspaceScopeHost | undefined
export function register(ctx: PluginContext): PluginRegistration {
  workspaceScope = ctx.host?.workspaceScope ?? workspaceScope
  const service = async (userId: string, sessionId?: string) => {
    if (!sessionId || !workspaceScope) return null
    const root = await workspaceScope.resolveSessionRoot(userId, sessionId)
    return root ? createMotionService(root) : null
  }
  const resourceProvider = createMotionResourceProvider(service)
  const feed = createStoreFeed({
    plugin: 'motion',
    watchPath: ctx.watchPath ?? ctx.host?.watchPath,
    resolveDir: async (userId, sessionId) => {
      if (!sessionId || !workspaceScope) return null
      const root = await workspaceScope.resolveSessionRoot(userId, sessionId)
      return root ? motionDirectory(root) : null
    },
  })
  return {
    backend: [
      {
        id: 'motion:backend',
        routeMount: { path: ROUTE_PATH, app: createRoutes() },
        resourceProvider,
        contextProviders: [createMotionContextProvider(resourceProvider)],
        wsFrames: feed.wsFrames,
        onShutdown: feed.onShutdown,
      },
    ],
    tools: [createMotionTool(ctx, createMotionService(ctx.cwd))],
  }
}
