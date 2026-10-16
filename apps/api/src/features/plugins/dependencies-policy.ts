import type { Kysely } from 'kysely'
import type { AppDatabase } from '../../db/types'
import { DEFAULT_AGENT_ID } from '@localixai/agent/agents'
import { readAvailability } from '../capabilities/availability'
import { actionFor } from '../capabilities/resolve'
import type { RuleChange } from '../capabilities/rule-changes'
import { cascadeEnableDependencies, type DependencyEnableResult } from './dependencies-enable'
import type { DiscoveredPlugin } from './discovery'
import { pluginTrustClass } from './enable'

export interface DependencyEnablePlan {
  /** The rule changes the cascade wants, for the caller to write with its own. */
  changes: RuleChange[]
  result: DependencyEnableResult
}

/**
 * PLAN the dependency cascade — which installed-but-inert dependencies an allow pulls in —
 * without writing anything.
 *
 * It used to write, inside the caller's transaction, and that was the only way to keep a
 * plugin from being allowed without the dependencies it needs. Planning is the same guarantee
 * with one fewer moving part: the caller folds these changes into the SAME read-modify-write
 * as the change that caused them, so there is one transaction and no ordering to get right.
 *
 * Dependencies never cross the project boundary (`dependencies-enable.ts` matches on the
 * root's `projectId`), so every change here belongs to the scope the caller is already
 * writing.
 */
export async function planDependencyEnables(
  db: Kysely<AppDatabase>,
  input: {
    userId: string
    plugin: DiscoveredPlugin
    discovered: DiscoveredPlugin[]
    /** Whose rules the cascade is judged against; the always-present agent when unstated. */
    agentId?: string | null
  },
): Promise<DependencyEnablePlan> {
  const availability = await readAvailability(db, {
    userId: input.userId,
    agentId: input.agentId || DEFAULT_AGENT_ID,
  })
  const changes: RuleChange[] = []
  const result = await cascadeEnableDependencies(input.plugin, {
    discovered: input.discovered,
    isEnabled: (plugin) =>
      availability.effectFor('plugin', plugin.manifest.name, pluginTrustClass(plugin)) === 'allow',
    enable: async (plugin) => {
      changes.push({
        action: actionFor('plugin', plugin.manifest.name),
        resource: '*',
        effect: 'allow',
      })
    },
  })
  return { changes, result }
}
