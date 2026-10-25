import type { StoreProvider } from '@localixai/store'

import { onCapabilityRevision } from '../capabilities/revision'
import type { AgentsService } from './service-contract'
import { createAgentStoreProvider } from './store-provider'

/**
 * The agents provider over the agents service, as `bootstrap/` hands it to the Store. A change to
 * the files, a switch or a plugin bumps the capability revision, and the Store hears that.
 */
export const agentStoreProviderOf = (agents: AgentsService): StoreProvider =>
  createAgentStoreProvider({
    agents,
    onChange: (listener) => onCapabilityRevision(() => listener()),
  })
