# Localix documentation

Localix is an open source **ADE** (Agentic Development Environment): one workspace for you and a
team of agents. Several agents work in one conversation, in the editor, terminals, browser preview,
databases, and shared project board built into one app, with context you can see and rules for every
tool call.

Work directly in a visible surface, bring that surface into agent context, add agents to the
conversation, route a model for the job, let an agent drive the preview or build a plugin, or
coordinate larger work through explicit delegation and a passive task board.

## Start here

If you are new, read these in order:

1. **[What is Localix?](getting-started/what-is-localix.md)** — the pitch, and what it deliberately
   is not.
2. **[Run Localix from source](getting-started/installation.md)** — requirements and desktop
   commands.
3. **[Your first session](getting-started/first-session.md)** — connect a provider, open a project,
   and watch one change land.
4. **[Kanban board](features/task-board.md)** — keep multi-part work of one chat on a passive board.

## Recipes

Task-shaped walkthroughs, each one end to end:

| Recipe                                                                            | What you get                                             |
| --------------------------------------------------------------------------------- | -------------------------------------------------------- |
| [Fix a UI bug by pointing at it](recipes/fix-a-ui-bug-by-pointing-at-it.md)       | Click the broken element; the agent gets the source line |
| [Turn a vague goal into a pipeline](recipes/turn-a-vague-goal-into-a-pipeline.md) | A chat's board of tasks, ordered, taken or delegated     |
| [Bring your own agent CLI](recipes/bring-your-own-agent-cli.md)                   | A supported coding-agent CLI inside the environment      |

Then pick by what you are trying to do:

| I want to…                                    | Read                                                                                                                       |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Understand the workspace I am looking at      | [Workspace tour](features/workspace.md)                                                                                    |
| See and control what enters agent context     | [Workspace context](features/workspace.md#explicit-and-automatic-context) · [Checkpoints](features/context-checkpoints.md) |
| Control how much the agent is allowed to do   | [Capabilities](features/capabilities.md) · [Permissions](features/permissions.md)                                          |
| Point at a UI bug instead of describing it    | [Visual Feedback](features/visual-feedback.md)                                                                             |
| Choose providers, models, and workload routes | [Providers](features/providers.md) · [Secrets](features/secrets.md)                                                        |
| Keep a long piece of work on track            | [Kanban](features/task-board.md) · [Context checkpoints](features/context-checkpoints.md)                                  |
| Wait for CI, a deploy, or a service           | [Monitors](features/monitors.md)                                                                                           |
| Add my own tools, skills, or panels           | [Plugins](extending/plugins.md) · [Skills authoring](extending/skills-authoring.md)                                        |
| Work from a terminal                          | [CLI](features/cli.md)                                                                                                     |
| Fix something that is not working             | [Troubleshooting](getting-started/troubleshooting.md)                                                                      |

## Getting started

| Page                                                   | What's covered                                                                            |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| [What is Localix?](getting-started/what-is-localix.md) | The category, what it is good for, what it is not, and who it is for                      |
| [Installation](getting-started/installation.md)        | Source checkout, desktop development, local bundles, and requirements per platform        |
| [Your first session](getting-started/first-session.md) | A change end to end, the slash-command table, steering a run in progress                  |
| [Privacy](getting-started/privacy.md)                  | What leaves your machine, what your provider sees, where data lives, and how to verify it |
| [Troubleshooting](getting-started/troubleshooting.md)  | Startup, providers, permissions, workbenches, diagnostics, and useful bug reports         |

## Features

| Page                                                         | What's covered                                                                                                                                                                                                |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Workspace tour](features/workspace.md)                      | The editor grid (code editor, preview, diffs, terminal, files), the navigation rail, global search, streaming UI, tool rendering, the composer                                                                |
| **[Visual Feedback](features/visual-feedback.md)**           | Click an element in the live preview and send its source `file:line`, selector, computed styles, and screenshot to the agent; frame-size presets for breakpoints; the `browser` tool the agent drives it with |
| [Capabilities](features/capabilities.md)                     | What an agent may do: one rule list per agent, with no agent modes                                                                                                                                            |
| [Sessions & projects](features/sessions-and-projects.md)     | Project sidebar, forking & branch navigation, rollback, message queue, attachments                                                                                                                            |
| [Delegation](features/delegation.md)                         | Explicit sub-agents from a self-contained brief, a report for every run, follow-up messages, and the runtime panel                                                                                            |
| [Monitors](features/monitors.md)                             | Background waits that wake the session on an event: `bash` with `until` polls a check until it exits 0; the composer strip and the engine behind plugin monitors                                              |
| [HITL](features/hitl.md)                                     | Ask / quiz / confirm — how the agent (and external CLI runs) pause for your input                                                                                                                             |
| [Database workbench](features/database.md)                   | SQL console + schema browser over sqlite / postgres / mysql / mssql, plus Redis, MongoDB & Elasticsearch; read-only connections, SSH tunnels, the one `database_client` agent tool                            |
| [API workbench](features/api.md)                             | Saved HTTP requests, bounded response inspection, supported collection imports, vault-backed secret references, and reviewable repository exports                                                             |
| [DevOps Workspace](features/devops.md)                       | Containers and Kubernetes: health, resource browsers, logs, exec, manifests, port forwarding, and confirmed operational mutations                                                                             |
| [Containers](features/docker.md)                             | Docker inventory, resource details, logs, exec, stats, Compose projects, and agent links                                                                                                                      |
| [Kubernetes](features/kubernetes.md)                         | Contexts and namespaces, workloads, live pod state, manifests, events, logs, exec, and port forwarding                                                                                                        |
| [Trading workbench](features/trading.md)                     | Live public market data — candles, order book, tape, indicators; the read-only `market_data` tool                                                                                                             |
| [Documents](features/documents.md)                           | Office/PDF extraction, read-only viewers, spreadsheet data views, and document generation routes                                                                                                              |
| [Reader Workspace](features/reader.md)                       | Focused EPUB/PDF/MOBI/AZW3/FB2/CBZ/Markdown/HTML/text reading with annotations, global search, and live agent context                                                                                         |
| [Kanban board](features/task-board.md)                       | The bundled Kanban plugin: one passive board per chat with tasks, epics, dependencies and the `kanban` tool                                                                                                   |
| [Secrets](features/secrets.md)                               | The write-only vault and `${secret:KEY}` interpolation                                                                                                                                                        |
| [Webhook](features/webhook.md)                               | Let an external system (or a delegated CLI agent) push a message into a session                                                                                                                               |
| [Providers](features/providers.md)                           | Provider-neutral runtime boundary, connection catalog, OAuth, encrypted credentials, and connection resolution                                                                                                |
| [Learning Studio](features/learning-loop.md)                 | Memory and recall plus importable courses, lessons, quizzes, practice, and durable progress                                                                                                                   |
| [Onboarding](features/onboarding.md)                         | The guided `/setup` first run — provider, default chat model, and a structural readiness summary                                                                                                              |
| [Skills](features/skills.md)                                 | Reusable procedures — running, pinning, autonomous saving                                                                                                                                                     |
| [MCP servers](features/mcp.md)                               | Connecting external tool servers, persistent connections, MCP via plugins                                                                                                                                     |
| [CLI](features/cli.md)                                       | The `localix` command — `localix .` / `localix <path>` open in the running app; installs into PATH from the desktop app                                                                                       |
| [LSP](features/lsp.md)                                       | Language-server diagnostics in the loop                                                                                                                                                                       |
| [Context checkpoints](features/context-checkpoints.md)       | How long sessions stay inside the model window without a model call                                                                                                                                           |
| [Tool roster](features/tools.md)                             | Which tools ride on every request, which are deferred behind `activate_tools`, and where the folded-away tools went                                                                                           |
| [Cost tracking](features/cost-tracking.md)                   | Context ring, per-response cost, and the usage & spend dashboard                                                                                                                                              |
| [Execution environments](features/execution-environments.md) | Local execution plus the SSH/Docker adapter groundwork and current selector limitation                                                                                                                        |

## Extending

| Page                                              | What's covered                                                                     |
| ------------------------------------------------- | ---------------------------------------------------------------------------------- |
| [Plugins](extending/plugins.md)                   | Full authoring guide: manifest, native tools, MCP, commands, sub-agents, migration |
| [Skills authoring](extending/skills-authoring.md) | The `SKILL.md` format, resolution rules, tool & REST surfaces                      |

## Internals

| Page                                                                     | What's covered                                                       |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| [Architecture](internals/architecture.md)                                | Monorepo layout, agent loop, runtime pipeline                        |
| [Environment variables](internals/environment.md)                        | Every env var, and what deliberately isn't one                       |
| [SDK](internals/sdk.md)                                                  | Building on `@localixai/agent` directly                              |
| [Desktop package and launcher](internals/desktop-as-primary-artifact.md) | Native packaging, sidecar startup, deep links, and the shell command |
| [Workspace scope and sidebar](internals/single-scope-sidebar.md)         | Routed scope, session selection, and workspace restoration           |
| [UI virtualization](internals/ui-virtualization.md)                      | Bounded rendering, follow behavior, and logical navigation           |
| [Question interaction](internals/question-interaction.md)                | The accepted pattern for queued and waiting agent questions          |
| [Contributing](internals/contributing.md)                                | Development setup and conventions                                    |

**[Subsystem notes](internals/subsystems/README.md)** cover context refs, source control,
workbenches, documents, global search, and other architectural boundaries. Read the matching note
before changing that subsystem.
