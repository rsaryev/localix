import type { Kysely } from 'kysely'
import type { StoreProvider } from '@localixai/store'

import { DEFAULT_AGENT_ID } from '@localixai/agent/agents'
import type { AppDatabase } from '../../db'
import { createAvailabilityWriter, readAvailability } from '../capabilities/availability'
import type { SkillsCuratorService } from './service'
import { createSkillStoreProvider, type SkillFiles } from './store-provider'

/**
 * The skills provider over the SKILL.md operations, the curator and the rule store, as
 * `bootstrap/` hands it to the Store. A switch is a `skill:<name>` rule of the default agent,
 * the one the Capabilities screen writes.
 */
export function skillStoreProviderOf(deps: {
  db: Kysely<AppDatabase>
  curator: SkillsCuratorService
  skills: SkillFiles
}): StoreProvider {
  const writer = createAvailabilityWriter(deps.db)
  return createSkillStoreProvider({
    skills: deps.skills,
    curator: deps.curator,
    availability: {
      reader: (userId) => readAvailability(deps.db, { userId, agentId: DEFAULT_AGENT_ID }),
      set: (userId, switches) => writer.set(userId, DEFAULT_AGENT_ID, 'skill', switches),
    },
  })
}
