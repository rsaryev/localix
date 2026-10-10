# Bundled plugins

This directory contains the first-party plugin source workspace for Localix. The build stages
bundled plugins and the application synchronizes managed copies into `~/.localix/plugins`; runtime
discovery reads the installed copy rather than this source tree.

For manifest fields, installation, trust rules, dependencies, hooks, UI bridges, and compatibility
details, use the [plugin authoring guide](../docs/extending/plugins.md).

## Workbenches

| Plugin                          | Product surface                                                  |
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

## Workflow and integration plugins

| Plugin                                | Product surface                                        |
| ------------------------------------- | ------------------------------------------------------ |
| [API Client](api/)                    | HTTP requests, collections, and environments.          |
| [Deliverables](deliverable/)          | Attach supported files named in final responses.       |
| [Git](git-workspace/)                 | Source control, diffs, branches, and forge operations. |
| [Kanban](kanban/)                     | A passive task board per chat.                         |
| [Code Review](review/)                | A registered reviewer and explicit review command.     |
| [Webhook Notifier](webhook-notifier/) | Lifecycle-event POSTs with optional HMAC signing.      |

## Games

| Plugin                      | Product surface                                    |
| --------------------------- | -------------------------------------------------- |
| [2048](game-2048/)          | A board controlled by the user or agent in a chat. |
| [Battleship](battleship/)   | Fleet placement, shots, and agent-opponent play.   |
| [Checkers](checkers/)       | Legal moves and agent-opponent play.               |
| [Chess](chess/)             | Legal moves and agent-opponent play.               |
| [Tic-Tac-Toe](tic-tac-toe/) | A per-chat board and agent-opponent play.          |

[System Overview](template/) doubles as the workbench reference: retain its registration entry, host
adapter, and backend structure when copying, then replace its domain code. Its
[AGENTS.md](template/AGENTS.md) defines that boundary.

## Runtime model

Contributor references:

- [Database architecture](database/ARCHITECTURE.md) defines driver and workbench ownership.

A plugin is a directory with a `plugin.json` manifest. Depending on that manifest, it can
contribute:

- native agent tools;
- skills and slash commands;
- MCP servers;
- lifecycle hooks;
- prompt sections and agent definitions;
- sandboxed HTML views;
- native workbench UI, built by the app into an artifact;
- chat channels.

Project-scoped plugins in `<project>/.localix/plugins/` override global plugins with the same name.
Bundled plugins are synchronized by the application; locally installed plugins remain user-owned.

## Trust boundary

Native plugin code runs in the Localix API process. A third-party plugin that contains native code
must be explicitly enabled before it runs. Declarative content still receives validation, path
containment, size limits, and surface-specific restrictions.

Sandboxed HTML views use an opaque-origin iframe and acquire a host-injected, offline
`acquireLocalixApi()` client over the versioned plugin UI message bridge. Native React workbench UI
runs in the host page, so like native backend code it loads for a third-party plugin only after the
user enabled it. A view can call only its owning native backend's explicitly declared `uiActions`;
the host binds plugin, project, session, view, user, and cwd context and brokers the JSON request
without granting iframe network access.

Plugin permissions do not form an operating-system sandbox. Review a plugin's manifest and source
before enabling code you do not trust.

## Install and manage

Copy a plugin directory into the global or project install root, or use the chat control command:

```text
/plugin install <owner/repo | git-url | local-path | name@marketplace>
```

Related operations include list, enable, disable, update, remove, details, validate, init, and
marketplace management. `/plugin reload` refreshes dropped-in folders without restarting the
application.

Marketplace and compatibility catalogs can use `.claude-plugin/marketplace.json`; that path is a
supported import contract, not the runtime install root. The authoring guide documents the exact
accepted manifest locations and token aliases.

## Dependencies

`plugin.json` may declare required plugins as names or `{ "name", "version" }` objects. Marketplace
installs resolve permitted dependencies transitively. Native-code dependencies are never silently
enabled for a third-party install.

Dependency version checks are advisory: mismatches produce warnings, not a hard install failure. Do
not assume that a declared dependency expands the parent's permissions.

## Contributor workflow

This directory holds the FIRST-PARTY plugins that ship with Localix. A plugin a user asks for is not
one of them: `/plugin create <name> …` in chat forks [`template/`](template/) (shipped in the app's
plugin kit) into the user's `~/.localix/plugins/<name>`, and the app builds, tests and reloads it
there. Nothing in this repository changes when a user creates a plugin.

To add a first-party workbench plugin, copy [`template/`](template/) by hand — its
[`scaffold.json`](template/scaffold.json) lists the frame to keep and the domain to replace. A
running `bun run dev` re-stages the plugin on every save (`scripts/dev-plugin-watch.mjs`), and the
workbench swaps its UI in place.

For anything smaller, copy the smallest bundled plugin whose shape matches what you are building —
[`deliverable/`](deliverable/) for a hook-only plugin, [`webhook-notifier/`](webhook-notifier/) for
one driven entirely by config. Keep the manifest and registration module small, split schemas from
tool bodies, and add deterministic tests for validation and permission classification.

Use a focused check for the plugin being changed, from the repository root:

```bash
bun test plugins/kanban
bun run --cwd plugins/code-graph type-check
```

Choose the matching plugin path and available package script. Hook-only plugins may have no package
script. Build required workspace dependencies before raw package checks; see
[Contributing](../CONTRIBUTING.md). CI owns the complete `test:dropins`, type, and repository gates.

The [plugin SDK](../packages/plugin-sdk/README.md) owns typed host contracts. The
[public authoring guide](../docs/extending/plugins.md) owns user-facing examples and should be
updated whenever plugin behavior changes.

## Source of truth

- [Manifest contract](../packages/plugin-sdk/src/manifest/index.ts)
- [Installed artifact trust](../apps/api/src/features/ext/trust.ts)
- [Dependency planning and advisory version checks](../apps/api/src/features/plugins/dependencies.ts)
- [Developer plugin watcher](../scripts/dev-plugin-watch.mjs)
- [Plugin SDK entry points](../packages/plugin-sdk/README.md)
