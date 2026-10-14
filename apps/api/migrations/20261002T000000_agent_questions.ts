import { sql, type Kysely } from 'kysely'

// A question the agent asked WITHOUT waiting (`ask` with `wait: false`): it stays open until the
// person answers or skips it, across restarts, and its answer wakes the agent that asked.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE "agent_questions" (
      "id" text primary key not null,
      "user_id" text not null,
      "session_id" text not null references "agent_sessions" ("id") on delete cascade,
      "agent_id" text not null,
      "display_id" text not null,
      "tool_call_id" text not null,
      "questions_json" text not null,
      "status" text not null check ("status" in ('pending', 'answered', 'skipped', 'superseded')),
      "answers_json" text,
      "asked_at" text not null,
      "resolved_at" text
    )
  `.execute(db)
  await sql`CREATE UNIQUE INDEX agent_questions_display_idx ON agent_questions(session_id, display_id)`.execute(
    db,
  )
  await sql`CREATE INDEX agent_questions_pending_idx ON agent_questions(status) WHERE status = 'pending'`.execute(
    db,
  )
}
