# Localix documentation

Localix brings agent conversations, source files, terminals, previews, and workbenches into one
workspace. Start with setup and a first session, follow a recipe for a concrete task, or use the
reference below to find a feature's controls and limits.

## Start here

1. [Understand Localix](getting-started/what-is-localix.md) — workspace concepts and supported
   workflows.
2. [Run Localix](getting-started/installation.md) — desktop prerequisites, browser development, and
   local builds.
3. [Start your first session](getting-started/first-session.md) — connect a provider, open a
   project, and make a change.

Read [Privacy](getting-started/privacy.md) to understand data storage and outbound requests. Use
[Troubleshooting](getting-started/troubleshooting.md) when setup or a run fails.

## Find a task

| I want to…                           | Read                                                                                                                       |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| Work with several agents             | [Conversations](features/conversations.md) · [Delegation](features/delegation.md)                                          |
| Control what enters the next request | [Workspace context](features/workspace.md#explicit-and-automatic-context) · [Checkpoints](features/context-checkpoints.md) |
| Review actions before they run       | [Permission modes](features/permission-modes.md) · [Permission rules](features/permissions.md)                             |
| Choose a provider or model           | [Providers](features/providers.md) · [Onboarding](features/onboarding.md)                                                  |
| Track a larger goal                  | [Kanban](features/task-board.md) · [Session tasks recipe](recipes/turn-a-vague-goal-into-a-pipeline.md)                    |
| Wait for CI or repeat a prompt       | [Monitors](features/monitors.md) · [Loops](features/loops.md)                                                              |
| Add a tool or workbench              | [Build with the agent](extending/build-with-the-agent.md) · [Plugin authoring](extending/plugins.md)                       |
| Change Localix itself                | [Contributing](internals/contributing.md) · [Code map](internals/code-map.md)                                              |

## Recipes

Each recipe walks through one task from setup to a visible result.

| Recipe                                                                               | Result                                                           |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| [Fix a UI bug by pointing at it](recipes/fix-a-ui-bug-by-pointing-at-it.md)          | Attach element context from the preview to a message.            |
| [Turn a vague goal into session tasks](recipes/turn-a-vague-goal-into-a-pipeline.md) | Break down work on a passive board and delegate explicit briefs. |
| [Bring your own agent CLI](recipes/bring-your-own-agent-cli.md)                      | Run a supported external coding agent in Localix.                |
| [Drive an interactive program](recipes/drive-interactive-terminal.md)                | Send PTY input and wait for rendered terminal output.            |

## Feature reference

### Core

| Guide                                                                         | Covers                                                                 |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| [Decide what an agent may do](features/capabilities.md)                       | Choose the tools, skills, plugins, and MCP access an agent holds.      |
| [Agent presets](features/agents.md)                                           | Edit shipped roles, instructions, context, and turn limits.            |
| [Delegation](features/delegation.md)                                          | Start child sessions with explicit briefs and receive their reports.   |
| [Choose how much the agent asks](features/permission-modes.md)                | Choose Default, Plan, Bypass, or Autonomous for a conversation.        |
| [Permission rules](features/permissions.md)                                   | Write ordered allow, ask, and deny rules.                              |
| [Let the agent propose configuration changes](features/configure.md)          | Review an agent’s proposal to enable a missing capability.             |
| [Organize work with projects and sessions](features/sessions-and-projects.md) | Organize projects, sessions, branches, drafts, and attachments.        |
| [Conversations with several agents](features/conversations.md)                | Address participants with their own roles and models in one chat.      |
| [Read conversation activity](features/conversation-history.md)                | Inspect messages, tool activity, and navigation through a transcript.  |
| [Give the agent files and images](features/attachments.md)                    | Attach uploads or original paths and understand model-facing previews. |
| [Answer formatting](features/answer-formatting.md)                            | Use supported Markdown, structured content, links, and deliverables.   |
| [Respond to human-in-the-loop requests](features/hitl.md)                     | Answer questions, quizzes, and confirmation requests.                  |
| [Background work](features/background-work.md)                                | Follow delegated runs, jobs, and unattended work.                      |
| [Let an agent interact with a terminal](features/interactive-terminals.md)    | Let an agent send input to a terminal and inspect its screen.          |
| [Wait for something to happen](features/monitors.md)                          | Wait for a command or plugin event to wake a session.                  |
| [Repeat work on a schedule](features/loops.md)                                | Repeat prompts while the Localix runtime is running.                   |
| [Set up a provider and model](features/onboarding.md)                         | Connect a provider and select the default chat model.                  |

### Workspace

| Guide                                                             | Covers                                                             |
| ----------------------------------------------------------------- | ------------------------------------------------------------------ |
| [Use the workspace](features/workspace.md)                        | Arrange panels and inspect explicit and automatic message context. |
| [Native workspace tabs](features/native-workspace-tabs.md)        | Manage native windows, tabs, and workspace restoration.            |
| [External agent sessions](features/external-agents.md)            | Link supported external coding-agent sessions.                     |
| [Settings](features/settings.md)                                  | Find application, project, provider, and capability settings.      |
| [Keyboard shortcuts](features/keyboard-shortcuts.md)              | Find keyboard actions and their focus boundaries.                  |
| [Use Source Control](features/source-control.md)                  | Inspect diffs, stage changes, commit, and manage branches.         |
| [Annotate a live preview](features/visual-feedback.md)            | Attach source-mapped element feedback from a live preview.         |
| [Use language server features](features/lsp.md)                   | Use diagnostics and language-server features.                      |
| [Track model usage and estimated cost](features/cost-tracking.md) | Inspect model usage and estimated request cost.                    |
| [Manage notifications](features/notifications.md)                 | Configure notifications and review recorded events.                |
| [Use Localix from the command line](features/cli.md)              | Open a project or file through the desktop shell launcher.         |

### Workbenches

| Guide                                                 | Covers                                                                  |
| ----------------------------------------------------- | ----------------------------------------------------------------------- |
| [Use Database Workspace](features/database.md)        | Query supported databases and inspect schemas and connection limits.    |
| [Code Graph](features/code-graph.md)                  | Explore code relationships in the graph workbench.                      |
| [Project Space](features/project-space.md)            | Arrange shared notes and live file cards on a canvas.                   |
| [Use the API workbench](features/api.md)              | Save and send HTTP requests, inspect responses, and import collections. |
| [Use DevOps Workspace](features/devops.md)            | Inspect containers and Kubernetes through the shared DevOps surface.    |
| [Containers](features/docker.md)                      | Browse Docker resources, logs, terminals, and Compose projects.         |
| [Operate Kubernetes clusters](features/kubernetes.md) | Inspect workloads, manifests, logs, and port forwards.                  |
| [Documents](features/documents.md)                    | Extract supported files, use viewers, and generate documents.           |
| [Resumes](features/resumes.md)                        | Edit a resume and preview or export its document.                       |
| [Reader Workspace](features/reader.md)                | Read supported book and document formats with annotations.              |
| [Research public markets](features/trading.md)        | Inspect public market data through read-only tools.                     |
| [Kanban board](features/task-board.md)                | Track tasks, owners, epics, and dependencies on a chat’s board.         |
| [2048](features/game-2048.md)                         | Play 2048 with the bundled workbench.                                   |
| [Games with your agent](features/games.md)            | Play the bundled board games with an agent.                             |

### Models & context

| Guide                                                                            | Covers                                                     |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| [Connect model providers](features/providers.md)                                 | Connect providers and route models to different workloads. |
| [Keep a long session inside the request budget](features/context-checkpoints.md) | Keep long sessions within the request budget.              |
| [Know the tool roster](features/tools.md)                                        | Inspect live, deferred, and withheld tools.                |
| [Manage the tool budget](features/tool-budget.md)                                | Understand schema estimates and the backend usage report.  |

### Memory & skills

| Guide                                                      | Covers                                                    |
| ---------------------------------------------------------- | --------------------------------------------------------- |
| [Carry context into later work](features/learning-loop.md) | Use memory, recall, courses, and saved learning progress. |
| [Reuse procedures with skills](features/skills.md)         | Load, pin, and reuse procedures.                          |

### Integrations

| Guide                                                          | Covers                                                         |
| -------------------------------------------------------------- | -------------------------------------------------------------- |
| [Connect MCP servers](features/mcp.md)                         | Connect external tool servers and inspect their availability.  |
| [Use hooks and slash commands](features/hooks-and-commands.md) | Use lifecycle hooks and slash commands.                        |
| [Execution environments](features/execution-environments.md)   | Understand local execution and the remote-adapter limitations. |
| [Manage credentials with Vault](features/secrets.md)           | Store vault credentials and use secret interpolation.          |
| [Send messages into a session](features/webhook.md)            | Push an external message into a session.                       |

## Extending Localix

| Guide                                                              | Covers                                                             |
| ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| [Build a plugin](extending/plugins.md)                             | Author a plugin manifest, tools, commands, and contributions.      |
| [Build a plugin with the agent](extending/build-with-the-agent.md) | Describe a plugin and review the agent’s build result.             |
| [Build workbench UI](extending/plugin-ui.md)                       | Build a workbench interface against the host bridge.               |
| [Build a sandboxed HTML view](extending/sandboxed-views.md)        | Use the iframe bridge, scoped backend actions, and scratch state.  |
| [Plugin synchronization](extending/plugin-sync.md)                 | Synchronize plugin resources and live views.                       |
| [Keyboard ownership](extending/keyboard-ownership.md)              | Keep plugin shortcuts within their focus and ownership boundaries. |
| [Report plugin failures](extending/plugin-problems.md)             | Report plugin failures through the host’s problem surfaces.        |
| [The UI kit](extending/ui-kit.md)                                  | Use shared components, tokens, and supported import paths.         |
| [Wake a session from a plugin](extending/plugin-wakes.md)          | Wake a session from a plugin event.                                |
| [Validate plugin route requests](extending/plugin-routes.md)       | Validate plugin HTTP request contracts.                            |
| [Author a skill](extending/skills-authoring.md)                    | Write SKILL.md procedures and supporting resources.                |
| [Shared Markdown](extending/markdown.md)                           | Use the shared Markdown renderer and interactive components.       |

## Contributor references

The public contributor guides cover setup and architecture. Repository-only notes provide source
ownership and contracts for work on a particular subsystem.

| Guide                                             | Covers                                                           |
| ------------------------------------------------- | ---------------------------------------------------------------- |
| [Architecture](internals/architecture.md)         | Understand package boundaries and runtime composition.           |
| [Environment variables](internals/environment.md) | Find environment variables, defaults, and development overrides. |
| [Contributing](internals/contributing.md)         | Set up a checkout and choose focused verification.               |

- [Code map](internals/code-map.md) — locate the owning module before editing.
- [Subsystem notes](internals/subsystems/README.md) — context, workbenches, search, and integration
  boundaries.
- [Agent runtime](internals/agent-runtime.md) · [SDK](internals/sdk.md) — runtime and programmatic
  entry points.
- [Desktop lifecycle](internals/desktop-runtime-lifecycle.md) ·
  [Native browser](internals/desktop-browser.md) — shutdown, recovery, and browser integration.
- [Desktop packaging](internals/desktop-as-primary-artifact.md) — native shell, staging, launcher,
  and updates.
- [Workspace scope](internals/single-scope-sidebar.md) ·
  [Client/server sync](internals/client-server-sync.md) — routed state and restoration.
- [UI virtualization](internals/ui-virtualization.md) ·
  [Question interaction](internals/question-interaction.md) — rendering and queued questions.
- [Visual system](internals/visual-system.md) — repository UI components and tokens.
- [Documentation standards](internals/doc-standards.md) — page structure, evidence, links, and
  captures.

The [public navigation](public-nav.json) defines the pages published on the documentation site. This
index also links repository-only references; those are read in the checkout or on GitHub.
