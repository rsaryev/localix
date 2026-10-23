import type { MiniAppContext } from '@localixai/mini-app-sdk/backend'

import { createCommitCompletionSurface } from './inline-completion'
import { createGitContextProvider } from './source-control/context-provider'
import { createForgeService } from './source-control/forge/service'
import { createGithubForge } from './source-control/forge/gh'
import { createGitBackend } from './source-control/git/backend'
import { createBackendResolver } from './source-control/ports'
import { createRepoWorkspaceService } from './source-control/repos/service'
import { createGitResourceProvider } from './source-control/resource-provider'
import { createSourceControlRoutes } from './source-control/routes'
import { createSourceControlService } from './source-control/service'
import { createGitResourceService } from './resource-service'

export async function register(ctx: MiniAppContext) {
  const workspaces = ctx.host?.workspaces
  // Native entrypoints are also invoked by generic tool/channel/monitor
  // inspection, where host services are intentionally absent. This mini app has
  // no context-free contributions, so stay inert there; the backend host calls
  // the same entrypoint with the workspace port during reconciliation.
  if (!workspaces) return { backend: [], tools: [] }

  const resolveScanRoot = async (
    userId: string,
    sessionId: string | null,
  ): Promise<string | null> =>
    sessionId ? ((await workspaces.resolveSessionDirectory?.(userId, sessionId)) ?? null) : null

  const backend = createGitBackend()
  const repoWorkspace = createRepoWorkspaceService({ resolveScanRoot, backend })
  const resolveCwd = (userId: string, sessionId: string | null, repoRoot?: string) =>
    repoWorkspace.resolveRepoCwd(userId, sessionId, repoRoot)
  const sourceControl = createSourceControlService({
    resolveCwd,
    listRepoStatuses: (userId, sessionId) => repoWorkspace.listRepoStatuses(userId, sessionId),
    resolveBackend: createBackendResolver([backend]),
    resolveCommitNoteMeta: async ({ userId, sessionId }) => {
      const metadata = (await workspaces.readSessionMetadata?.(userId, sessionId)) ?? null
      return metadata ? { model: metadata.model ?? undefined } : null
    },
  })
  const forge = createForgeService({ resolveCwd, backend: createGithubForge() })
  const resources = createGitResourceService(workspaces)

  return {
    backend: [
      {
        id: 'git-workspace:source-control',
        routeMount: {
          path: '/rpc/source-control',
          app: createSourceControlRoutes(sourceControl, forge),
        },
        resourceProvider: createGitResourceProvider(resources),
        contextProviders: [createGitContextProvider(resources)],
        textInputCompletionSurfaces: [createCommitCompletionSurface(sourceControl)],
      },
    ],
    tools: [],
  }
}
