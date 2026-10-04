/**
 * Durable storage for triggers. Every state change is a COMPARE-AND-SET.
 *
 * A fire settles asynchronously — a subsession round can take minutes — and a cancel or a
 * reschedule can land while it runs. The loop engine this replaced wrote unconditionally and
 * guarded in memory ("never resurrect a cancelled loop"), which held only inside one process and
 * only as long as every writer remembered the guard. Here the guard is in the WHERE clause: a
 * settle names the state and fire it expects, and a trigger that has since ended or fired again is
 * simply not matched.
 */
import type { Kysely, Selectable, Updateable } from 'kysely'

import type { AppDatabase, TriggersTable } from '../../db/types'
import type { TriggerOwner, TriggerRecord, TriggerState } from './contracts'

function ownerOf(row: Selectable<TriggersTable>): TriggerOwner {
  switch (row.owner_kind) {
    case 'agent':
      return { kind: 'agent', agentId: row.owner_agent_id ?? '' }
    case 'plugin':
      return { kind: 'plugin', ref: row.owner_ref ?? '' }
    case 'system':
      return { kind: 'system', ref: row.owner_ref ?? '' }
    case 'user':
      return { kind: 'user' }
  }
}

const parseObject = (raw: string): Record<string, unknown> => {
  try {
    const value: unknown = JSON.parse(raw)
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function toRecord(row: Selectable<TriggersTable>): TriggerRecord {
  return {
    id: row.id,
    userId: row.user_id,
    sessionId: row.session_id,
    owner: ownerOf(row),
    action: row.action,
    kind: row.kind,
    state: row.state,
    holdReason: row.hold_reason,
    endReason: row.end_reason,
    spec: parseObject(row.spec_json),
    payload: parseObject(row.payload_json),
    nextDueAt: row.next_due_at,
    fireSeq: row.fire_seq,
    fireCount: row.fire_count,
    lastFiredAt: row.last_fired_at,
    lastStatus: row.last_status,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** The fields a transition may change. `updatedAt` is always written. */
export type TriggerPatch = Partial<
  Pick<
    TriggerRecord,
    | 'kind'
    | 'state'
    | 'holdReason'
    | 'endReason'
    | 'spec'
    | 'payload'
    | 'nextDueAt'
    | 'fireSeq'
    | 'fireCount'
    | 'lastFiredAt'
    | 'lastStatus'
    | 'lastError'
  >
> & { updatedAt: string }

/** What a transition requires of the stored row; an unmet expectation changes nothing. */
export interface TriggerExpectation {
  states?: readonly TriggerState[]
  fireSeq?: number
}

export interface TriggerRepository {
  /** Every trigger that has not ended — what a boot re-arms. */
  listLive(): Promise<TriggerRecord[]>
  insert(record: TriggerRecord): Promise<void>
  /** Apply `patch` if the row still meets `expect`. True when it did. */
  transition(id: string, expect: TriggerExpectation, patch: TriggerPatch): Promise<boolean>
  /** Drop ended triggers last touched before `beforeIso`; they are history, not state. */
  pruneEnded(beforeIso: string): Promise<void>
}

function toColumns(patch: TriggerPatch): Updateable<TriggersTable> {
  const set: Updateable<TriggersTable> = { updated_at: patch.updatedAt }
  if (patch.kind !== undefined) set.kind = patch.kind
  if (patch.state !== undefined) set.state = patch.state
  if ('holdReason' in patch) set.hold_reason = patch.holdReason ?? null
  if ('endReason' in patch) set.end_reason = patch.endReason ?? null
  if (patch.spec !== undefined) set.spec_json = JSON.stringify(patch.spec)
  if (patch.payload !== undefined) set.payload_json = JSON.stringify(patch.payload)
  if ('nextDueAt' in patch) set.next_due_at = patch.nextDueAt ?? null
  if (patch.fireSeq !== undefined) set.fire_seq = patch.fireSeq
  if (patch.fireCount !== undefined) set.fire_count = patch.fireCount
  if ('lastFiredAt' in patch) set.last_fired_at = patch.lastFiredAt ?? null
  if ('lastStatus' in patch) set.last_status = patch.lastStatus ?? null
  if ('lastError' in patch) set.last_error = patch.lastError ?? null
  return set
}

export function createTriggerRepository(db: Kysely<AppDatabase>): TriggerRepository {
  return {
    async listLive() {
      const rows = await db
        .selectFrom('triggers')
        .selectAll()
        .where('state', '!=', 'ended')
        .execute()
      return rows.map(toRecord)
    },

    async insert(record) {
      await db
        .insertInto('triggers')
        .values({
          id: record.id,
          user_id: record.userId,
          session_id: record.sessionId,
          owner_kind: record.owner.kind,
          owner_agent_id: record.owner.kind === 'agent' ? record.owner.agentId : null,
          owner_ref:
            record.owner.kind === 'plugin' || record.owner.kind === 'system'
              ? record.owner.ref
              : null,
          action: record.action,
          kind: record.kind,
          state: record.state,
          hold_reason: record.holdReason,
          end_reason: record.endReason,
          spec_json: JSON.stringify(record.spec),
          payload_json: JSON.stringify(record.payload),
          next_due_at: record.nextDueAt,
          fire_seq: record.fireSeq,
          fire_count: record.fireCount,
          last_fired_at: record.lastFiredAt,
          last_status: record.lastStatus,
          last_error: record.lastError,
          created_at: record.createdAt,
          updated_at: record.updatedAt,
        })
        .execute()
    },

    async transition(id, expect, patch) {
      let query = db.updateTable('triggers').set(toColumns(patch)).where('id', '=', id)
      if (expect.states) query = query.where('state', 'in', [...expect.states])
      if (expect.fireSeq !== undefined) query = query.where('fire_seq', '=', expect.fireSeq)
      const result = await query.executeTakeFirst()
      return Number(result.numUpdatedRows) > 0
    },

    async pruneEnded(beforeIso) {
      await db
        .deleteFrom('triggers')
        .where('state', '=', 'ended')
        .where('updated_at', '<', beforeIso)
        .execute()
    },
  }
}
