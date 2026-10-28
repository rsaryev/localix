import { useMemo } from 'react'

import { findCatalogModelForConnection, type CatalogModel } from '@localixai/agent/catalog'
import type { ProviderConnection } from '@/shared/api/contracts'

/** The composer's selected catalog model. */
export function useComposerModel(
  models: CatalogModel[],
  connections: ProviderConnection[],
  activeConnectionId: string | null | undefined,
  model: string,
) {
  // Memoized so the linear catalog scan doesn't re-run on every keystroke.
  return useMemo(
    () => findCatalogModelForConnection(models, connections, activeConnectionId, model),
    [activeConnectionId, connections, model, models],
  )
}
