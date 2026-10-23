# Database Workspace architecture

Database Workspace is a first-party Localix workbench for relational, key-value, document and search
engines. It is intentionally split into a runtime-neutral catalog, server-side adapters, a
connection service, workbench UI, and native agent/context surfaces.

## Design decisions

The workbench is built from these surfaces:

| Surface                      | Localix shape                                                         |
| ---------------------------- | --------------------------------------------------------------------- |
| Connection editor            | Manifest-driven engine cards and connection fields                    |
| Persistent schema sidebar    | Connection rail + schema pane + connection home                       |
| Driver capability flags      | Runtime-neutral catalog plus a typed executable registry              |
| Driver/schema state          | Shared connection and schema stores across workspace and console tabs |
| Query/data/schema work areas | Native editor-grid consoles, result tabs and schema explorer          |
| Pre-run parameter form       | Safe out-of-band binds with per-console remembered values             |
| Extension/query hooks        | Mini app SDK resources, search, context providers and agent tools     |

Parameter execution detects placeholders at Run time, requests values before execution and retains
them for the next invocation.

Localix-native strengths the design deliberately retains:

- Database sessions, TLS, SSH and credentials remain backend-only.
- Read-only enforcement is server-side and understands SQL, Redis, MongoDB and Elasticsearch input.
- `localix://resource/db` resources link a connection, schema, table or column directly into Context
  Fabric.
- The ONE `database_client` agent tool (`backend/database-tool.ts`) fronts connections, schema,
  browse, query and connection management behind an `action`; each verb's body is its own module
  over the same service and driver metadata as the UI.
- Query results remain in Localix editor-grid tabs, so database work composes with chat, files,
  terminals and other workspaces.

## Layer contract

```text
shared/driver-catalog
    ├── UI connection hub, labels, capabilities and examples
    ├── backend live DriverFlags
    ├── executable driver registry
    └── model-facing query/schema guidance

backend adapter ──> DatabaseService ──> routes
                         ├────────────> localix://resource/db resource + Context Fabric
                         ├────────────> `database_client` tool (connections · schema · browse · query · connect…)
                         └────────────> search provider

UI API client ──> shared connection model
                       ├──────────────> Database Workspace
                       ├──────────────> schema store
                       └──────────────> console tabs
```

No UI component imports a concrete database client. No driver receives agent or React state.
Connection lists, resources, search metadata and structured connection descriptions omit sensitive
configuration fields. Underlying error text and arbitrary query results are separate paths; this
omission is not a general credential-redaction guarantee.

## Workspace flows

- **Overview** summarizes the connection fleet by status, engine family, read-only mode and SSH.
- **Explorer** keeps one connection rail and one schema tree mounted while its main surface switches
  among the connection home, bounded data browser, structure inspector and relationship diagram.
  Both trees (the connections root and a connection's schema browser) are ONE flat row model
  (`ui/model/schemaTreeRows.ts`) rendered through a windowed `ui/ui/schema-tree/SchemaTree.tsx`:
  only visible rows mount, the tree is one Tab stop, and one delegated context menu serves every
  row. The filter matches names only; column matching is an explicit toggle bounded to 500 tables.
  The schema store coalesces per-table loads into one snapshot per task.
- **Data** pages and sorts through `DbDriver.browse`; SQL identifiers are quoted by the adapter,
  MongoDB and Elasticsearch use their native sort APIs, and Redis cursor reads are normalized to the
  same numeric offset contract.
- **Editing** reuses the existing primary-key gate and staged grid mutations. A commit is one
  server-side atomic batch; read-only connections and objects without a primary key never expose it.
- **Import/export** uses the same CSV/JSON/SQL pipeline as query results. CSV becomes reviewable SQL
  in the console rather than executing on selection.
- **Structure and ERD** consume the shared schema cache. Cache identities include schema + table, so
  `public.events` and `audit.events` cannot overwrite each other.
- **Schema designer** generates a dialect-correct, identifier-quoted `CREATE TABLE` draft from the
  catalog's curated type list, then opens it in the console for review.
- **Query consoles** remain independent editor-grid tabs with completion, history, explain,
  cancellation, manual transactions, result tabs, FK navigation and drag-to-agent results.
- **Query parameters** are scanned from the focused statement using the selected driver's manifest
  (`?`, `:name`, and supported native forms such as `$1`, `@name`, `?1`, or `$name`). The console
  confirms values before every run, remembers them only for that console instance, and sends them
  out-of-band through the common `DbDriver.query(sql, params)` port where the driver supports binds.
  SQL Server rewrites positional `?` placeholders to named bound parameters, skipping strings,
  identifiers and comments. User values are not inserted into query text by the common console
  parser.
- **Scripts and engine checks** share one splitter (`shared/sql-statements.ts`). The service runs a
  multi-statement text statement by statement on one session (`service/run-script.ts`) unless the
  driver declares `nativeScripts`. `DbDriver.validate` uses engine prepare, parse, or explain
  (`service/run-validate.ts`); it does not run the ordinary query path. This is not a universal
  no-effects guarantee: some SQLite PRAGMAs change connection state during prepare.
- **Database work items** (workspace, connection, console, table and diagram) are restorable
  editor-grid tabs that belong to the chat they were opened in. A console runs edit prediction for
  its chat and the other tabs open consoles and tables into theirs, so every open names the chat
  (the tab's own session, or the status item's) and the console command bus is keyed by chat and
  connection. Saved connections themselves stay app-wide. Cold restoration treats mini app
  activation as a tri-state: a backend snapshot that has not arrived is pending, not disabled, so a
  slow sidecar cannot erase the saved tab layout.

## Structured read invariant

`DbDriver.browse` is the only generic data-browser port. It accepts object identity, bounded
pagination and an optional quoted/native sort. It never accepts executable query text. This keeps
the workspace and the agent's `browse` action safe and engine-agnostic while `query` remains the
explicit advanced escape hatch for joins, filters, aggregations and native commands.

## Adding another engine

An engine addition is compile-time visible across the system:

1. Add its identity, transport, connection UX, parameter grammar/bind target and static capabilities
   to `shared/driver-catalog.ts`.
2. Add a discriminated connection config and secret/tunnel normalization where the transport needs
   it.
3. Implement the narrow `DbDriver` port with normalized schemas, row-major results and structured
   bounded browsing.
4. Register its adapter in `backend/drivers/index.ts`.
5. Add its native input read-only classifier when it is not SQL.
6. Add adapter, introspection, registry and agent-context tests.

The catalog and registry tests require one unique manifest and executable definition for every
dialect. UI engine lists, defaults, capability gates and agent query examples then update from that
declaration without their own dialect switches.

## Related guides

- [Database user guide and engine validation boundaries](../../docs/features/database.md)
- [Bundled mini app ownership](../README.md)

## Source of truth

- [Script execution](backend/service/run-script.ts)
- [Validation orchestration](backend/service/run-validate.ts)
- [SQL Server parameter boundary](backend/drivers/mssql.ts)
- [SQLite prepare/finalize validation](backend/drivers/sqlite-validate.ts)
