import { sql, type Kysely } from 'kysely'

import type { AppDatabase } from '../src/db/types'

/**
 * FROZEN. The schema every database starts from; it is never edited again.
 *
 * A schema change is a new migration beside this one (see README.md). Editing this file
 * instead would leave every existing database on the old shape while its ledger says the
 * baseline ran, and `migration-freeze.test.ts` fails on any change to it.
 */
export async function up(db: Kysely<AppDatabase>): Promise<void> {
  await sql`
    CREATE TABLE "agent_external_session_keys" (
      "user_id" text not null,
      "external_key" text not null,
      "session_id" text references "agent_sessions" ("id") on delete cascade,
      constraint "agent_external_session_keys_pk" primary key ("user_id", "external_key"),
      constraint "agent_external_session_keys_session_unique" unique ("session_id")
    )
  `.execute(db)
  await sql`
    CREATE TABLE "agent_memory" (
      "id" text primary key not null,
      "user_id" text not null,
      "project_id" text default '' not null,
      "key" text not null,
      "value" text not null,
      "created_at" text default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) not null,
      "updated_at" text default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) not null,
      constraint "agent_memory_user_project_key_unique" unique ("user_id", "project_id", "key")
    )
  `.execute(db)
  await sql`
    CREATE TABLE "agent_message_usage" (
      "message_id" text primary key not null references "agent_messages" ("id") on delete cascade,
      "input_tokens" real,
      "output_tokens" real,
      "cached_input_tokens" real,
      "cache_write_tokens" real,
      "cache_write_1h_tokens" real,
      "reasoning_tokens" real,
      "total_tokens" real,
      "total_cost" real,
      "cost_source" text
    )
  `.execute(db)
  await sql`
    CREATE TABLE "agent_messages" (
      "id" text primary key not null,
      "session_id" text not null references "agent_sessions" ("id") on delete cascade,
      "user_id" text not null,
      "sequence" integer not null,
      "role" text not null,
      "payload_json" text not null,
      "created_at" text default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) not null,
      "updated_at" text default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) not null,
      "parent_id" text,
      search_text TEXT NOT NULL DEFAULT '',
      constraint "agent_messages_session_sequence_unique" unique ("session_id", "sequence")
    )
  `.execute(db)
  await sql`
    CREATE VIRTUAL TABLE agent_messages_fts USING fts5( search_text, role UNINDEXED, session_id UNINDEXED, user_id UNINDEXED, id UNINDEXED, created_at UNINDEXED, content='agent_messages', content_rowid='rowid' )
  `.execute(db)
  await sql`
    CREATE TABLE "agent_queue_items" (
      "sequence" integer primary key autoincrement,
      "id" text not null unique,
      "user_id" text not null,
      "session_id" text not null references "agent_sessions" ("id") on delete cascade,
      "priority" integer not null,
      "kind" text not null,
      "payload_json" text not null,
      "state" text default 'pending' not null,
      "lease_owner" text,
      "lease_expires_at" text,
      "delivery_key" text not null unique,
      "queued_at" text not null
    )
  `.execute(db)
  await sql`
    CREATE TABLE "agent_runs" (
      "id" text primary key not null,
      "session_id" text not null references "agent_sessions" ("id") on delete cascade,
      "agent_id" text not null,
      "status" text not null,
      "provider_id" text not null,
      "model_id" text not null,
      "credential_id" text,
      "adapter" text not null,
      "adapter_version" text not null,
      "error_code" text,
      "error_json" text,
      "started_at" text not null,
      "finished_at" text
    )
  `.execute(db)
  await sql`
    CREATE TABLE "agent_sessions" (
      "id" text primary key not null,
      "user_id" text not null,
      "title" text not null,
      "is_pinned" integer default 0 not null,
      "created_at" text default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) not null,
      "updated_at" text default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) not null,
      "last_message_at" text default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) not null,
      "execution_backend" text default 'local' not null,
      "execution_target" text,
      -- NOT NULL and no foreign key, which is the same shape every other project-scoped table
      -- here uses (agent_memory, tool_usage, …). The NOT NULL is the part that matters: "no
      -- project" used to resolve to the GLOBAL capability scope, so a session without one wrote
      -- installation-wide rules nothing below could undo.
      --
      -- The FK is gone with the behaviour it existed for. It carried ON DELETE SET NULL, which
      -- is exactly the orphaning this column now forbids; projects are soft-deleted instead
      -- (see the projects table), so there is no delete for it to react to.
      "project_id" text not null,
      "parent_session_id" text,
      "root_session_id" text,
      "session_kind" text default 'chat' not null,
      "runtime_status" text default 'idle' not null,
      "source_tool_call_id" text,
      "pinned_skills" text default '[]' not null,
      "leaf_id" text,
      "seq" integer default 0 not null,
      "worktree_session_id" text,
      "archived_at" text,
      "invocation_json" text default '{"kind":"unknown-origin"}' not null,
      "task_name" TEXT,
      "activated_tools" TEXT,
      "description" text,
      "avatar" text
    )
  `.execute(db)
  // WHO IS IN A SESSION, AND ON WHAT EACH OF THEM RUNS.
  //
  // The party and its routing are ONE table because they are one fact. A session used to
  // carry a single {provider, model, effort} of its own, which could only ever describe a
  // conversation with one counterpart; a room with several agents needs one such triple per
  // agent, and a private chat is simply the case where there is one row. Splitting the two —
  // a participant list beside a routing table — would let them disagree: a route for someone
  // not in the room, or a member with nowhere to run.
  //
  // `position` is join order, which is also speaking order for a group's serial rounds.
  // Registry identity owns membership; the handle is a historical display snapshot.
  await sql`
    CREATE TABLE "conversation_participants" (
      "session_id" text not null references "agent_sessions" ("id") on delete cascade,
      "agent_id" text not null,
      "handle" text not null,
      "position" integer default 0 not null,
      "provider_connection_id" text references "provider_connections" ("id") on delete set null,
      "model_id" text not null,
      "reasoning_effort" text default 'medium' not null,
      "model_selected_at" text,
      primary key ("session_id", "agent_id")
    )
  `.execute(db)
  await sql`
    CREATE TABLE participant_lane_snapshots (
      user_id TEXT NOT NULL,
      session_id TEXT NOT NULL REFERENCES agent_sessions (id) ON DELETE CASCADE,
      agent_id TEXT NOT NULL,
      boundary_marker TEXT NOT NULL,
      snapshot_json TEXT NOT NULL,
      PRIMARY KEY (user_id, session_id, agent_id, boundary_marker)
    )
  `.execute(db)
  await sql`
    CREATE TABLE agent_delivery_receipts (
      delivery_key TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      session_id TEXT NOT NULL REFERENCES agent_sessions (id) ON DELETE CASCADE,
      created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
    )
  `.execute(db)
  // WHAT MAY RUN, AND WHERE — one table for a question that used to have six answers.
  //
  // "Is this available here" was stored six ways: a JSON `disabledTools` array in user
  // settings, a JSON `skillOverrides` map beside it, both again per project, a separate
  // permission-rule list, and an `enabled` column on each registry table. Six shapes meant six
  // readers, two of which — the settings screen and the run — could disagree.
  //
  // A switch and a permission rule are the same statement: `tool:bash` over resource `*` with
  // effect `deny` turns the tool off; the same action over `git push*` with effect `ask`
  // leaves it on and prompts. So there is one row shape, and `position` orders a scope's own
  // rules from general to specific.
  //
  // `scope` is `global`, `project:<id>` or `agent:<handle>` — the three inputs the resolver
  // composes, all in one table so there is exactly one writer and one reader. An agent's
  // limits stay HERE rather than on its record file because a record is a role definition
  // that travels (imported from Claude Code, dropped into a repository) and availability is a
  // property of this installation, not of the definition.
  // WHAT EXISTS TO RUN — the registry half of the pair `capability_rule` completes.
  //
  // Four tables held this: `plugins`, `agents`, `agent_providers`, `mcp_servers`. Three
  // were the same nine columns, spelled three times — the code admitted it with one
  // `ExtStateTable` union and one shared upsert — and the fourth differed only by two
  // fields it never queried on. Their `enabled` columns are gone (availability is a rule,
  // see below), and what remained was one row shape asking one question: what is
  // installed here, and how is it configured.
  //
  // `config` is the KIND's own JSON and this table knows nothing about it: a plugin's
  // declared settings, an MCP server's transport and connection details. That is what
  // keeps the table agnostic — the alternative was `transport` and `description` columns
  // sitting null on three kinds out of four.
  //
  // `id` stays, and is the primary key rather than a synthetic addition: an MCP server is
  // addressed by it on the wire. The other three are addressed by the natural key below.
  await sql`
    CREATE TABLE "capability_source" (
      "contribution_revision" integer default 0 not null,
      "contribution_digest" text default '' not null,
      "id" text primary key not null,
      "user_id" text not null,
      "kind" text not null,
      "project_id" text default '' not null,
      "name" text not null,
      "config" text default '{}' not null,
      "source" text default 'local' not null,
      "created_at" text not null,
      "updated_at" text not null,
      constraint "capability_source_user_kind_project_name_unique" unique ("user_id", "kind", "project_id", "name")
    )
  `.execute(db)
  await sql`
    CREATE TABLE "extension_contribution" (
      "id" text primary key not null,
      "source_id" text not null,
      "user_id" text not null,
      "project_id" text not null,
      "kind" text not null,
      "contribution_key" text not null,
      "payload" text not null,
      "position" integer not null,
      "revision" integer not null,
      "active" integer not null check ("active" in (0, 1)),
      "created_at" text not null,
      "updated_at" text not null
    )
  `.execute(db)
  await sql`CREATE UNIQUE INDEX "extension_contribution_active_key" ON "extension_contribution"
    ("source_id", "kind", "contribution_key") WHERE "active" = 1`.execute(db)
  await sql`CREATE INDEX "extension_contribution_owner" ON "extension_contribution"
    ("user_id", "project_id", "source_id")`.execute(db)
  // Preserve historical identities on uninstall, including deletion outside the service facade.
  await sql`CREATE TRIGGER "archive_source_contributions" AFTER DELETE ON "capability_source"
    BEGIN UPDATE "extension_contribution" SET "active" = 0,
      "updated_at" = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE "source_id" = OLD."id"; END`.execute(db)
  await sql`
    CREATE TABLE "capability_policy_revision" (
      "user_id" text not null,
      "agent_id" text not null,
      "revision" integer not null default 0,
      primary key ("user_id", "agent_id")
    )
  `.execute(db)
  await sql`
    CREATE TABLE "capability_policy_binding" (
      "user_id" text not null,
      "contribution_id" text not null,
      "agent_id" text not null,
      "contribution_revision" integer not null,
      "policy_revision" integer not null,
      primary key ("user_id", "contribution_id", "agent_id")
    )
  `.execute(db)
  await sql`
    CREATE TABLE "capability_rule" (
      "user_id" text not null,
      -- The agent the rules belong to, and the whole key. There is no scope ladder: a run
      -- resolves one list, in order, last match wins.
      "agent_id" text not null,
      "position" integer not null,
      "action" text not null,
      "resource" text default '*' not null,
      "effect" text not null,
      "message" text,
      -- Who wrote the row, when it was not the user by hand: JSON {kind:'agent-proposal',
      -- sessionId, proposalId, at}. NULL = authored in Settings. Carried through every
      -- replace so the Capabilities screen can show "proposed by the agent in LOCALIX-4".
      "origin_json" text,
      primary key ("user_id", "agent_id", "position")
    )
  `.execute(db)
  await sql`
    CREATE TABLE "config_proposals" (
      "id" text primary key not null,
      "user_id" text not null,
      "session_id" text not null,
      "remedy_id" text not null,
      "title" text not null,
      "change_json" text not null,
      "agent_id" text not null,
      "status" text not null,
      "error" text,
      "created_at" text default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) not null,
      "decided_at" text
    )
  `.execute(db)
  await sql`
    CREATE INDEX "config_proposals_session_idx" ON "config_proposals" ("user_id", "session_id", "created_at")
  `.execute(db)
  await sql`
    CREATE TABLE "kanban_tasks" (
      "id" text primary key not null,
      "user_id" text not null,
      "project_id" text,
      "scope_session_id" text not null references "agent_sessions" ("id") on delete cascade,
      "title" text not null,
      "description" text default '' not null,
      "status" text default 'backlog' not null,
      "kind" text default 'task' not null,
      "parent_task_id" text,
      "created_by_session_id" text,
      "assignee" text,
      "agent_id" text,
      "error" text,
      "depends_on" text,
      "priority" integer default 0 not null,
      "subtasks" text,
      "origin" text,
      "sort_order" real default 0 not null,
      "created_at" text default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) not null,
      "updated_at" text default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) not null,
      "attached_paths" text,
      "seq" integer,
      "artifacts" text,
      labels TEXT
    )
  `.execute(db)
  await sql`
    CREATE TABLE "projects" (
      "id" text primary key not null,
      "user_id" text not null,
      "name" text not null,
      "working_dir" text not null,
      "created_at" text default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) not null,
      "updated_at" text default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) not null,
      "settings" text,
      "seq" integer default 0 not null,
      -- Deletion is SOFT. A session's project_id is not nullable — every session belongs to a
      -- project, because "no project" used to resolve to the global capability scope — so a
      -- hard delete would have to either orphan its sessions back into that conflation or take
      -- them with it. Neither is what "delete this project" means. The row stays, hidden, and
      -- re-opening the same directory revives it with its sessions and rules intact.
      "deleted_at" text
    )
  `.execute(db)
  await sql`
    CREATE TABLE "provider_connection_keys" (
      "id" text primary key not null,
      "connection_id" text not null references "provider_connections" ("id") on delete cascade,
      "user_id" text not null,
      "label" text default '' not null,
      "credential_type" text default 'api-key' not null,
      "priority" integer default 0 not null,
      "enabled" integer default 1 not null,
      "created_at" text default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) not null,
      "updated_at" text default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) not null,
      "vault_item_id" text references "vault_items" ("id") on delete set null
    )
  `.execute(db)
  await sql`
    CREATE TABLE "provider_connections" (
      "id" text primary key not null,
      "user_id" text not null,
      "provider_id" text not null,
      "provider_name" text not null,
      "label" text not null,
      "auth_type" text not null,
      "status" text default 'pending' not null,
      "created_at" text default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) not null,
      "updated_at" text default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) not null,
      constraint "provider_connections_user_provider_label_unique" unique ("user_id", "provider_id", "label")
    )
  `.execute(db)
  await sql`
    CREATE TABLE "ref_sequence_counters" (
      "scope" text not null,
      "last_value" integer not null,
      constraint "ref_sequence_counters_pk" primary key ("scope")
    )
  `.execute(db)
  await sql`
    CREATE TABLE "work_records" (
      "id" text primary key not null,
      "user_id" text not null,
      "session_id" text not null references "agent_sessions" ("id") on delete cascade,
      "agent_id" text,
      "display_id" text not null,
      "kind" text not null check ("kind" in ('job', 'monitor', 'stream', 'promoted', 'subagent')),
      "label" text not null,
      "status" text not null
        check ("status" in ('running', 'succeeded', 'failed', 'cancelled', 'timed-out', 'lost')),
      "exit_code" integer,
      "tool_call_id" text not null,
      "message_id" text,
      "terminal_id" text,
      "child_session_id" text references "agent_sessions" ("id") on delete set null,
      "event_count" integer default 0 not null,
      "last_event" text,
      "last_event_at" text,
      "started_at" text not null,
      "ended_at" text
    )
  `.execute(db)
  await sql`
    CREATE TABLE "triggers" (
      "id" text primary key not null,
      "user_id" text not null,
      "session_id" text not null references "agent_sessions" ("id") on delete cascade,
      "owner_kind" text not null check ("owner_kind" in ('agent', 'user', 'plugin', 'system')),
      "owner_agent_id" text,
      "owner_ref" text,
      "action" text not null,
      "kind" text not null,
      "state" text default 'armed' not null
        check ("state" in ('armed', 'held', 'firing', 'ended')),
      "hold_reason" text check ("hold_reason" in ('busy', 'rate-limited')),
      "end_reason" text,
      "spec_json" text not null,
      "payload_json" text not null,
      "next_due_at" text,
      "fire_seq" integer default 0 not null,
      "fire_count" integer default 0 not null,
      "last_fired_at" text,
      "last_status" text check ("last_status" in ('ok', 'error')),
      "last_error" text,
      "created_at" text not null,
      "updated_at" text not null
    )
  `.execute(db)
  await sql`
    CREATE TABLE "skill_usage" (
      "id" text primary key not null,
      "user_id" text not null,
      "project_id" text default '' not null,
      "skill_name" text not null,
      "scope" text default 'global' not null,
      "get_count" integer default 0 not null,
      "last_used_at" text,
      "pinned" integer default 0 not null,
      "archived_at" text,
      "created_at" text not null,
      "updated_at" text not null,
      constraint "skill_usage_user_project_skill_scope_unique" unique ("user_id", "project_id", "skill_name", "scope")
    )
  `.execute(db)
  await sql`
    CREATE TABLE "tool_output_artifacts" (
      "user_id" text not null,
      "session_id" text not null references "agent_sessions" ("id") on delete cascade,
      "tool_call_id" text not null,
      "tool_name" text not null,
      "content" text not null,
      "input_json" text not null,
      "is_error" integer not null,
      "byte_length" integer not null,
      "created_at" text not null,
      "updated_at" text not null,
      constraint "tool_output_artifacts_pk" primary key ("user_id", "session_id", "tool_call_id")
    )
  `.execute(db)
  await sql`
    CREATE VIRTUAL TABLE tool_output_chunks USING fts5( content, heading, tool_call_id UNINDEXED, tool_name UNINDEXED, chunk_index UNINDEXED, session_id UNINDEXED, user_id UNINDEXED, created_at UNINDEXED, tokenize = 'porter unicode61' )
  `.execute(db)
  await sql`
    CREATE TABLE "tool_usage" (
      "id" text primary key not null,
      "user_id" text not null,
      "project_id" text default '' not null,
      "tool_name" text not null,
      "call_count" integer default 0 not null,
      "error_count" integer default 0 not null,
      "first_seen_at" text not null,
      "last_used_at" text,
      "created_at" text not null,
      "updated_at" text not null
    )
  `.execute(db)
  await sql`
    CREATE TABLE "usage_events" (
      "message_id" text primary key not null,
      "session_id" text not null,
      "root_session_id" text,
      "user_id" text not null,
      "provider_connection_id" text,
      "provider_id" text,
      "model_id" text not null,
      "created_at" text default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) not null,
      "input_tokens" integer default 0 not null,
      "output_tokens" integer default 0 not null,
      "cache_read_tokens" integer default 0 not null,
      "cache_write_tokens" integer default 0 not null,
      "reasoning_tokens" integer default 0 not null,
      "total_tokens" integer default 0 not null,
      "cost_usd" real default 0 not null,
      "cost_source" text default 'estimated' not null,
      "finish_reason" text,
      "duration_ms" integer,
      "key_id" text,
      "key_label" text,
      "key_masked" text,
      cache_write_1h_tokens INTEGER NOT NULL DEFAULT 0,
      -- WHICH participant spent this. A group chat runs several agents over one session,
      -- so session_id no longer answers "who", and model_id answers it only while two
      -- members happen to run different models. Null for a row written before the party
      -- existed, and for an auxiliary call with no speaker of its own.
      "agent_id" text
    )
  `.execute(db)
  await sql`
    CREATE TABLE "user_profiles" (
      "user_id" text primary key not null,
      "name" text,
      "role" text,
      "expertise" text,
      "preferences" text,
      "working_context" text,
      "updated_at" text default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) not null,
      "response_defaults" text,
      "ui_settings" text,
      "agent_settings" text,
      "experience_level" text,
      "main_use_case" text
    )
  `.execute(db)
  await sql`
    CREATE TABLE "vault_aliases" (
      "user_id" text not null,
      "alias" text not null,
      "item_id" text not null references "vault_items" ("id") on delete cascade,
      "field" text default 'value' not null,
      "created_at" text not null,
      constraint "vault_aliases_pk" primary key ("user_id", "alias")
    )
  `.execute(db)
  await sql`
    CREATE TABLE "vault_audit" (
      "id" integer primary key autoincrement,
      "user_id" text not null,
      "item_id" text references "vault_items" ("id") on delete set null,
      "actor_type" text not null,
      "actor_id" text not null,
      "consumer_type" text default '' not null,
      "consumer_id" text default '' not null,
      "operation" text not null,
      "result" text not null,
      "context_json" text default '{}' not null,
      "created_at" text not null
    )
  `.execute(db)
  await sql`
    CREATE TABLE "vault_folders" (
      "id" text primary key not null,
      "user_id" text not null,
      "parent_id" text references "vault_folders" ("id") on delete cascade,
      "name" text not null,
      "description" text default '' not null,
      "created_at" text not null,
      "updated_at" text not null
    )
  `.execute(db)
  await sql`
    CREATE TABLE "vault_item_bindings" (
      "user_id" text not null,
      "item_id" text not null references "vault_items" ("id") on delete cascade,
      "consumer_type" text not null,
      "consumer_id" text not null,
      "field" text default 'value' not null,
      "label" text default '' not null,
      "created_at" text not null,
      "updated_at" text not null,
      constraint "vault_item_bindings_pk" primary key ("user_id", "item_id", "consumer_type", "consumer_id", "field")
    )
  `.execute(db)
  await sql`
    CREATE TABLE "vault_item_versions" (
      "id" text primary key not null,
      "item_id" text not null references "vault_items" ("id") on delete cascade,
      "version" integer not null,
      "encrypted_payload" text,
      "payload_ref" text,
      "payload_schema" text not null,
      "reason" text not null,
      "created_at" text not null,
      "redacted_at" text,
      constraint "vault_item_versions_item_version_unique" unique ("item_id", "version"),
      constraint "vault_item_versions_one_payload" check ((encrypted_payload IS NOT NULL AND payload_ref IS NULL) OR (encrypted_payload IS NULL AND payload_ref IS NOT NULL))
    )
  `.execute(db)
  await sql`
    CREATE TABLE "vault_items" (
      "id" text primary key not null,
      "user_id" text not null,
      "kind" text not null,
      "name" text not null,
      "description" text default '' not null,
      "folder_id" text references "vault_folders" ("id") on delete set null,
      "backend" text default 'local-aes' not null,
      "external_ref" text,
      "source" text default 'user' not null,
      "schema_version" integer default 1 not null,
      "current_version" integer default 1 not null,
      "favorite" integer default 0 not null,
      "tags_json" text default '[]' not null,
      "created_at" text not null,
      "updated_at" text not null,
      "deleted_at" text
    )
  `.execute(db)

  // Indexes follow their tables; each one exists for a query the app actually makes.
  // Do not duplicate prefixes of UNIQUE indexes (memory, capability source, usage history).
  await sql`CREATE INDEX agent_messages_assistant_reconcile_idx ON agent_messages(id) WHERE role = 'assistant'`.execute(
    db,
  )
  await sql`CREATE INDEX "agent_messages_user_session_idx" on "agent_messages" ("user_id", "session_id")`.execute(
    db,
  )
  await sql`CREATE INDEX agent_messages_session_role_sequence_idx ON agent_messages(session_id, role, sequence DESC)`.execute(
    db,
  )
  await sql`CREATE INDEX participant_lane_snapshots_session_idx ON participant_lane_snapshots(session_id)`.execute(
    db,
  )
  await sql`CREATE INDEX agent_delivery_receipts_session_idx ON agent_delivery_receipts(session_id)`.execute(
    db,
  )
  await sql`CREATE INDEX agent_delivery_receipts_created_idx ON agent_delivery_receipts(created_at)`.execute(
    db,
  )
  await sql`CREATE INDEX agent_queue_items_leased_expiry_idx ON agent_queue_items(lease_expires_at) WHERE state = 'leased'`.execute(
    db,
  )
  await sql`CREATE INDEX "agent_queue_items_priority_sequence_idx" on "agent_queue_items" ("priority", "sequence")`.execute(
    db,
  )
  await sql`CREATE INDEX "agent_queue_items_session_priority_sequence" on "agent_queue_items" ("session_id", "priority", "sequence")`.execute(
    db,
  )
  await sql`CREATE UNIQUE INDEX agent_runs_one_running_per_session ON agent_runs(session_id) WHERE status = 'running'`.execute(
    db,
  )
  await sql`CREATE INDEX "agent_runs_session_started_idx" on "agent_runs" ("session_id", "started_at")`.execute(
    db,
  )
  await sql`CREATE INDEX "agent_sessions_parent_idx" on "agent_sessions" ("user_id", "parent_session_id", "updated_at")`.execute(
    db,
  )
  await sql`CREATE INDEX "agent_sessions_source_tool_idx" on "agent_sessions" ("user_id", "source_tool_call_id")`.execute(
    db,
  )
  await sql`CREATE UNIQUE INDEX agent_sessions_task_name_unique_idx ON agent_sessions(root_session_id, task_name)`.execute(
    db,
  )
  await sql`CREATE INDEX agent_sessions_tree_idx ON agent_sessions(user_id, root_session_id, session_kind, created_at DESC, seq DESC)`.execute(
    db,
  )
  await sql`CREATE INDEX agent_sessions_recovery_idx ON agent_sessions(user_id, session_kind, updated_at)`.execute(
    db,
  )
  await sql`CREATE INDEX agent_sessions_task_attempt_idx ON agent_sessions(user_id, parent_session_id, json_extract(invocation_json, '$.kanbanTaskId'), created_at DESC, seq DESC)`.execute(
    db,
  )
  // Ordered read of one session's party — the shape every session read wants.
  await sql`CREATE INDEX "conversation_participants_session_position_idx" on "conversation_participants" ("session_id", "position")`.execute(
    db,
  )
  await sql`CREATE INDEX conversation_participants_connection_idx ON conversation_participants(provider_connection_id)`.execute(
    db,
  )
  await sql`CREATE INDEX "agent_sessions_user_last_message_idx" on "agent_sessions" ("user_id", "last_message_at")`.execute(
    db,
  )
  await sql`CREATE INDEX "agent_sessions_user_pinned_updated_idx" on "agent_sessions" ("user_id", "is_pinned", "updated_at")`.execute(
    db,
  )
  await sql`CREATE INDEX "idx_agent_messages_parent" on "agent_messages" ("session_id", "parent_id")`.execute(
    db,
  )
  await sql`CREATE INDEX "kanban_tasks_user_parent_idx" on "kanban_tasks" ("user_id", "parent_task_id", "sort_order", "created_at")`.execute(
    db,
  )
  await sql`CREATE INDEX "kanban_tasks_user_status" on "kanban_tasks" ("user_id", "status", "sort_order")`.execute(
    db,
  )
  await sql`CREATE INDEX kanban_tasks_session_order_idx ON kanban_tasks(scope_session_id, user_id, sort_order, created_at)`.execute(
    db,
  )
  await sql`CREATE INDEX kanban_tasks_user_order_idx ON kanban_tasks(user_id, sort_order, created_at)`.execute(
    db,
  )
  await sql`CREATE INDEX extension_contribution_source_idx ON extension_contribution(source_id)`.execute(
    db,
  )
  await sql`CREATE INDEX "projects_user_id_idx" on "projects" ("user_id")`.execute(db)
  await sql`CREATE INDEX "provider_connection_keys_connection_priority_idx" on "provider_connection_keys" ("connection_id", "priority")`.execute(
    db,
  )
  await sql`CREATE UNIQUE INDEX "provider_connection_keys_vault_item_unique" on "provider_connection_keys" ("vault_item_id")`.execute(
    db,
  )
  await sql`CREATE UNIQUE INDEX work_records_display_idx ON work_records(session_id, display_id)`.execute(
    db,
  )
  await sql`CREATE INDEX work_records_running_idx ON work_records(status) WHERE status = 'running'`.execute(
    db,
  )
  await sql`CREATE INDEX work_records_child_idx ON work_records(child_session_id)`.execute(db)
  await sql`CREATE INDEX triggers_session_idx ON triggers(session_id)`.execute(db)
  await sql`CREATE INDEX triggers_due_idx ON triggers(next_due_at) WHERE state IN ('armed', 'held')`.execute(
    db,
  )
  await sql`CREATE INDEX tool_output_artifacts_session_idx ON tool_output_artifacts(session_id)`.execute(
    db,
  )
  await sql`CREATE UNIQUE INDEX tool_usage_user_project_tool_unique_idx ON tool_usage(user_id, project_id, tool_name)`.execute(
    db,
  )
  await sql`CREATE INDEX "usage_events_user_created_message_idx" on "usage_events" ("user_id", "created_at", "message_id")`.execute(
    db,
  )
  await sql`CREATE INDEX "usage_events_user_model_created_idx" on "usage_events" ("user_id", "model_id", "created_at")`.execute(
    db,
  )
  await sql`CREATE INDEX "usage_events_user_provider_created_idx" on "usage_events" ("user_id", "provider_id", "created_at")`.execute(
    db,
  )
  await sql`CREATE INDEX "usage_events_user_session_created_idx" on "usage_events" ("user_id", "session_id", "created_at")`.execute(
    db,
  )
  await sql`CREATE INDEX "vault_aliases_item_idx" on "vault_aliases" ("item_id")`.execute(db)
  await sql`CREATE INDEX vault_item_bindings_item_idx ON vault_item_bindings(item_id)`.execute(db)
  await sql`CREATE INDEX vault_folders_parent_idx ON vault_folders(parent_id)`.execute(db)
  await sql`CREATE INDEX vault_items_folder_idx ON vault_items(folder_id)`.execute(db)
  await sql`CREATE INDEX "vault_audit_item_created_idx" on "vault_audit" ("item_id", "created_at")`.execute(
    db,
  )
  await sql`CREATE INDEX "vault_audit_user_created_idx" on "vault_audit" ("user_id", "created_at")`.execute(
    db,
  )
  await sql`CREATE UNIQUE INDEX vault_folders_child_name_unique ON vault_folders (user_id, parent_id, name) WHERE parent_id IS NOT NULL`.execute(
    db,
  )
  await sql`CREATE UNIQUE INDEX vault_folders_root_name_unique ON vault_folders (user_id, name) WHERE parent_id IS NULL`.execute(
    db,
  )
  await sql`CREATE INDEX "vault_items_user_kind_idx" on "vault_items" ("user_id", "kind")`.execute(
    db,
  )
  await sql`CREATE INDEX "vault_items_user_updated_idx" on "vault_items" ("user_id", "updated_at")`.execute(
    db,
  )

  // The message search projection is maintained by triggers rather than by the write path:
  // a row that reaches the table is indexed whoever wrote it.
  await sql`
    CREATE TRIGGER agent_messages_fts_delete AFTER DELETE ON agent_messages BEGIN INSERT INTO agent_messages_fts(agent_messages_fts, rowid, search_text, role, session_id, user_id, id, created_at) VALUES ('delete', old.rowid, old.search_text, old.role, old.session_id, old.user_id, old.id, old.created_at); END
  `.execute(db)
  await sql`
    CREATE TRIGGER agent_messages_fts_insert AFTER INSERT ON agent_messages BEGIN INSERT INTO agent_messages_fts(rowid, search_text, role, session_id, user_id, id, created_at) VALUES (new.rowid, new.search_text, new.role, new.session_id, new.user_id, new.id, new.created_at); UPDATE agent_messages SET search_text = coalesce(json_extract(new.payload_json, '$.content'), '') WHERE rowid = new.rowid AND search_text IS NOT coalesce(json_extract(new.payload_json, '$.content'), ''); END
  `.execute(db)
  await sql`
    CREATE TRIGGER agent_messages_fts_update AFTER UPDATE OF search_text ON agent_messages WHEN old.search_text IS NOT new.search_text BEGIN INSERT INTO agent_messages_fts(agent_messages_fts, rowid, search_text, role, session_id, user_id, id, created_at) VALUES ('delete', old.rowid, old.search_text, old.role, old.session_id, old.user_id, old.id, old.created_at); INSERT INTO agent_messages_fts(rowid, search_text, role, session_id, user_id, id, created_at) VALUES (new.rowid, new.search_text, new.role, new.session_id, new.user_id, new.id, new.created_at); END
  `.execute(db)
  await sql`
    CREATE TRIGGER agent_runs_finalize_message_search AFTER UPDATE OF status ON agent_runs WHEN old.status = 'running' AND new.status <> 'running' BEGIN UPDATE agent_messages SET search_text = coalesce(json_extract(payload_json, '$.content'), '') WHERE id = ( SELECT id FROM agent_messages WHERE session_id = new.session_id AND role = 'assistant' ORDER BY sequence DESC LIMIT 1 ) AND search_text IS NOT coalesce(json_extract(payload_json, '$.content'), ''); END
  `.execute(db)
  await sql`
    CREATE TRIGGER agent_sessions_finalize_message_search AFTER UPDATE OF runtime_status ON agent_sessions WHEN old.runtime_status = 'running' AND new.runtime_status <> 'running' BEGIN UPDATE agent_messages SET search_text = coalesce(json_extract(payload_json, '$.content'), '') WHERE id = ( SELECT id FROM agent_messages WHERE session_id = new.id AND role = 'assistant' ORDER BY sequence DESC LIMIT 1 ) AND search_text IS NOT coalesce(json_extract(payload_json, '$.content'), ''); END
  `.execute(db)

  // The display-ref allocators start at zero, one row per scope. They are seeded HERE
  // rather than created on demand because `nextRefSeqInTransaction` allocates with a
  // conditional UPDATE and treats a missing row as an incomplete schema — which is the
  // honest reading: an allocator with no row cannot be atomic, and inventing one lazily
  // would race exactly where the atomicity matters.
  await sql`
    INSERT INTO ref_sequence_counters (scope, last_value)
    VALUES ('agent_sessions', 0), ('projects', 0), ('kanban_tasks', 0)
  `.execute(db)

  // One seeded row: a public code-search MCP server every install starts with. It is an
  // ordinary record afterwards — Settings may edit, disable or delete it, and the migration
  // ledger keeps a deletion from being undone on the next start.
  await sql`
    INSERT INTO capability_source (
      id, user_id, kind, project_id, name, config, created_at, updated_at
    )
    SELECT
      'localix-default-mcp-grep',
      default_user_id,
      'mcp',
      '',
      'grep',
      '{"transport":"http","description":"Search public GitHub code with grep.app","url":"https://mcp.grep.app"}',
      strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
      strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    FROM localix_migration_context
    LIMIT 1
    ON CONFLICT (user_id, kind, project_id, name) DO NOTHING
  `.execute(db)
}

/** Dropping the schema is dropping the database; a partial teardown has no honest meaning. */
export async function down(): Promise<void> {
  throw new Error(
    'The baseline has no down migration. Restore an explicit backup or select a fresh data directory.',
  )
}
