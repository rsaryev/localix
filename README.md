<p align="center">
  <img src="assets/logo.svg" width="72" height="72" alt="Localix">
</p>

<h1 align="center">Localix</h1>

<p align="center">
  <strong>One workspace for you and a team of agents.</strong><br>
  An open source workspace where you and your agents share the editor, terminals, preview, and databases.
</p>

<p align="center">
  <a href="https://github.com/rsaryev/localix/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/rsaryev/localix/ci.yml?branch=main&label=CI"></a>
  <a href="https://github.com/rsaryev/localix/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/rsaryev/localix?include_prereleases&label=release"></a>
  <img alt="Tested on macOS; Linux experimental" src="https://img.shields.io/badge/tested-macOS-informational">
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-informational"></a>
  <img alt="Status: beta" src="https://img.shields.io/badge/status-beta-lightgrey">
</p>

<p align="center">
  <a href="https://github.com/rsaryev/localix/releases/latest"><strong>Download</strong></a> ·
  <a href="https://localix.ai">Website</a> ·
  <a href="docs/README.md">Documentation</a> ·
  <a href="#quick-start">Run from source</a> ·
  <a href="CONTRIBUTING.md">Contributing</a>
</p>

<p align="center">
  <img src="docs/assets/films/team.gif" alt="A team of agents building a project in one Localix workspace" width="880">
</p>

## Download

Get an installer from the [latest release](https://github.com/rsaryev/localix/releases/latest).

| Platform             | File                      | Status                          |
| -------------------- | ------------------------- | ------------------------------- |
| macOS, Apple silicon | `Localix-macos-arm64.dmg` | Tested; signed and notarized    |
| macOS, Intel         | None yet                  | [Run from source](#quick-start) |
| Linux                | None yet                  | [Run from source](#quick-start) |
| Windows              | None yet                  | [Run from source](#quick-start) |

Localix ships and has been tested only on macOS on Apple silicon. On other systems, run it from
source; installers for them will follow. Each release lists checksums in `SHA256SUMS.txt`.

## What you can do

| Capability                                               | In the workspace                                                                                      |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| [Agent teams](docs/features/conversations.md)            | Give participants their own roles and models; address them with `@handle` in one shared conversation. |
| [Connected context](docs/features/workspace.md)          | Link files, diffs, terminals, and live resources to a message.                                        |
| [Project Space](docs/features/project-space.md)          | Arrange notes and live file cards on a board you and the agents edit together.                        |
| [Preview and feedback](docs/features/visual-feedback.md) | Let an agent use your running app, or point at an element and attach feedback.                        |
| [Kanban](docs/features/task-board.md)                    | Track tasks, owners, and dependencies on each conversation's board.                                   |
| [Model routing](docs/features/providers.md)              | Choose models separately for conversations, delegated agents, and inline completion.                  |
| [Custom plugins](docs/extending/build-with-the-agent.md) | Describe a tool; an agent builds its interface and tools with Localix's UI kit.                       |

Included workbenches cover [databases](docs/features/database.md),
[API requests](docs/features/api.md), [DevOps](docs/features/devops.md), and
[documents](docs/features/documents.md). You can also link
[external coding-agent sessions](docs/features/external-agents.md) and run
[scheduled prompts](docs/features/loops.md) while Localix is open.

<details>
<summary>See the workspace</summary>

### Agent conversation

![Three participants in a seeded release-review conversation](docs/assets/screenshots/conversations/participants--2026-10-09.png)

### Message context

![Automatic file and terminal context in the composer popup](docs/assets/screenshots/context/composer-context--2026-10-09.png)

### Project Space

![A shared board with notes and a live source file](docs/assets/screenshots/project-space/board--2026-10-07.png)

### Live preview

![A live demo preview after a release-review click beside the seeded conversation](docs/assets/screenshots/browser/agent-preview--2026-10-09.png)

### Task board

![Release tasks with owners and statuses on a conversation's Kanban board](docs/assets/screenshots/task-board/board--2026-10-09.png)

### Custom plugin

![A working Release Checklist demo plugin beside the conversation](docs/assets/screenshots/plugins/agent-build--2026-10-07.png)

These are real product captures using English demo data. The Release Checklist is a demo plugin, not
an included workbench.

</details>

## Quick start

For the desktop app, install [Bun](https://bun.sh) **1.3.14**, a Rust toolchain, and your platform's
[Tauri prerequisites](https://tauri.app/start/prerequisites/).

```bash
git clone https://github.com/rsaryev/localix.git
cd localix
bun install --frozen-lockfile
bun run dev
```

Connect a provider through the model picker, choose a model, and start a conversation.

To use the browser workspace instead of the desktop shell:

```bash
bun run dev:web
```

Open `http://localhost:5050` after the servers start; the API listens on `127.0.0.1:5051`. This uses
a separate, git-ignored database at `.data/dev/localix.db`.

See [installation](docs/getting-started/installation.md) for platform requirements and local builds,
and [troubleshooting](docs/getting-started/troubleshooting.md) for startup problems.

## Data and permissions

Localix stores conversations and configuration on your machine. Model requests go to the providers
you connect; enabled tools, plugins, and servers can make their own requests. Localix-managed
credentials are stored in an encrypted vault; external coding-agent CLIs manage their own login
data.

Tool permissions use `allow`, `ask`, and `deny`. Approvals are not an operating-system sandbox;
native plugin backend and UI code runs with the access of its Localix host. HTML views use a
separate [sandboxed iframe boundary](docs/extending/sandboxed-views.md). See
[permissions](docs/features/permissions.md), [privacy](docs/getting-started/privacy.md), and
[SECURITY.md](SECURITY.md).

## Contributing

Localix is in beta. Read [CONTRIBUTING.md](CONTRIBUTING.md) for the workflow and
[the code map](docs/internals/code-map.md) to find the owning module. Changes are recorded in
[CHANGELOG.md](CHANGELOG.md).

Follow the [Code of Conduct](CODE_OF_CONDUCT.md).

[MIT license](LICENSE).
