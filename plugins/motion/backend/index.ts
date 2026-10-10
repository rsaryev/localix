import type {
  PluginContext,
  PluginRegistration,
  WorkspaceScopeHost,
} from '@localixai/plugin-sdk/backend'
import { motionDirectory } from './files'
import { createMotionRoutes } from './routes'
import { createStoreFeed } from './store-feed'
import { createMotionContextProvider, createMotionResourceProvider } from './context'
import { createMotionTool } from './tool'

export const ROUTE_PATH = '/rpc/motion'
let workspaceScope: WorkspaceScopeHost | undefined
const workspaceOf = async (userId: string, sessionId?: string) =>
  sessionId && workspaceScope ? workspaceScope.resolveSessionRoot(userId, sessionId) : null
/** The standalone preview has no host: its routes use each request's own cwd. */
export const createRoutes = () => createMotionRoutes(workspaceScope ? workspaceOf : undefined)

export function register(ctx: PluginContext): PluginRegistration {
  workspaceScope = ctx.host?.workspaceScope ?? workspaceScope
  const resourceProvider = createMotionResourceProvider(workspaceOf)
  const feed = createStoreFeed({
    plugin: 'motion',
    watchPath: ctx.watchPath ?? ctx.host?.watchPath,
    resolveDir: async (userId, sessionId) => {
      const root = await workspaceOf(userId, sessionId ?? undefined)
      return root ? motionDirectory(root) : null
    },
  })
  return {
    backend: [
      {
        id: 'motion:backend',
        routeMount: { path: ROUTE_PATH, app: createMotionRoutes(workspaceOf) },
        resourceProvider,
        contextProviders: [createMotionContextProvider(resourceProvider)],
        wsFrames: feed.wsFrames,
        onShutdown: feed.onShutdown,
      },
    ],
    tools: [createMotionTool(ctx)],
  }
}
