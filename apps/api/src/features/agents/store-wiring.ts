import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import type { StoreProvider } from '@localixai/store'

import { onCapabilityRevision } from '../capabilities/revision'
import type { AgentsService } from './service-contract'
import { createAgentStoreProvider } from './store-provider'

/**
 * The agents provider over the agents service, as `bootstrap/` hands it to the Store. A change to
 * the files, a switch or a plugin bumps the capability revision, and the Store hears that.
 */
export const agentStoreProviderOf = (
  agents: AgentsService,
  seats: { chatsOf(agentId: string): Promise<number> },
): StoreProvider =>
  createAgentStoreProvider({
    agents,
    chatsOf: seats.chatsOf,
    revisionOf: async (path) =>
      createHash('sha1')
        .update(await readFile(path).catch(() => ''))
        .digest('hex'),
    onChange: (listener) => onCapabilityRevision(() => listener()),
  })
