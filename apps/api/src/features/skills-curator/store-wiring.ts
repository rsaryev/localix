import type { StoreProvider } from '@localixai/store'

import type { SkillsCuratorService } from './service'
import { createSkillStoreProvider, type SkillFiles, type SkillStoreDeps } from './store-provider'

/**
 * The skills provider over the SKILL.md operations, the curator and the rule store, as
 * `bootstrap/` hands it to the Store. A switch is a `skill:<name>` rule of the default agent;
 * `bootstrap/` passes the switches and the changes made anywhere (the capability revision), as it
 * does for MCP servers and agents.
 */
export function skillStoreProviderOf(deps: {
  curator: SkillsCuratorService
  skills: SkillFiles
  availability: SkillStoreDeps['availability']
  onChange: SkillStoreDeps['onChange']
}): StoreProvider {
  return createSkillStoreProvider(deps)
}
