# Mini apps

The source of Localix's first-party mini apps. A mini app is Localix's own format, not a Claude Code
plugin: one `mini-app.json` (identity, category, backend, settings, commands), a `guide.md` the
agent reads with `mini_app_guide` before it first uses the app, a native backend (`backend/`) and
screens (`ui/`). It holds no `skills/`, `.claude-plugin/` or hooks. Bundled plugins in the Claude
Code format live in [`plugins/`](../plugins/). The contract and the migration status:
[plugins and mini apps](../docs/internals/plugins-and-mini-apps.md).

Until the catalog ships (phase 4 of that page), the build stages these mini apps and the application
synchronizes managed copies into `~/.localix/plugins`; discovery reads the installed copy rather
than this source tree.

## Workbenches

| Mini app                        | Product surface                                                  |
| ------------------------------- | ---------------------------------------------------------------- |
| [Code Graph](code-graph/)       | Project files, symbols, imports, calls, and graph queries.       |
| [Database](database/)           | SQL and data-source connections, schemas, and queries.           |
| [DevOps](devops/)               | Docker and Kubernetes inspection and operations.                 |
| [Documents](documents/)         | Extraction, generation, viewers, tables, and charts.             |
| [Learning Studio](learning/)    | File-authored courses, lessons, assessment, and progress.        |
| [Project Space](project-space/) | Shared notes and live file cards on a canvas.                    |
| [Reader](reader/)               | Local books and documents with annotations and agent context.    |
| [Resumes](resume/)              | Resume fields, templates, preview, and document export.          |
| [System Overview](template/)    | OS, CPU, memory, and process inspection; the workbench scaffold. |
| [Trading](trading/)             | Public market data; no order placement.                          |

## Workflow and integration mini apps

| Mini app              | Product surface                                        |
| --------------------- | ------------------------------------------------------ |
| [API Client](api/)    | HTTP requests, collections, and environments.          |
| [Git](git-workspace/) | Source control, diffs, branches, and forge operations. |
| [Kanban](kanban/)     | A passive task board per chat.                         |

## Games

| Mini app                                    | Product surface                                    |
| ------------------------------------------- | -------------------------------------------------- |
| [2048](game-2048/)                          | A board controlled by the user or agent in a chat. |
| [Battleship](battleship/)                   | Fleet placement, shots, and agent-opponent play.   |
| [Checkers](checkers/)                       | Legal moves and agent-opponent play.               |
| [Chess](chess/)                             | Legal moves and agent-opponent play.               |
| [Rock Paper Scissors](rock-paper-scissors/) | Sealed moves against the agent, checked by digest. |
| [Snake](snake/)                             | A per-chat board steered by the user or a model.   |
| [Tic-Tac-Toe](tic-tac-toe/)                 | A per-chat board and agent-opponent play.          |

[System Overview](template/) doubles as the workbench reference: retain its registration entry, host
adapter, and backend structure when copying, then replace its domain code. Its
[AGENTS.md](template/AGENTS.md) defines that boundary.

## Runtime model

Contributor references:

- [Database architecture](database/ARCHITECTURE.md) defines driver and workbench ownership.

A mini app's backend (`register(ctx)`) gives the agent tools over Localix's APIs and serves routes,
services, lifecycle hooks and channels. Its native workbench UI is built by the app into an
artifact; it may also contribute sandboxed HTML views, prompt sections, agent definitions, file
associations, settings, and commands with argument pickers. A guide too long for one read links
pages under `guide/`, which `mini_app_guide` reads by name.

## Trust boundary

Native mini app code runs in the Localix API process. A third-party mini app must be explicitly
enabled before it runs. Declarative content still receives validation, path containment, size
limits, and surface-specific restrictions.

Sandboxed HTML views use an opaque-origin iframe and acquire a host-injected, offline
`acquireLocalixApi()` client over the versioned mini app UI message bridge. Native React workbench
UI runs in the host page, so like native backend code it loads for a third-party mini app only after
the user enabled it. A view can call only its owning native backend's explicitly declared
`uiActions`; the host binds mini app, project, session, view, user, and cwd context and brokers the
JSON request without granting iframe network access.

Mini app permissions do not form an operating-system sandbox. Review a mini app's manifest and
source before enabling code you do not trust.

## Contributor workflow

A mini app a user asks for is not one of these: `/plugin create <name> …` in chat forks
[`template/`](template/) (shipped in the app's kit) into the user's folder, and the app builds,
tests and reloads it there. Nothing in this repository changes when a user creates one.

To add a first-party mini app, copy [`template/`](template/) by hand — its
[`scaffold.json`](template/scaffold.json) lists the frame to keep and the domain to replace. A
running `bun run dev` re-stages the mini app on every save (`scripts/dev-plugin-watch.mjs`), and the
workbench swaps its UI in place.

Use a focused check for the mini app being changed, from the repository root:

```bash
bun test mini-apps/kanban
bun run --cwd mini-apps/code-graph type-check
```

Build required workspace dependencies before raw package checks; see
[Contributing](../CONTRIBUTING.md). CI owns the complete test, type, and repository gates.

The [mini app SDK](../packages/mini-app-sdk/README.md) owns typed host contracts.

## Source of truth

- [Manifest contract](../packages/mini-app-sdk/src/manifest/app.ts)
- [Installed artifact trust](../apps/api/src/features/ext/trust.ts)
- [Developer watcher](../scripts/dev-plugin-watch.mjs)
- [Mini app SDK entry points](../packages/mini-app-sdk/README.md)
