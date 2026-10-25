import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import type { StoreProvider } from '@localixai/store'

import type { AgentsService } from './service-contract'
import { createAgentStoreProvider } from './store-provider'

/**
 * The agents provider over the agents service, as `bootstrap/` hands it to the Store. `bootstrap/` passes the
 * changes made anywhere (the capability revision): a file, a switch or a plugin.
 */
export const agentStoreProviderOf = (
  agents: AgentsService,
  seats: { chatsOf: (agentId: string) => Promise<number> },
  onChange: (listener: () => void) => () => void,
): StoreProvider =>
  createAgentStoreProvider({
    agents,
    chatsOf: seats.chatsOf,
    revisionOf: async (path) =>
      createHash('sha1')
        .update(await readFile(path).catch(() => ''))
        .digest('hex'),
    onChange,
  })
