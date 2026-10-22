# Changelog

Localix is in beta: versions before 1.0 may change behavior between releases.

## Unreleased

Changes land on `main`.

### Added

- **Mini apps**: `/plugin create <what it should do>` has the agent build an app inside Localix — a
  calorie counter that logs a meal from a photo, a dashboard, a game — with its own screen and tools
  the chat agent uses. A mini app can start an agent turn, ask decision models, search its own items
  by meaning, use vault secrets and push live updates to its screen. See
  [Build a plugin or a mini app](docs/extending/plugins.md#what-you-can-build).
- **Plugin apps** (macOS): install a mini app as its own Mac app from its tab's menu, the app button
  at the right of the tab strip, its rail button or the command palette. The app has its own Dock
  icon, window, menu bar and project, shows the mini app with the agent beside it, keeps its
  conversations as its history, and starts Localix in the background when it is not running. See
  [Plugin apps](docs/features/plugin-apps.md).

- **Mods**: a Claude Code plugin with a hooks module runs it, once per project as in a Claude Code
  session. A mod can guard or rewrite tool calls and model requests, shape the system prompt, read
  the conversation, add slash commands, tools and agents, fill the message box, and draw panes in
  the **Mods** view from the rail's overflow menu. Claude Code's own `diff` mod shows a project's
  changes there. See [Claude Code plugins](docs/extending/claude-code-plugins.md#mods).
- **Claude Code marketplaces**: `/plugin marketplace add owner/repo` adds one, and
  `/plugin install <name>@<marketplace>` installs from it; `list`, `update` and `remove` manage it.
  Plugins you installed in Claude Code itself also appear, waiting for your approval.
- **Output styles**: Default, Proactive, Concise, Explanatory, Learning, a plugin's and your own.
  Pick the default in Settings → Preferences → Output style, or switch a chat with `/output-style`.
- **Plugin secrets in the vault**: a Claude Code plugin's `sensitive` settings are kept encrypted in
  the vault and bound to the plugin, not in plain text with its other settings. They still reach the
  plugin's hooks and MCP servers, and are deleted when you uninstall it. Values saved by an earlier
  version move to the vault the first time Localix starts.
- **Hooks can read the conversation**: `transcript_path` names the chat as a file in Claude Code's
  transcript format, so ralph-loop's completion promise and hookify's stop rules work as in Claude
  Code. `/plugin validate <path>` checks a plugin folder before you install it.
- **Plugin themes** in Settings → Preferences → Appearance and through `/theme`.
- **Plugin workflows** run in the background as `/<plugin>:<name>`, each agent a child task on the
  model and effort it asks for, optionally in its own git worktree; a stopped run resumes.
- **Channels**: a plugin's MCP server can speak into the chat that last used it and answer approval
  prompts; turn it on for your own servers with **Listen as a channel** in Settings → MCP.
- **MCP servers can ask you for input**: their request opens a form card in the chat.
- **Project Space diagrams and text**: notes, shape labels and text take a font (sans, serif, mono,
  handwritten), size, alignment and colour from one **Text** menu, draw **bold**, _italic_, lists
  and task boxes, and a new note fits its text. Flowcharts and 2×2 matrices are native elements
  written as Mermaid — laid out by the board with right-angled lines, renamed or dragged in place,
  and turned into shapes when you want to move them by hand. Connector labels sit beside the line
  and slide along it; frames present as slides; styles copy and paste; a highlighter, an eraser and
  find-and-replace join the tools. See [Project Space](docs/features/project-space.md).

### Changed

- **Claude Code plugins** load as they are: the same folder works in Claude Code and in Localix,
  with nothing converted at install. Hooks on `PostToolUseFailure` run when a tool fails, and
  `${VAR}` in a plugin's MCP servers reads the environment as in Claude Code. Hooks run on every
  Claude Code event that has a moment in Localix; a plugin's agents are subagent types the agent
  delegates to, with no limit per plugin. Settings → Capabilities → Plugins labels each entry
  **Claude Code plugin**, **mini app** or **legacy manifest**. See
  [Claude Code plugins](docs/extending/claude-code-plugins.md).
- **Claude Code plugins behave as in Claude Code**: hooks see Claude Code's tool names and inputs
  and decide before the approval card; allow, ask, deny, `continue: false` and replaced tool output
  work as documented; a plugin's skills load by `/<plugin>:<skill>`, and your own skill of the same
  name wins. A personal plugin has one set of settings in every project, `/plugin install` respects
  `defaultEnabled: false` and names the dependencies it installed, `/plugin disable` refuses while
  another plugin depends on it, and uninstalling deletes the plugin's data folder.
- **Skill commands are checked**: a skill the agent loads runs its `!` commands only where your
  permission rules allow them, passes its arguments as values rather than shell text, and gives each
  command two minutes.
- **Status updates when it changes**: local model downloads and semantic search indexing in
  Settings, a provider sign-in started from the message box, and an external agent waiting on
  terminal output now follow the change as it happens instead of checking on a timer, with fewer
  background requests. Kubernetes lists and logs and Docker logs follow their sources too.
- **Context chips** above the message box stay on one line and scroll sideways instead of wrapping
  into a second row.

### Fixed

- **Group chats** keep routing a message to the right participant after the model catalog refreshes:
  the decision model was dropped when the catalog named its vendor's own package.

## v0.1.0-beta.15 — 2026-10-21

Localix now tells you what is new: each update is announced in a dialog with its release notes,
setup opens as a dialog over a new chat, and every dialog arrives with the same motion.

### Added

- **Update dialog**: a newly found version is announced once, with what is new in it, before you
  restart. **Later** keeps it offered above the message box, in the title bar and in Settings.
- **Setup dialog**: setup opens over a new chat at launch, with the workspace tips and their
  controls, until you close it once. Open it again from the command palette with **Set up Localix**.

### Changed

- **Faster update check**: a new version is found a few seconds after launch instead of thirty.
- **Launch** always opens a chat: the one you were in, or a new one. An empty editor group shows the
  Localix bird instead of the workspace tips.
- **Dialogs** rise into place and settle, and confirmations open centred on a mark in the colour of
  what they do: red for what cannot be undone.

## v0.1.0-beta.14 — 2026-10-21

### Removed

- Sign-in for Anthropic (Claude Pro/Max), Kimi Coding, Meta, xAI and Radius. A connection signed in
  to one of them stops working, and the Event Center says so from startup; remove it and add the
  provider again with an API key. Sign in with ChatGPT, OpenAI Codex, OpenRouter and GitHub Copilot
  remain.

## v0.1.0-beta.10 — draft prepared 2026-10-17

### Added

- `/workflows <goal>` hands a goal to a team: the chat's leader breaks it into cards on the Kanban
  board, reuses or creates the specialists it needs and coordinates them to the result. Whether work
  waits for an approved plan is the chat's permission mode.
- Team roles: the elected leader is named in every agent's prompt and owns coordination; members
  work only on their own cards, and a member's finished card waits in a new **Review** column until
  the leader verifies it.
- `@human`, a built-in record that describes you to agents (Settings → Agents, globally or per
  project). Agents ask you with question cards instead of mentioning you, and can assign you a
  Kanban card, which notifies you.
- The macOS agent island is back: a quick request and agent questions at the notch, with one open
  size. It is off until you turn it on in onboarding or Settings, and stays quiet while a Localix
  window is focused.
- The model picker lists every agent you can invite, so models can be set before inviting. "All
  agents" sets every listed agent at once; each agent then resolves through this chat's choice, its
  own default, its last pick, then the project.
- Context limit per model in tokens (Auto, steps the window holds, Full) instead of a percentage.
- Onboarding opens with appearance and the island, and gains a tip for the goal command.
- Claude Code plugins are converted to the Localix format when installed; installs default to global
  scope, and LSP plugins report a missing language server with an install hint.
- `/model` is a step-by-step picker with breadcrumbs — agent, provider, model, then reasoning, turns
  and context window — and no longer prints a model list.
- The model list updates without a new release: Localix checks the catalog's public sources in the
  background and on demand from Settings → System → Model list. `LOCALIX_MODEL_CATALOG_REFRESH=0`
  turns the automatic check off.
- Models are listed newest first for every provider.
- PDFs open in the built-in viewer; "Open with…" switches to another matching editor such as Reader.

### Changed

- An agent's question always waits up to five minutes for your answer, then the agent continues on a
  stated assumption; "Answer later" and queued questions are gone.
- Background jobs ignore `timeout` and outlive the turn that started them; a deliberate stop is
  reported as stopped, not as a failure.
- The Browser keeps previews fitted to the pane; an agent pins a width only for a check and the pane
  returns to fit afterwards.
- Webhook Notifier is off by default; its `human_mentioned` event is now `human_assigned` (2.0.0).
- The starter team no longer includes Team Lead, Project Manager or QA Engineer; agents you already
  have stay.
- A fresh install opens with every panel collapsed on an empty workspace.
- Reasoning levels come from the model catalog only: a model offers exactly the levels it supports,
  and Off appears only where the model can really turn reasoning off.
- `/model <name>` picks the level remembered for the new model, or its default, instead of keeping
  the previous model's level.

### Fixed

- The drop hint no longer sticks in the composer after a drag that ended outside the window, such as
  a macOS screenshot thumbnail.
- The folded island no longer opens on hover or takes clicks while a Localix window is focused.
- A Kanban card no longer gets stuck in review when its owner completes it again, and an epic
  described next to its tasks is no longer silently dropped.
- An unknown Browser tab id answers with the open tabs instead of "host unavailable".
- Opening a file from Finder, "Open With" or `localix <file>` no longer creates or switches
  projects; it opens next to the chat on screen. A missing path fails at once.
- The chat no longer disappears when the Browser, a terminal or a file link opens after a pane was
  maximized in another conversation.
- Off on Claude 5.x and GPT-6 models no longer runs at the provider's default high effort.
- Anthropic models keep their earlier thinking across turns at every reasoning level.
- Agent tool calls recover from a no-op edit in a batch, a stray `new_string` key and a `fork` start
  action; validation errors name the unknown field and list allowed values.

## v0.1.0-beta.8 — published 2026-10-16

### Added

- A per-agent context-window budget share (`contextPercent`, 20-100%, default 70), with a composer
  control to set it alongside effort and max turns.

### Changed

- Moved Update & Restart from the left rail into the titlebar, beside Terminal, Browser and the
  Event Center, where it is easier to notice.

### Fixed

- The flying bird now greets every empty chat, model connected or not; the workspace tips carousel
  is reserved for a truly empty editor group.
- The command-palette tip scene no longer clips the key-chord badge behind its stage edge.

## v0.1.0-beta.7 — published 2026-10-16

The first beta published after the repository history was reset. Earlier beta tags and their
installers were removed; this release replaces them.

### Added

- Desktop application for macOS on Apple silicon, signed and notarized; it has been run by hand
  there and nowhere else.
- Intel Macs, Linux and Windows run Localix from source; they have no installer yet.
- Multi-agent conversations, connected context, Project Space, the agent-driven preview with Visual
  Feedback, plugins the agent can build, loops and monitors, and the bundled workbenches.
- Native browser pages on Linux, hosted in a GTK page layer.
- Building from source is documented in
  [Run Localix from source](docs/getting-started/installation.md).

### Changed

- Providers connect only through credentials stored in the encrypted vault; API keys are never read
  from environment variables.
- Updated dependencies, the agent runtime (v1.2.0) and Monaco (0.57.0).

### Removed

- The agent island and its quick chat window.

## How entries get added

A release is a reviewed manual dispatch of
[`.github/workflows/release.yml`](.github/workflows/release.yml) from `main` with an exact semver
tag (`v1.2.3`) as its input. Pushing a tag does not run release code, because a tag can point at an
unmerged commit. The workflow resolves the tag to one commit, requires that commit to be reachable
from `origin/main`, reruns the repository gates against it, then creates a draft GitHub Release,
uploads the per-platform installers, and publishes the draft. Every published release becomes
`latest`, a tag with a pre-release label (`v1.2.3-beta.1`) included: the updater reads
`releases/latest/download/latest.json`, and GitHub's `latest` skips a prerelease. A version older
than the current latest is refused before the publish.

An entry is therefore written when a tag is prepared, not when a commit merges:

- Prepare a `## v<version> — draft prepared <date>` section below `## Unreleased` for the tag.
  Replace the draft label with the publication date only after the release is public.
- Group its lines under `Added`, `Changed`, `Fixed`, and `Removed`.
- The release body is written by `scripts/build-release-notes.mjs` when the release is published:
  this version's section becomes **Highlights**, GitHub's generated list of merged pull requests
  becomes **What's changed**, and the download table lists only the installers that reached the
  release. `SHA256SUMS.txt` and build-provenance attestations are published with it.
- Platforms: only macOS on Apple silicon is built. The Linux x64, Linux ARM64 and macOS Intel legs
  are parked in a comment in the workflow's leg list, to be re-enabled once their packaging works.
- Keep the calm, factual register the rest of the repository uses; see
  [Contributing](CONTRIBUTING.md).
