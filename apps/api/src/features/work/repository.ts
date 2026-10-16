/**
 * Durable storage for work records.
 *
 * Written behind the live index, not ahead of it: a job is registered from a synchronous tool
 * path, and the index is what every reader in this process uses. The rows exist for what the
 * process cannot keep — which ids a session has already spent, and which work was running when
 * the process died.
 */
import { sql, type Kysely, type Selectable } from 'kysely'

import type { AppDatabase, WorkRecordsTable } from '../../db/types'
import type { WorkKind, WorkRecord, WorkStatus } from './contracts'

function toRecord(row: Selectable<WorkRecordsTable>): WorkRecord {
  return {
    id: row.id,
    userId: row.user_id,
    sessionId: row.session_id,
    agentId: row.agent_id,
    displayId: row.display_id,
    kind: row.kind,
    label: row.label,
    status: row.status,
    exitCode: row.exit_code,
    toolCallId: row.tool_call_id,
    messageId: row.message_id,
    terminalId: row.terminal_id,
    childSessionId: row.child_session_id,
    eventCount: row.event_count,
    lastEvent: row.last_event,
    lastEventAt: row.last_event_at,
    startedAt: row.started_at,
    endedAt: row.ended_at,
  }
}

export interface WorkRepository {
  insert(record: WorkRecord): Promise<void>
  setTerminal(id: string, terminalId: string): Promise<void>
  end(
    id: string,
    end: { status: WorkStatus; exitCode: number | null; endedAt: string },
  ): Promise<void>
  recordEvents(
    id: string,
    seen: { eventCount: number; lastEvent: string | null; lastEventAt: string | null },
  ): Promise<void>
  /** The highest number each session has spent per prefix — so a restart never reissues one. */
  highWaterMarks(): Promise<{ sessionId: string; prefix: string; n: number }[]>
  /**
   * Mark work the previous process left running as lost, and answer which it was. Work of a
   * `spare`d kind is left running: its owner decides once it has loaded (`WorkRegistry.adopt`).
   */
  loseRunning(endedAt: string, spare: readonly WorkKind[]): Promise<WorkRecord[]>
  /** Running work of these kinds — what a boot holds for its owners to adopt. */
  listRunning(kinds: readonly WorkKind[]): Promise<WorkRecord[]>
}

export function createWorkRepository(db: Kysely<AppDatabase>): WorkRepository {
  return {
    async insert(record) {
      await db
        .insertInto('work_records')
        .values({
          id: record.id,
          user_id: record.userId,
          session_id: record.sessionId,
          agent_id: record.agentId,
          display_id: record.displayId,
          kind: record.kind,
          label: record.label,
          status: record.status,
          exit_code: record.exitCode,
          tool_call_id: record.toolCallId,
          message_id: record.messageId,
          terminal_id: record.terminalId,
          child_session_id: record.childSessionId,
          event_count: record.eventCount,
          last_event: record.lastEvent,
          last_event_at: record.lastEventAt,
          started_at: record.startedAt,
          ended_at: record.endedAt,
        })
        .execute()
    },

    async setTerminal(id, terminalId) {
      await db
        .updateTable('work_records')
        .set({ terminal_id: terminalId })
        .where('id', '=', id)
        .execute()
    },

    async end(id, end) {
      await db
        .updateTable('work_records')
        .set({ status: end.status, exit_code: end.exitCode, ended_at: end.endedAt })
        .where('id', '=', id)
        .where('status', '=', 'running')
        .execute()
    },

    async highWaterMarks() {
      const { rows } = await sql<{ session_id: string; prefix: string; n: number }>`
        SELECT session_id,
               substr(display_id, 1, instr(display_id, '-') - 1) AS prefix,
               max(CAST(substr(display_id, instr(display_id, '-') + 1) AS INTEGER)) AS n
        FROM work_records
        GROUP BY session_id, prefix
      `.execute(db)
      return rows.map((row) => ({
        sessionId: row.session_id,
        prefix: row.prefix,
        n: Number(row.n),
      }))
    },

    async recordEvents(id, seen) {
      await db
        .updateTable('work_records')
        .set({
          event_count: seen.eventCount,
          last_event: seen.lastEvent,
          last_event_at: seen.lastEventAt,
        })
        .where('id', '=', id)
        .execute()
    },

    async loseRunning(endedAt, spare) {
      let query = db
        .updateTable('work_records')
        .set({ status: 'lost', ended_at: endedAt })
        .where('status', '=', 'running')
      if (spare.length > 0) query = query.where('kind', 'not in', [...spare])
      const rows = await query.returningAll().execute()
      return rows.map(toRecord)
    },

    async listRunning(kinds) {
      if (kinds.length === 0) return []
      const rows = await db
        .selectFrom('work_records')
        .selectAll()
        .where('status', '=', 'running')
        .where('kind', 'in', [...kinds])
        .orderBy('started_at')
        .execute()
      return rows.map(toRecord)
    },
  }
}
