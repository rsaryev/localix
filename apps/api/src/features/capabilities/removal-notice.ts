import type { Kysely, Transaction } from 'kysely'
import { SEMANTIC_GLOBAL_SCOPE } from '@localixai/plugin-sdk/backend'

import type { AppDatabase } from '../../db'
import { recordCoreChanges } from '../changes/core-entities'

/**
 * A plugin or MCP server row left `capability_source`: announce it by key, in the deleting
 * transaction, so what is keyed by its name elsewhere (rules, sign-in tokens, vault bindings) is
 * cleaned up by the consumers rather than left for a same-named newcomer to inherit.
 */
export function announceSourceRemoved(
  trx: Kysely<AppDatabase> | Transaction<AppDatabase>,
  kind: 'plugin' | 'mcp',
  row: { id: string; name: string; project_id: string },
): Promise<void> {
  const scope = row.project_id || SEMANTIC_GLOBAL_SCOPE
  return recordCoreChanges(
    trx,
    kind === 'mcp'
      ? { entity: 'mcp', op: 'deleted', ref: { id: row.name, scope, serverId: row.id } }
      : { entity: 'plugin', op: 'deleted', ref: { id: row.name, scope } },
  )
}
