import { ConflictError, UnprocessableError } from '../../lib/domain-errors'
import type { Kysely } from 'kysely'

import type { AppDatabase } from '../../db'
import { recordCoreChanges } from '../changes/core-entities'
import { bumpCapabilityRevision } from './revision'
import type { Effect, Rule, RuleOrigin } from './rule'

/**
 * One agent's rules, read and replaced.
 *
 * WHY REPLACE AND NOT PATCH. Order is the semantics — a specific exception has to come after
 * the general rule it excepts — so a partial write would have to reason about where a row
 * lands relative to the others. The editor always holds the whole list anyway, and one
 * transaction per agent keeps its revision and ordered rules atomic.
 *
 * The key is the AgentId and nothing else. Rules used to be keyed by a "stored scope" —
 * `global`, `project:<id>` or `agent:<id>` — and composed across the three. One key means a
 * read is a read: there is no chain to assemble, no layer a cache is forbidden to consult,
 * and no second place the same question could be answered from.
 *
 * There is no seeding and no copying between agents; `seed-agent-presets.ts` writes a role's
 * shipped list once per preset version, and after that the rows are the user's.
 */

export interface CapabilityRuleRepository {
  read(userId: string, agentId: string): Promise<Rule[]>
  /**
   * Several agents at once — what a catalog needs, because the Agents screen shows every
   * role's answer side by side and one statement beats one round trip per row.
   */
  readMany(userId: string, agentIds: readonly string[]): Promise<Map<string, Rule[]>>
}

export interface CapabilityPolicySnapshot {
  revision: number
  rules: Rule[]
}

export interface VersionedCapabilityRuleRepository extends CapabilityRuleRepository {
  readSnapshot(userId: string, agentId: string): Promise<CapabilityPolicySnapshot>
  publish(
    userId: string,
    agentId: string,
    rules: readonly Rule[],
    expectedRevision: number,
  ): Promise<number>
  replace(userId: string, agentId: string, rules: readonly Rule[]): Promise<void>
  /** Recompute a narrow system change inside the transaction; never overwrite a stale read. */
  mutate(userId: string, agentId: string, change: (rules: Rule[]) => readonly Rule[]): Promise<void>
}

export function createCapabilityRuleRepository(
  db: Kysely<AppDatabase>,
): VersionedCapabilityRuleRepository {
  const atomic = <T>(operation: (connection: Kysely<AppDatabase>) => Promise<T>): Promise<T> =>
    db.isTransaction ? operation(db) : db.transaction().execute(operation)
  /**
   * Every rule write is a capability change: the list is announced by its key in the write's own
   * transaction, and the revision moves once, here, after it — the one place a rule write bumps.
   */
  const committed = async <T>(operation: Promise<T>): Promise<T> => {
    const result = await operation
    bumpCapabilityRevision()
    return result
  }
  const write = async (
    trx: Kysely<AppDatabase>,
    userId: string,
    agentId: string,
    rules: readonly Rule[],
    expectedRevision?: number,
  ): Promise<number> => {
    await trx
      .insertInto('capability_policy_revision')
      .values({ user_id: userId, agent_id: agentId, revision: 0 })
      .onConflict((conflict) => conflict.columns(['user_id', 'agent_id']).doNothing())
      .execute()
    let claim = trx
      .updateTable('capability_policy_revision')
      .set((eb) => ({ revision: eb('revision', '+', 1) }))
      .where('user_id', '=', userId)
      .where('agent_id', '=', agentId)
    if (expectedRevision !== undefined) claim = claim.where('revision', '=', expectedRevision)
    const updated = await claim.executeTakeFirst()
    if (updated.numUpdatedRows !== 1n)
      throw new ConflictError('policy_conflict', 'Policy changed; reload the rules before saving')
    await trx
      .deleteFrom('capability_rule')
      .where('user_id', '=', userId)
      .where('agent_id', '=', agentId)
      .execute()
    if (rules.length)
      await trx
        .insertInto('capability_rule')
        .values(
          rules.map((rule, position) => ({
            user_id: userId,
            agent_id: agentId,
            position,
            action: rule.action,
            resource: rule.resource,
            effect: rule.effect,
            message: rule.message ?? null,
            origin_json: rule.origin ? JSON.stringify(rule.origin) : null,
          })),
        )
        .execute()
    await recordCoreChanges(trx, {
      entity: 'capability.rule',
      op: 'upserted',
      ref: { userId, agentId },
    })
    const version = await trx
      .selectFrom('capability_policy_revision')
      .select('revision')
      .where('user_id', '=', userId)
      .where('agent_id', '=', agentId)
      .executeTakeFirstOrThrow()
    return version.revision
  }
  const toRule = (row: {
    action: string
    resource: string
    effect: string
    message: string | null
    origin_json: string | null
  }): Rule => ({
    action: row.action,
    resource: row.resource,
    effect: row.effect as Effect,
    ...(row.message !== null ? { message: row.message } : {}),
    ...(row.origin_json !== null ? { origin: JSON.parse(row.origin_json) as RuleOrigin } : {}),
  })

  const repo: VersionedCapabilityRuleRepository = {
    async readSnapshot(userId, agentId) {
      return atomic(async (trx) => {
        const row = await trx
          .selectFrom('capability_policy_revision')
          .select('revision')
          .where('user_id', '=', userId)
          .where('agent_id', '=', agentId)
          .executeTakeFirst()
        return {
          revision: row?.revision ?? 0,
          rules: await createCapabilityRuleRepository(trx).read(userId, agentId),
        }
      })
    },
    async publish(userId, agentId, rules, expectedRevision) {
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)
        throw new UnprocessableError(
          'invalid_revision',
          'Expected revision must be a non-negative integer',
        )
      return committed(atomic((trx) => write(trx, userId, agentId, rules, expectedRevision)))
    },
    async mutate(userId, agentId, change) {
      await committed(
        atomic(async (trx) => {
          const current = await createCapabilityRuleRepository(trx).read(userId, agentId)
          await write(trx, userId, agentId, change(current))
        }),
      )
    },
    async read(userId, agentId) {
      const rows = await db
        .selectFrom('capability_rule')
        .select(['action', 'resource', 'effect', 'message', 'origin_json'])
        .where('user_id', '=', userId)
        .where('agent_id', '=', agentId)
        .orderBy('position')
        .execute()
      return rows.map(toRule)
    },

    async readMany(userId, agentIds) {
      const out = new Map<string, Rule[]>(agentIds.map((agentId) => [agentId, []]))
      if (agentIds.length === 0) return out
      const rows = await db
        .selectFrom('capability_rule')
        .select(['agent_id', 'action', 'resource', 'effect', 'message', 'origin_json'])
        .where('user_id', '=', userId)
        .where('agent_id', 'in', agentIds as readonly string[])
        .orderBy('agent_id')
        .orderBy('position')
        .execute()
      for (const row of rows) out.get(row.agent_id)?.push(toRule(row))
      return out
    },

    async replace(userId, agentId, rules) {
      await committed(atomic((trx) => write(trx, userId, agentId, rules)))
    },
  }
  return repo
}
