import type { BackendSubsystem } from '../ext/subsystem-contrib'
import { createMiniAppUiActionTable } from './backend-host-ui-actions'
import type { MiniAppBackendHostDeps } from './backend-host-contracts'

/**
 * Process-global registry keys contributed by a mini app belong to its manifest
 * namespace. Public/model-facing names (tools, routes and resource URIs) keep
 * their own contracts; these internal routing keys must never be ambiguous.
 */
export function miniAppBackendIdentityProblems(app: string, backend: BackendSubsystem): string[] {
  const namespace = `${app}:`
  const problems: string[] = []
  const requireOwned = (surface: string, identity: string) => {
    if (identity.startsWith(namespace) && identity.length > namespace.length) return
    problems.push(`${surface} identity "${identity}" must be namespaced by owner "${namespace}"`)
  }

  requireOwned('backend subsystem', backend.id)
  if (backend.searchProvider) requireOwned('search provider', backend.searchProvider.id)
  for (const contribution of backend.contextProviders ?? []) {
    requireOwned('context provider', contribution.provider.id)
  }
  for (const contribution of backend.wsFrames ?? []) {
    requireOwned('websocket subscribe command', contribution.subscribeCommand)
    requireOwned('websocket unsubscribe command', contribution.unsubscribeCommand)
  }
  return problems
}

/** Select process-global backends and scope-specific UI actions before changing live wiring. */
export function planMiniAppBackends(
  desired: Awaited<ReturnType<MiniAppBackendHostDeps['loadBackends']>>,
  deps: Pick<MiniAppBackendHostDeps, 'logger'>,
) {
  const desiredByName = new Map<string, BackendSubsystem[]>()
  const backendOwners = new Map<string, string>()
  const nextUiActions = createMiniAppUiActionTable()
  const processScopeByMiniApp = new Map<string, string>()
  const desiredRevisions = new Map<string, Set<string>>()
  // Why each mini app's backend was refused this pass — told to the person, not only the log.
  const refused = new Map<string, string[]>()
  for (const { app, projectId = '', backend, revision } of desired) {
    const problems = refused.get(app) ?? []
    refused.set(app, problems)
    const identityProblems = miniAppBackendIdentityProblems(app, backend)
    if (identityProblems.length > 0) {
      deps.logger?.warn(`mini app backend rejected: ${app}/${backend.id}`, {
        problems: identityProblems,
      })
      problems.push(...identityProblems)
      continue
    }
    nextUiActions.add(app, projectId, backend)

    // Providers/routes are process-global and keep the long-standing first
    // discovered scope. UI actions are scoped above and therefore do not lose
    // a project-local override with the same mini app name.
    const processScope = processScopeByMiniApp.get(app)
    if (processScope !== undefined && processScope !== projectId) continue
    processScopeByMiniApp.set(app, projectId)
    const existingOwner = backendOwners.get(backend.id)
    if (existingOwner) {
      deps.logger?.warn(`duplicate mini app backend id "${backend.id}" rejected`, {
        owner: existingOwner,
        duplicateOwner: app,
      })
      problems.push(`backend id "${backend.id}" is already used by "${existingOwner}"`)
      continue
    }
    backendOwners.set(backend.id, app)
    const list = desiredByName.get(app) ?? []
    list.push(backend)
    desiredByName.set(app, list)
    const revisions = desiredRevisions.get(app) ?? new Set<string>()
    if (revision) revisions.add(revision)
    desiredRevisions.set(app, revisions)
  }
  const revisionOf = (app: string) => [...(desiredRevisions.get(app) ?? [])].sort().join('\n')
  return { desiredByName, nextUiActions, refused, revisionOf }
}
