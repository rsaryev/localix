import { InvalidRequestError } from '../../lib/domain-errors'
import { scalarConfig, type CapabilitySourceRepository } from '../capabilities/source-repository'
import { recordCoreChanges } from '../changes/core-entities'
import type { CapabilitySourceRecord } from '../capabilities/source-repository'
import type { MiniAppCatalog } from './catalog'
import { miniAppOptions } from './config-vault'
import { retireManagedCopy } from './managed-copy'
import type { DiscoveredMiniApp } from './discovery'
import type { MiniAppInspections } from './inspection-snapshots'
import type { MiniAppServiceDeps } from './service'

/** What the mini app service's writes share with it. */
export interface MiniAppWriteScope {
  deps: Pick<MiniAppServiceDeps, 'db'>
  repo: CapabilitySourceRepository
  inspections: MiniAppInspections
  requireApp: (
    userId: string,
    name: string,
    projectId: string,
  ) => Promise<{ app: DiscoveredMiniApp; state: CapabilitySourceRecord | undefined }>
  catalogFor: (userId: string, projectId: string) => Promise<{ catalog: MiniAppCatalog }>
}

/** A mini app's settings and its removal: each write records its own `mini-app` notice. */
export function createMiniAppWrites({
  deps,
  repo,
  inspections,
  requireApp,
  catalogFor,
}: MiniAppWriteScope) {
  return {
    /** Save settings: a secret goes to the vault, the row keeps its handle. */
    async setConfig(
      userId: string,
      input: {
        name: string
        projectId?: string | null
        values: Record<string, string | number | boolean>
      },
    ) {
      const projectId = input.projectId ?? ''
      const { app, state } = await requireApp(userId, input.name, projectId)
      const declared = app.manifest?.config ?? {}
      const unknown = Object.keys(input.values).filter((key) => !(key in declared))
      if (unknown.length > 0)
        throw new InvalidRequestError(
          'mini_app_config_unknown',
          `Mini app "${input.name}" declares no setting ${unknown.join(', ')}`,
        )
      const rowScope = app.scope === 'project' ? projectId : ''
      const patch = await miniAppOptions.sealSecretOptions({
        userId,
        owner: input.name,
        scope: rowScope,
        declared,
        patch: input.values,
        existing: scalarConfig(state?.config),
      })
      // The repository records the `mini-app` notice in the same write (C1).
      await repo.patchConfig(userId, rowScope, input.name, patch)
      inspections.invalidate(input.name)
    },

    /**
     * Remove a mini app the person installed or made. One installed from a catalog stays removed:
     * a sync only refreshes what is installed. The folder is set aside, not deleted — its backend
     * may be the module this process still runs — and pruned on the next start. Its data folder
     * stays: a reinstall finds it.
     */
    async remove(userId: string, input: { name: string; projectId?: string | null }) {
      const projectId = input.projectId ?? ''
      const { app } = await requireApp(userId, input.name, projectId)
      await retireManagedCopy(app.dir)
      await repo.remove(userId, app.scope === 'project' ? projectId : '', input.name)
      const left = await catalogFor(userId, projectId)
      if (!left.catalog.all.some(({ app: other }) => other.name === input.name))
        await recordCoreChanges(deps.db, {
          entity: 'mini-app',
          op: 'deleted',
          ref: { id: input.name, scope: projectId || 'global' },
        })
      inspections.invalidate(input.name)
    },
  }
}
