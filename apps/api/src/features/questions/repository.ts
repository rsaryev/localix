/**
 * Durable storage for queued questions.
 *
 * Unlike a work record, the row is written AHEAD of the live index, not behind it: a question's
 * whole point is that it survives the process, and the agent is told its id the moment the call
 * returns. A question the store refused must fail the call, not live on only in memory and vanish
 * at the next restart with the agent still expecting an answer.
 */
import { sql, type Kysely, type Selectable } from 'kysely'

import type { AgentQuestionsTable, AppDatabase } from '../../db/types'
import { ANSWER_DELIVERY_PREFIX, type QuestionRecord, type QuestionStatus } from './contracts'

function toRecord(row: Selectable<AgentQuestionsTable>): QuestionRecord {
  return {
    id: row.id,
    userId: row.user_id,
    sessionId: row.session_id,
    agentId: row.agent_id,
    displayId: row.display_id,
    toolCallId: row.tool_call_id,
    questions: JSON.parse(row.questions_json) as QuestionRecord['questions'],
    status: row.status,
    answers: row.answers_json ? (JSON.parse(row.answers_json) as QuestionRecord['answers']) : null,
    askedAt: row.asked_at,
    resolvedAt: row.resolved_at,
  }
}

export interface QuestionResolution {
  status: Exclude<QuestionStatus, 'pending'>
  answers: QuestionRecord['answers']
  resolvedAt: string
}

export interface QuestionRepository {
  insert(record: QuestionRecord): Promise<void>
  /**
   * Close a PENDING question. False when it was not pending any more — another tab answered it
   * first — which is what makes two answers to one question a single delivery.
   */
  resolve(id: string, resolution: QuestionResolution): Promise<boolean>
  /** Every open question, oldest first — what a boot holds in its live index. */
  listPending(): Promise<QuestionRecord[]>
  /** One question by the id the agent was told, open or closed — what a re-ask recalls. */
  findByDisplayId(sessionId: string, displayId: string): Promise<QuestionRecord | null>
  /**
   * Answered since `horizon` with no delivery receipt (`question:<id>` in
   * `agent_delivery_receipts`): the answer was recorded but its wake never admitted — the process
   * died between the two, or the admission failed. What the recovery sweep re-sends.
   */
  listUndeliveredAnswers(horizon: string): Promise<QuestionRecord[]>
  /** The highest number each session has spent — so a restart never reissues a `q-N`. */
  highWaterMarks(): Promise<{ sessionId: string; n: number }[]>
}

export function createQuestionRepository(db: Kysely<AppDatabase>): QuestionRepository {
  return {
    async insert(record) {
      await db
        .insertInto('agent_questions')
        .values({
          id: record.id,
          user_id: record.userId,
          session_id: record.sessionId,
          agent_id: record.agentId,
          display_id: record.displayId,
          tool_call_id: record.toolCallId,
          questions_json: JSON.stringify(record.questions),
          status: record.status,
          answers_json: record.answers ? JSON.stringify(record.answers) : null,
          asked_at: record.askedAt,
          resolved_at: record.resolvedAt,
        })
        .execute()
    },

    async resolve(id, resolution) {
      const rows = await db
        .updateTable('agent_questions')
        .set({
          status: resolution.status,
          answers_json: resolution.answers ? JSON.stringify(resolution.answers) : null,
          resolved_at: resolution.resolvedAt,
        })
        .where('id', '=', id)
        .where('status', '=', 'pending')
        .returning('id')
        .execute()
      return rows.length > 0
    },

    async listPending() {
      const rows = await db
        .selectFrom('agent_questions')
        .selectAll()
        .where('status', '=', 'pending')
        .orderBy('asked_at')
        .execute()
      return rows.map(toRecord)
    },

    async findByDisplayId(sessionId, displayId) {
      const row = await db
        .selectFrom('agent_questions')
        .selectAll()
        .where('session_id', '=', sessionId)
        .where('display_id', '=', displayId)
        .executeTakeFirst()
      return row ? toRecord(row) : null
    },

    async listUndeliveredAnswers(horizon) {
      const rows = await db
        .selectFrom('agent_questions')
        .selectAll('agent_questions')
        .leftJoin('agent_delivery_receipts', (join) =>
          join.on(
            'agent_delivery_receipts.delivery_key',
            '=',
            sql<string>`${ANSWER_DELIVERY_PREFIX} || agent_questions.id`,
          ),
        )
        .where('agent_questions.status', '=', 'answered')
        .where('agent_questions.resolved_at', '>=', horizon)
        .where('agent_delivery_receipts.delivery_key', 'is', null)
        .orderBy('agent_questions.resolved_at')
        .execute()
      return rows.map(toRecord)
    },

    async highWaterMarks() {
      const { rows } = await sql<{ session_id: string; n: number }>`
        SELECT session_id,
               max(CAST(substr(display_id, instr(display_id, '-') + 1) AS INTEGER)) AS n
        FROM agent_questions
        GROUP BY session_id
      `.execute(db)
      return rows.map((row) => ({ sessionId: row.session_id, n: Number(row.n) }))
    },
  }
}
