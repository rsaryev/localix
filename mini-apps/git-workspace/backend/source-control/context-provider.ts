import type { ContextProviderContribution } from '@localixai/mini-app-sdk/backend'
import { createResourceContextProvider } from '@localixai/mini-app-sdk/backend'
import { createGitResourceProvider, type ResourceGitService } from './resource-provider'

/**
 * Source-control-owned explicit resolver. It reuses the existing Git resource
 * provider so ownership, discovered-repo containment and remote/config redaction
 * remain in one domain boundary; the shared factory owns the revisioning and the
 * capture-then-replay contract, so a captured expansion stays immutable on replay
 * even if the working tree changes afterwards.
 */
export function createGitContextProvider(service: ResourceGitService): ContextProviderContribution {
  // No `scheme:` — it is derived from the expander's own `.scheme`, so the git scheme
  // string is declared exactly once (in `resource-refs/schemes.ts`) and cannot drift.
  return createResourceContextProvider({
    id: 'git-workspace:git-context',
    namespace: 'git',
    expander: createGitResourceProvider(service),
  })
}
