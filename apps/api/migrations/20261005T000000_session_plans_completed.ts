import { sql, type Kysely } from 'kysely'

// A plan's lifecycle ends with the implementing agent declaring it done (`plan` action
// `complete`). Without a `completed` status an approved plan stayed approved forever, so its body
// rode the system prompt of every later run of the conversation long after the work it described
// was finished. The status is a CHECK, so this is a table rebuild (see README): new table, copy,
// drop, rename, then the index and the comments trigger the old table carried.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`PRAGMA defer_foreign_keys = ON`.execute(db)
  await sql`
    CREATE TABLE "session_plans_next" (
      "id" text primary key not null,
      "user_id" text not null,
      "session_id" text not null references "agent_sessions" ("id") on delete cascade,
      "version" integer not null,
      "status" text not null check ("status" in ('presented', 'approved', 'superseded', 'dismissed', 'completed')),
      "title" text not null,
      "body" text not null,
      "author_agent_id" text not null,
      "approved_mode" text,
      "review_round" integer not null default 0,
      "created_at" text not null,
      "decided_at" text,
      "completed_at" text,
      "completion_summary" text
    )
  `.execute(db)
  await sql`
    INSERT INTO "session_plans_next" (
      "id", "user_id", "session_id", "version", "status", "title", "body", "author_agent_id",
      "approved_mode", "review_round", "created_at", "decided_at"
    )
    SELECT "id", "user_id", "session_id", "version", "status", "title", "body", "author_agent_id",
      "approved_mode", "review_round", "created_at", "decided_at"
    FROM "session_plans"
  `.execute(db)
  // The trigger first: it is what deletes a plan's comments, and the old table must leave
  // without taking them along.
  await sql`DROP TRIGGER "session_plans_drop_comments"`.execute(db)
  await sql`DROP TABLE "session_plans"`.execute(db)
  await sql`ALTER TABLE "session_plans_next" RENAME TO "session_plans"`.execute(db)
  await sql`CREATE UNIQUE INDEX session_plans_version_idx ON session_plans(session_id, version)`.execute(
    db,
  )
  await sql`CREATE TRIGGER "session_plans_drop_comments" AFTER DELETE ON "session_plans"
    BEGIN DELETE FROM "comments" WHERE "scope" = 'plan:' || OLD."id"; END`.execute(db)
}
