# Understand Localix

Localix is an open source **ADE** (Agentic Development Environment): a workspace where you and
agents share conversations, an editor, terminals, previews, databases, and a project board. Assign
participants their own roles and models, attach visible context, and control agent tool access
through capability rules. Bundled and custom plugins add workbenches and tools to the same app.

![Claude Code open in a real terminal beside a Localix demo chat](../assets/screenshots/external-agents/history--2026-10-08.png)

_Demo workspace captured on 8 October 2026. The conversation is seeded._

## What you can do

| Work                                 | Mechanism                                                                                                                    | Guide                                                                                       |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Connect the current context          | Link supported files, selections, diffs, sessions, terminals, tasks, and plugin resources while keeping the send set visible | [Workspace](../features/workspace.md)                                                       |
| Choose a model for each kind of work | Route supported providers, models, and reasoning preferences to sessions and auxiliary workloads                             | [Providers and models](../features/providers.md)                                            |
| Edit, run, and inspect a project     | Open files, run PTY terminals, inspect diffs, and keep previews beside the session                                           | [Workspace](../features/workspace.md)                                                       |
| Work with one agent                  | Bind a project, provider connection, model, and agent to one stored session                                                  | [Your first session](first-session.md)                                                      |
| Coordinate a larger goal             | Track tasks on a chat's Kanban board; let an agent delegate parallel side work from a root chat                              | [Kanban board](../features/task-board.md)                                                   |
| Point at a UI defect                 | Attach rendered element context and available source locations from a supported Localix preview                              | [Visual Feedback](../features/visual-feedback.md)                                           |
| Inspect infrastructure and data      | Inspect containers, Kubernetes resources, and saved database connections directly through bundled workbenches                | [DevOps Workspace](../features/devops.md) and [Database workbench](../features/database.md) |
| Produce documents                    | Extract supported files, open read-only viewers, and generate DOCX, XLSX, or PDF from the workspace                          | [Documents](../features/documents.md)                                                       |

### Terms used in this guide

| Term                                | Meaning                                                                                                         |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **Agentic Development Environment** | The Localix category: connected development surfaces, context, model routes, agents, and extensible workbenches |
| **Session**                         | A stored transcript with project, model selections, participants, and runtime state                             |
| **Delegated task**                  | A child session that runs one task for an agent, started explicitly with the `delegate` tool                    |
| **Workbench**                       | A plugin-contributed product surface and its matching domain capabilities                                       |

## How it works

The desktop shell starts a local API process. The workspace renders session-scoped chat, files,
terminals, source control, diffs, previews, tasks, and contributed workbench views against that
runtime.

A direct run uses the session's selected provider connection and model. Auxiliary routes can select
different models for session titles, inline completion, and child-session work. The runtime builds
each turn's tool surface from the answering agent's capability rules, enabled plugins, skills, and
other configured extensions.

The bundled Kanban plugin keeps one board per chat with its tasks, dependencies, and results. It
never starts work. An agent explicitly takes a task and may explicitly `delegate` it when a child
session is useful.

Plugin discovery follows the current project. The shared UI catalog uses the default assistant's
plugin policy; each agent run uses its own policy. Opening a plugin view does not give every agent
permission to call its tools.

## Configuration

| Decision                      | Effect                                                                      | Owning guide                                                  |
| ----------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Project                       | Sets the session's base workspace root                                      | [Sessions and projects](../features/sessions-and-projects.md) |
| Provider connection and model | Selects the runtime route used by a direct session                          | [Providers and models](../features/providers.md)              |
| Capability rules              | Decide which tools an agent may use and when it must ask first              | [Capabilities](../features/capabilities.md)                   |
| Plugins                       | Adds or removes project-scoped tools, commands, skills, and workbench views | [Plugins](../extending/plugins.md)                            |
| A card's agent                | Records which agent explicitly took responsibility for the task             | [Kanban](../features/task-board.md)                           |

## Limits

- Localix is in beta. Expect rough edges, and breaking changes between releases until 1.0.
- Sessions currently execute on the local machine. SSH and Docker execution adapters exist in
  source, but no product control selects them for a session.
- Localix does not supply a hosted model or provider credential. A direct run stops when its
  provider connection or session model is missing.
- A Kanban card does not create a workspace or execution context. Any explicit delegation uses the
  owning session hierarchy and workspace.
- Nothing checks a completed Kanban task automatically. The acting agent records the result with
  `complete`; invite QA into the conversation when a change needs an independent look.
- Visual Feedback requires a supported Localix preview with a connected or injectable probe. Source
  locations depend on available mapping; arbitrary browser tabs and desktop windows are not capture
  targets.
- Kanban, database, DevOps, and documents are bundled and default-enabled. Agent tool availability
  still follows role, host, model, and capability restrictions; see
  [Capabilities](../features/capabilities.md).
- Document extraction and generation support different format sets. Input-size and parser limits
  also apply.
- Checked package manifests currently declare no first-party analytics or crash-reporting SDK.
  Providers, plugins, MCP servers, fetched URLs, and update checks can still make outbound requests;
  see [Privacy](privacy.md).

## Related guides

- [Install or run Localix](installation.md)
- [Your first session](first-session.md)
- [Capabilities](../features/capabilities.md)
- [Troubleshooting](troubleshooting.md)

## Source of truth

- [Desktop API process](https://github.com/rsaryev/localix/blob/main/apps/desktop-tauri/src-tauri/src/sidecar.rs)
- [Session creation and local execution](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/service/session-lifecycle.ts)
- [Direct-run model requirements](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/runtime/run/stages/turn.ts)
- [Workspace pane registry](https://github.com/rsaryev/localix/blob/main/apps/ui/src/widgets/editor-grid/ui/registry.tsx)
- [Agent-owned permission policy](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/agent-core/permission-engine.ts)
- [Passive Kanban board](https://github.com/rsaryev/localix/blob/main/plugins/kanban/backend/operations.ts)
- [Kanban agent tool](https://github.com/rsaryev/localix/blob/main/plugins/kanban/backend/tools.ts)
- [Plugin trust classification](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/plugins/enable.ts)
- [UI and agent plugin policy](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/plugins/service.ts)
- [Visual Feedback capture](https://github.com/rsaryev/localix/blob/main/packages/visual-feedback/src/probe/capture.ts)
