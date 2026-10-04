# Bundled plugins

This directory contains the first-party plugin source workspace for Localix. The build stages
bundled plugins and the application synchronizes managed copies into `~/.localix/plugins`; runtime
discovery reads the installed copy rather than this source tree.

For manifest fields, installation, trust rules, dependencies, hooks, UI bridges, and compatibility
details, use the [plugin authoring guide](../docs/extending/plugins.md).

## Product plugins

| Plugin                                 | Product surface                                                 |
| -------------------------------------- | --------------------------------------------------------------- |
| [`code-graph/`](code-graph/)           | Navigable map of the project's code with graph query tools.     |
| [`database/`](database/)               | SQL and data-source workbench with schema and query tools.      |
| [`devops/`](devops/)                   | Docker and Kubernetes inspection workbench.                     |
| [`documents/`](documents/)             | Document readers, writers, viewers, tables, and charts.         |
| [`external-agents/`](external-agents/) | Supported external CLI launches and bounded history inspection. |
| [`game-2048/`](game-2048/)             | 2048 board controlled by the user or agent in a chat.           |
| [`learning/`](learning/)               | Course creation, lessons, resources, and durable progress.      |
| [`template/`](template/)               | System Overview: OS, CPU, memory and process inspection.        |
| [`trading/`](trading/)                 | Public market data workspace; no order placement.               |

## Workflow and integration plugins

| Plugin                                   | Product surface                                           |
| ---------------------------------------- | --------------------------------------------------------- |
| [`api/`](api/)                           | HTTP request collections and API workbench.               |
| [`deliverable/`](deliverable/)           | Turns final-response file paths into message attachments. |
| [`kanban/`](kanban/)                     | A passive task board per chat, kept by you and the agent. |
| [`review/`](review/)                     | Review command and inline review suggestions.             |
| [`webhook-notifier/`](webhook-notifier/) | Signed lifecycle-event webhooks.                          |

[`template/`](template/) doubles as the reference for a workbench plugin: a shipped product (System
Overview) whose registration entry, host adapter and backend shape are the parts to keep when
copying, and whose domain code is the part to replace. Its `AGENTS.md` names the boundary.

## Runtime model

A plugin is a directory with a `plugin.json` manifest. Depending on that manifest, it can
contribute:

- native agent tools;
- skills and slash commands;
- MCP servers;
- lifecycle hooks;
- prompt sections and worker roles;
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

Treat version ranges as compatibility guidance unless the current installer reports a hard
constraint. Do not assume that a declared dependency expands the parent's permissions.

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

From the repository root, run:

```bash
bun run test:dropins
bun run type-check
bun run check:tests
bun run check:public
```

The [plugin SDK](../packages/plugin-sdk/README.md) owns typed host contracts. The
[public authoring guide](../docs/extending/plugins.md) owns user-facing examples and should be
updated whenever plugin behavior changes.
