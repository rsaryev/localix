import type { Kysely } from 'kysely'
import type { AppDatabase } from '../../db/types'
import type { CapabilityKind } from './resolve'
import type { VersionedCapabilityRuleRepository } from './rule-repository'
import type { CapabilitySourceRepository } from './source-repository'

/**
 * Opens the capability stores over a connection. Other features take it as a port (the
 * composition root supplies `bootstrap/capability-stores.ts`) because they open the stores
 * inside their own transactions, so a single instance over the root handle would not do.
 */
export interface CapabilityStores {
  sources(
    db: Kysely<AppDatabase>,
    kind: CapabilityKind,
    now?: () => string,
  ): CapabilitySourceRepository
  rules(db: Kysely<AppDatabase>): VersionedCapabilityRuleRepository
}
