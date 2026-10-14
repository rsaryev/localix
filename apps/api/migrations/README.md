# Localix database schema

`20260601T000000_init_schema.ts` is the frozen baseline: the schema every database starts from. It
is never edited again, and `src/db/migration-freeze.test.ts` fails on any change to its contents.
Every later schema change is its own forward migration beside it.

## Changing the schema

The repository formatter excludes migration sources: a formatting pass can add punctuation and
change a recorded digest even when the SQL is unchanged. Prepare a migration's formatting before
placing it in this directory, and never reformat it after a development server has applied it.

**An existing migration file is never renamed, edited or deleted — committed or not.** A migration
is final the moment any database runs it, and the dev server runs migrations as soon as a file is
saved, so an uncommitted migration has usually already run on your own database. A rename makes that
database refuse to start; an edit leaves it on a schema no file describes. To change what a
migration did, add a new one after it. The runtime ledger (`src/db/migration-ledger.ts`) refuses a
database whose recorded migrations no longer match their files and names what to restore;
`src/db/migration-freeze.test.ts` refuses the same change to committed migrations in CI.

1. Add a file named `<yyyymmdd>T<hhmmss>_<snake_case>.ts`, later than every existing one. It exports
   `up(db)` and imports only `kysely`. The packaged app compiles every file in this folder into
   `server.js` (`scripts/embed-migrations-plugin.mjs`), so a file whose name does not match that
   pattern fails the build instead of being left out.
2. Change the types in `src/db/types.ts` to match.
3. Run `bun test apps/api/src/db`.

```ts
import { sql, type Kysely } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE agent_sessions ADD COLUMN note TEXT`.execute(db)
}
```

SQLite's `ALTER TABLE` adds, renames and drops columns. Anything else — a new constraint, a changed
column type or `CHECK` — is a table rebuild: create the new table, copy the rows, drop the old one,
rename, recreate its indexes and triggers
([SQLite's procedure](https://www.sqlite.org/lang_altertable.html#otheralter)). Start such a
migration with `PRAGMA defer_foreign_keys = ON` so foreign keys are checked at commit rather than
while the table is briefly missing. A migration never edits the ledger or reads `process.env`; a
data migration that needs the default user reads `localix_migration_context`.

## What startup does

`src/db/migrator.ts` runs the Kysely Migrator. Before any pending migration touches an existing
database, `backupDatabaseBeforeMigration` writes a consistent snapshot (committed WAL pages
included) to `backups/migrations/`, keeping the two newest. The pending migrations and the schema
check then run in one transaction:

- Kysely checks the order and the ledger, and refuses a database that ran a migration this build
  does not have (an older build opening a newer database).
- `validateSchema` compares the physical tables, columns, constraints, indexes and triggers with the
  schema the same migrations build in an in-memory database. A dropped index, a hand-edited table or
  an edited already-applied migration is refused.

A failure rolls the whole transaction back: the database is exactly as it was. The SQLite adapter
reports transactional DDL (`connection.ts`) because SQLite has it; Kysely's stock adapter says it
does not, and the Migrator then ran each migration outside any transaction.

## Read-only audit

From the repository root:

```bash
bun run --cwd apps/api db:audit
bun run --cwd apps/api db:audit /path/to/database.sqlite
```

The audit opens an existing file read-only and checks a consistent snapshot: SQLite integrity,
foreign-key violations, pending migrations, and, when none are pending, the actual DDL. It never
creates a missing database, changes file permissions, resets sessions, or prints transcript or
credential contents. A mismatch returns exit code 1. An integrity result of `ok` alone does not mean
the schema matches the app.

## Query and storage contracts

- Statements are finalized after reads, writes, errors, and cancelled streams. Result columns,
  rather than SQL-prefix guesses, classify CTEs and mutations with `RETURNING`.
- Delegation trees and recovery use matching composite indexes. Progress inspects only the latest
  assistant message, with bounded public text and no private reasoning or tool output.
- Every foreign-key child lookup has a leading index, so cascading deletes do not scan unrelated
  tables. Redundant prefixes of existing unique/covering indexes are omitted.
- Text primary keys are explicitly non-null, and generated timestamps use UTC ISO milliseconds.
- No blanket foreign keys are added to intentional historical references: usage records and
  extension identities may outlive the source objects they describe.

Regression tests in `src/db/schema-quality.test.ts` inspect production query plans and include
negative controls. Migration behaviour is in `src/db/migrator.test.ts`, the freeze in
`src/db/migration-freeze.test.ts`. Run the focused database tests above after schema changes; full
repository gates belong to CI.

The index layout follows SQLite's
[query-planning guidance](https://www.sqlite.org/queryplanner.html) and
[foreign-key indexing guidance](https://www.sqlite.org/foreignkeys.html). Query-plan tests use
[EXPLAIN QUERY PLAN](https://www.sqlite.org/eqp.html), not wall-clock thresholds.

## Source of truth

- [Migration runner](../src/db/migrator.ts)
- [Migration ledger](../src/db/migration-ledger.ts)
- [Committed migration freeze](../src/db/migration-freeze.test.ts)
- [Read-only audit](../src/db/audit-cli.ts)
- [Packaged migration embedding](../../../scripts/embed-migrations-plugin.mjs)
