import type {
  MiniAppContext,
  MiniAppRegistration,
  WorkspaceScopeHost,
} from '@localixai/mini-app-sdk/backend'
import { ROUTE_PATH } from '../shared/resource'
import { createSpaceRoutes } from './routes'
import { createSpaceTools } from './tools'
import { createViewTool } from './view-tool'
import { createSpaceWsFrames } from './ws-frames'

/**
 * The board's backend: its routes for the view and its three tools for the agent — read, change,
 * and move the camera of the open tab — over one store.
 *
 * Only the boot load carries the host (`ctx.host`), and the per-run tool loads need it to find
 * the project a chat works in, so the workspace scope is kept at module level when it arrives.
 * A run without it (a host that does not provide one) uses the run's own working directory.
 */
let workspaceScope: WorkspaceScopeHost | undefined

export function register(ctx: MiniAppContext): MiniAppRegistration {
  workspaceScope = ctx.host?.workspaceScope ?? workspaceScope
  const resolveRoot = async (sessionId: string | undefined) =>
    (sessionId
      ? await workspaceScope?.resolveSessionRoot(ctx.userId, sessionId).catch(() => null)
      : null) ?? ctx.cwd

  return {
    backend: [
      {
        id: 'project-space:backend',
        routeMount: {
          path: ROUTE_PATH,
          app: createSpaceRoutes({ liveUpdates: !!workspaceScope }),
        },
        ...(workspaceScope ? createSpaceWsFrames(workspaceScope) : {}),
      },
    ],
    tools: [...createSpaceTools(ctx, resolveRoot), createViewTool(ctx, resolveRoot)],
  }
}
