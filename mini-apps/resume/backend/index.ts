import type {
  MiniAppContext,
  MiniAppRegistration,
  WorkspaceScopeHost,
} from '@localixai/mini-app-sdk/backend'
import { createResumeService } from './service'
import { createResumeRoutes } from './routes'
import { createResumeResourceProvider, createResumeContextProvider } from './context'
import { createResumeTool } from './tool'

let workspaceScope: WorkspaceScopeHost | undefined
export function register(ctx: MiniAppContext): MiniAppRegistration {
  workspaceScope = ctx.host?.workspaceScope ?? workspaceScope
  const resolveService = async (userId: string, sessionId?: string) => {
    if (!sessionId || !workspaceScope) return null
    const root = await workspaceScope.resolveSessionRoot(userId, sessionId)
    return root ? createResumeService(root) : null
  }
  const resourceProvider = createResumeResourceProvider(resolveService)
  return {
    backend: [
      {
        id: 'resume:backend',
        routeMount: { path: '/rpc/resume', app: createResumeRoutes(createResumeService) },
        resourceProvider,
        contextProviders: [createResumeContextProvider(resourceProvider)],
      },
    ],
    tools: [createResumeTool(ctx, createResumeService(ctx.cwd))],
  }
}
