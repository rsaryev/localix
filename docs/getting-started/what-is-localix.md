# Understand Localix

Localix is an open source **ADE** (Agentic Development Environment): one workspace for you and a
team of agents. Several agents work in one conversation, in the editor, terminals, browser preview,
databases, and shared project board built into one app, with context you can see and rules for every
tool call. Bundled plugins, and the plugins an agent builds for you, extend the same context,
navigation, and capability system into additional domains without splitting them into a separate
product.

## What you can do

| Work                                 | Mechanism                                                                                                                    | Guide                                                                                       |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Connect the current context          | Link supported files, selections, diffs, sessions, terminals, tasks, and plugin resources while keeping the send set visible | [Workspace](../features/workspace.md)                                                       |
| Choose a model for each kind of work | Route supported providers, models, and reasoning preferences to sessions and auxiliary workloads                             | [Providers and models](../features/providers.md)                                            |
| Edit, run, and inspect a project     | Open files, run PTY terminals, inspect diffs, and keep previews beside the session                                           | [Workspace](../features/workspace.md)                                                       |
| Work with one agent                  | Bind a project, provider connection, model, and agent to one stored session                                                  | [Your first session](first-session.md)                                                      |
| Coordinate a larger goal             | Track a chat's tasks on the Kanban plugin's board and explicitly delegate a brief with `agents` `delegate`                   | [Kanban board](../features/task-board.md)                                                   |
| Point at a UI defect                 | Capture source-mapped element context from a probed Localix preview into the session                                         | [Visual Feedback](../features/visual-feedback.md)                                           |
| Inspect infrastructure and data      | Inspect containers, Kubernetes resources, and saved database connections directly through bundled workbenches                | [DevOps Workspace](../features/devops.md) and [Database workbench](../features/database.md) |
| Produce documents                    | Extract supported files, open read-only viewers, and generate DOCX, XLSX, or PDF from the workspace                          | [Documents](../features/documents.md)                                                       |

### Terms used in this guide

| Term                                | Meaning                                                                                                         |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **Agentic Development Environment** | The Localix category: connected development surfaces, context, model routes, agents, and extensible workbenches |
| **Session**                         | A stored transcript and its project, provider/model selection, agent, and runtime state                         |
| **Sub-agent**                       | A child session started explicitly by an agent through the `agents` `delegate` action                           |
| **Workbench**                       | A plugin-contributed product surface and its matching domain capabilities                                       |

## How it works

The desktop shell starts a local API process. The workspace renders session-scoped chat, files,
terminals, source control, diffs, previews, tasks, and contributed workbench views against that
runtime.

A direct run uses the session's selected provider connection and model. Auxiliary routes can select
different models for session titles, inline completion, and explicit sub-agent work. The runtime
builds its tool surface from the session's agent and its capability rules, enabled plugins, skills,
and other configured extensions.

The bundled Kanban plugin keeps one board per chat with its tasks, dependencies, and results. It
never starts work. An agent explicitly takes a task and may explicitly call the `agents` `delegate`
action with a self-contained brief when a child session is useful.

Bundled plugins register domain tools and workspace contributions. Their active state is resolved
for the current project, so disabling a plugin removes its gated tools and views together.

## Configuration

| Decision                      | Effect                                                                      | Owning guide                                                  |
| ----------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Project                       | Sets the session's base workspace root                                      | [Sessions and projects](../features/sessions-and-projects.md) |
| Provider connection and model | Selects the runtime route used by a direct session                          | [Providers and models](../features/providers.md)              |
| Capability rules              | Decide which tools a scope may use and when it must ask first               | [Capabilities](../features/capabilities.md)                   |
| Plugins                       | Adds or removes project-scoped tools, commands, skills, and workbench views | [Plugins](../extending/plugins.md)                            |
| A card's agent                | Records which agent explicitly took responsibility for the task             | [Kanban](../features/task-board.md)                           |

## Limits

- Localix is in beta. Expect rough edges, and breaking changes between releases until 1.0.
- Sessions currently execute on the local machine. SSH and Docker execution adapters exist in
  source, but no product control selects them for a session.
- Localix does not supply a hosted model or provider credential. A direct run stops when its
  provider connection or session model is missing.
- A Kanban card does not create a workspace or execution context. Any explicit sub-agent uses the
  owning session hierarchy and workspace.
- Nothing checks a completed Kanban task automatically. The acting agent records the result with
  `complete`; delegate an explicit verification brief when a change needs an independent look.
- Visual Feedback requires a Localix preview with its probe connected. It does not inspect an
  arbitrary browser tab or desktop window.
- The Kanban, database, DevOps, and documents plugins are bundled and default-enabled. The
  penetration testing plugin defaults off and must be used only for authorized, in-scope work.
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
- [Plugin activation](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/plugins/enable.ts)
- [Visual Feedback capture](https://github.com/rsaryev/localix/blob/main/packages/visual-feedback/src/probe/capture.ts)
