import type { CatalogModel } from '@localixai/agent/catalog'

/**
 * What the composer's model trigger says.
 *
 * A session whose model the catalog had dropped showed "Select model" — the same words as a
 * session that never had one — so the user could not tell that the choice was gone, and the next
 * send failed with nothing on screen explaining it. The catalog arrives empty while it loads, so
 * "gone" is only claimed once the connected provider's models are in view and the stored id is
 * not among them.
 */
export function modelTriggerLabel(input: {
  selectedModel: Pick<CatalogModel, 'name'> | undefined
  /** The session's stored model id. */
  value: string
  /** The models the picker offers (already narrowed to connected providers). */
  models: readonly Pick<CatalogModel, 'providerId'>[]
  activeConnection: { providerId: string } | null
}): string {
  const { selectedModel, value, models, activeConnection } = input
  if (selectedModel) return selectedModel.name
  if (!activeConnection) return 'Choose model'
  const providerListed = models.some((model) => model.providerId === activeConnection.providerId)
  return value && providerListed ? `${value} is no longer available` : 'Select model'
}
