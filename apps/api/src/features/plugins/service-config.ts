import { InvalidRequestError } from '../../lib/domain-errors'
import { listItems } from './config-lists'
import type {
  CapabilitySourceRecord,
  CapabilitySourceRepository,
} from '../capabilities/source-repository'
import { configPatchValues } from '../ext/config-fields'
import { hydrateSecretOption, sealSecretOptions } from './config-vault'
import type { DiscoveredPlugin } from './discovery'
import { rowScopeOf } from './service-lifecycle'

/**
 * Save a plugin's userConfig values (`setConfig`), returning the saved row with its sensitive
 * values read back for the record.
 *
 * A user-scope plugin has one config wherever it is used (`rowScopeOf`). A sensitive value goes to
 * the vault and the row keeps a handle (`config-vault.ts`).
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
  // A field with `options` takes one of them, as Claude Code's picker allows (an empty value
  // clears it).
  for (const [key, value] of Object.entries(input.values)) {
    if (declared[key]?.multiple && !listItems(value))
      throw new InvalidRequestError('plugin_config_invalid', `"${key}" takes a list of strings`)
    const choices = declared[key]?.options
    if (choices?.length && value !== '' && !choices.includes(String(value)))
      throw new InvalidRequestError(
        'plugin_config_invalid',
        `"${key}" must be one of ${choices.join(', ')}`,
      )
  }
  const rowScope = rowScopeOf(plugin, projectId)
  const existing = (await repo.get(userId, rowScope, name))?.config
  const patch = await sealSecretOptions({
    userId,
    owner: name,
    scope: rowScope,
    declared,
    patch: configPatchValues(declared, input.values),
    existing,
  })
  const saved = await repo.patchConfig(userId, rowScope, name, patch)
  return { state: await hydrateSecretOption(userId, saved), rowScope }
}
