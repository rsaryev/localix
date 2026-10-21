import { createCapabilityRuleRepository } from '../features/capabilities/rule-repository'
import { createCapabilitySourceRepository } from '../features/capabilities/source-repository'
import type { CapabilityStores } from '../features/capabilities/store-factory'

/** The capability stores other features open over their own connections (`CapabilityStores`). */
export const capabilityStores: CapabilityStores = {
  sources: createCapabilitySourceRepository,
  rules: createCapabilityRuleRepository,
}
