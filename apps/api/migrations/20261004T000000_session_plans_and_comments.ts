import { sql, type Kysely } from 'kysely'

// A plan the agent presented for review (`features/plans`), one row per VERSION, and the
// person's comments (`features/comments`) — generic rows keyed by an opaque scope, a plan's
// being `plan:<id>`.
//
// The plan this replaces lived in a markdown file per session slug: two sessions could collide
// on one file, nothing deleted it, and the review comments lived only in the browser until an
// "Implement" click carried them. So both are rows here, and both end with what they belong
// to: a plan with its (root) session through the foreign key, and a plan's comments with the
// plan through the trigger — the comments table cannot name its owner's table, because a scope
// is not only ever a plan.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE "session_plans" (
      "id" text primary key not null,
      "user_id" text not null,
      "session_id" text not null references "agent_sessions" ("id") on delete cascade,
      "version" integer not null,
      "status" text not null check ("status" in ('presented', 'approved', 'superseded', 'dismissed')),
      "title" text not null,
      "body" text not null,
      "author_agent_id" text not null,
      "approved_mode" text,
      "review_round" integer not null default 0,
      "created_at" text not null,
      "decided_at" text
    )
  `.execute(db)
  await sql`CREATE UNIQUE INDEX session_plans_version_idx ON session_plans(session_id, version)`.execute(
    db,
  )
  await sql`
    CREATE TABLE "comments" (
      "id" text primary key not null,
      "user_id" text not null,
      "scope" text not null,
      "anchor_json" text not null,
      "body" text not null,
      "status" text not null check ("status" in ('open', 'sent', 'outdated')),
      "created_at" text not null,
      "updated_at" text not null
    )
  `.execute(db)
  await sql`CREATE INDEX comments_scope_idx ON comments(user_id, scope)`.execute(db)
  await sql`CREATE TRIGGER "session_plans_drop_comments" AFTER DELETE ON "session_plans"
    BEGIN DELETE FROM "comments" WHERE "scope" = 'plan:' || OLD."id"; END`.execute(db)
}
