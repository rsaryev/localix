import type { Kysely } from 'kysely'
import { SEMANTIC_GLOBAL_SCOPE } from '@localixai/plugin-sdk/backend'
import type { AppDatabase } from '../../db/types'
import { capabilitiesChanged, trackCapabilityChange } from '../capabilities/revision'
import { recordCoreChanges, type CoreChange } from '../changes/core-entities'
import type { AgentSummary } from './contracts'

/**
 * How the agents owner announces its writes. Its files are the truth, so there is no transaction
 * to join; the feed's reconcile (a capability bump's `resync`) covers a lost notice.
 */
export function createAgentAnnouncer(db: Kysely<AppDatabase>) {
  /**
   * An agent's catalog keys by its stable id: the first key is gone (deleted or renamed away
   * from), a second one is where it lives now.
   */
  const keys = (projectId: string, agentId: string, [gone, now]: string[]) => {
    const scope = projectId || SEMANTIC_GLOBAL_SCOPE
    const changes: CoreChange[] = [
      { entity: 'agent', op: 'deleted', ref: { id: gone!, scope, agentId } },
    ]
    if (now) changes.push({ entity: 'agent', op: 'upserted', ref: { id: now, scope, agentId } })
    return recordCoreChanges(db, changes)
  }

  /**
   * Every agent write moves the capability revision once (a rule write already has) and names
   * the agent it left, so its chats and every surface hear of it (the relay).
   */
  const write = <T extends AgentSummary | void>(run: () => Promise<T>): Promise<T> =>
    trackCapabilityChange(async () => {
      const result = await run()
      if (result) {
        const scope = result.projectId || SEMANTIC_GLOBAL_SCOPE
        const ref = { id: result.record.handle, scope, agentId: result.record.id }
        await recordCoreChanges(db, { entity: 'agent', op: 'upserted', ref })
      }
      capabilitiesChanged()
      return result
    })

  return { keys, write }
}
