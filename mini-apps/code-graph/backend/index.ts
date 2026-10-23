import type { MiniAppContext, MiniAppRegistration } from '@localixai/mini-app-sdk/backend'
import { ROUTE_PATH } from '../shared/resource'
import { createGraphContextProvider, createGraphResourceProvider } from './context'
import { closeProjects } from './indexing/projects'
import { createGraphRoutes } from './routes'
import { createGraphTools } from './tools'
import { createGraphWsFrames } from './ws-frames'

export { ROUTE_PATH }

/**
 * The router for one data folder. `register` mounts it on `ctx.dataDir`; exported so a harness can
 * serve the same app over a folder of its own.
 */
export function createRoutes(dataDir: string) {
  return createGraphRoutes(dataDir)
}

export function register(ctx: MiniAppContext): MiniAppRegistration {
  // Indexes are module-level (`indexing/projects.ts`): this is called for the backend and again for
  // each run, and every caller must reach the same parsed project.
  const resourceProvider = createGraphResourceProvider(ctx.dataDir, ctx.cwd, ctx.host)
  // Only the boot load carries the host; without a workspace scope there is no way to tie a socket
  // to a project, and the tab falls back to its polls.
  const scope = ctx.host?.workspaceScope
  const stream = scope ? createGraphWsFrames(ctx.dataDir, scope) : null
  return {
    backend: [
      {
        id: 'code-graph:backend',
        routeMount: { path: ROUTE_PATH, app: createRoutes(ctx.dataDir) },
        resourceProvider,
        contextProviders: [createGraphContextProvider(resourceProvider)],
        ...(stream ? { wsFrames: stream.wsFrames } : {}),
        onShutdown: () => {
          stream?.onShutdown()
          closeProjects()
        },
      },
    ],
    tools: createGraphTools(ctx),
  }
}
