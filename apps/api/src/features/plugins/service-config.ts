import {
  type CapabilitySourceRecord,
  type CapabilitySourceRepository,
  scalarConfig,
} from '../capabilities/source-repository'
import { configPatchValues } from '../ext/config-fields'
import {
  hydrateSecretOption,
  isSecretHandle,
  sealSecretOptions,
  sealsSecrets,
} from './config-vault'
import type { DiscoveredPlugin } from './discovery'
import { rowScopeOf } from './service-lifecycle'

/**
 * Save a plugin's userConfig values (`setConfig`), returning the saved row with its sensitive
 * values read back for the record.
 *
 * A user-scope plugin has one config wherever it is used (`rowScopeOf`); an older build kept it
 * per project, and that row is folded into the user's one on its next save. The user's row wins
 * over the old copy, so a stale per-project value never rolls back a newer one. A sensitive
 * value goes to the vault and the row keeps a handle (`config-vault.ts`).
 */
export async function savePluginConfig(input: {
  repo: CapabilitySourceRepository
  userId: string
  plugin: DiscoveredPlugin
  projectId: string
  values: Record<string, string | number | boolean>
}): Promise<{ state: CapabilitySourceRecord | undefined; rowScope: string }> {
  const { repo, userId, plugin, projectId } = input
  const name = plugin.manifest.name
  const declared = plugin.manifest.config ?? {}
  const rowScope = rowScopeOf(plugin, projectId)
  const legacy = rowScope !== projectId ? await repo.get(userId, projectId, name) : null
  const existing = (await repo.get(userId, rowScope, name))?.config
  const carried = Object.entries(scalarConfig(legacy?.config) ?? {}).filter(
    ([key]) => !(existing && key in existing),
  )
  const patch = await sealSecretOptions({
    userId,
    pluginName: name,
    scope: rowScope,
    declared,
    patch: { ...Object.fromEntries(carried), ...configPatchValues(declared, input.values) },
    existing,
  })
  const saved = await repo.patchConfig(userId, rowScope, name, patch)
  // Only a config-only row (an install records its source) is the old per-project copy.
  if (legacy?.source === 'local') await repo.remove(userId, projectId, name)
  return { state: await hydrateSecretOption(userId, saved), rowScope }
}

/**
 * Bring stored config to the shape {@link savePluginConfig} writes, for rows no save has
 * touched since an older build: a sensitive value kept in plain text moves to the vault, and a
 * user-scope plugin's per-project copy folds into the user's row. Run at boot; idempotent, so
 * an interrupted pass is finished by the next one. Returns how many rows it rewrote.
 */
export async function reconcileStoredConfig(input: {
  repo: CapabilitySourceRepository
  userId: string
  discover: (projectId: string) => Promise<DiscoveredPlugin[]>
}): Promise<number> {
  const { repo, userId } = input
  const rows = ((await repo.listAll?.(userId)) ?? []).filter(
    (row) => Object.keys(row.config).length > 0,
  )
  const scopes = new Map<string, CapabilitySourceRecord[]>()
  for (const row of rows) scopes.set(row.projectId, [...(scopes.get(row.projectId) ?? []), row])
  let rewritten = 0
  for (const [projectId, scoped] of scopes) {
    const plugins = await input.discover(projectId)
    for (const row of scoped) {
      const plugin = plugins.find((found) => found.manifest.name === row.name)
      if (!plugin || !needsReconcile(row, plugin)) continue
      await savePluginConfig({ repo, userId, plugin, projectId, values: {} })
      rewritten++
    }
  }
  return rewritten
}

function needsReconcile(row: CapabilitySourceRecord, plugin: DiscoveredPlugin): boolean {
  const folds =
    row.projectId !== '' && row.source === 'local' && rowScopeOf(plugin, row.projectId) === ''
  if (folds) return true
  if (!sealsSecrets()) return false
  const declared = plugin.manifest.config ?? {}
  return Object.entries(row.config).some(
    ([key, value]) =>
      declared[key]?.secret &&
      (typeof value === 'number' || (typeof value === 'string' && value !== '')) &&
      !isSecretHandle(value),
  )
}
