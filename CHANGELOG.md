# Changelog

Localix is in beta: versions before 1.0 may change behavior between releases.

## Unreleased

Changes land on `main`.

### Added

- **Your Claude Code status line**: the `statusLine` command of your Claude Code settings draws the
  line under a conversation's message box, reading the session (model, folder, cost, context) as
  JSON on stdin as in Claude Code, redrawn on each message and every `refreshInterval`. A
  `subagentStatusLine` in your own settings rewrites the subagent rows, over a plugin's.
- **Claude Code's settings `env`**: the variables in the `env` block of your Claude Code settings
  reach what a Localix run in that folder starts — shell commands, hooks and stdio MCP servers — and
  the `${VAR}` expansion of MCP servers, as in Claude Code. A project's own variables wait until you
  trusted the folder in Claude Code, and a repository cannot move Claude Code's files or turn
  telemetry export on.
- **Claude Code's starting mode**: a new conversation starts in the permission mode
  `permissions.defaultMode` names in the folder's Claude Code settings (Default, Plan or Bypass),
  and `disableBypassPermissionsMode: "disable"` keeps Bypass and Autonomous off there. See
  [Permission modes](docs/features/permission-modes.md#claude-codes-mode-settings).
- **Claude Code permission rules**: the `permissions` in your Claude Code settings files — your own,
  the project's, the local file and your organization's managed settings — now apply to Localix runs
  in that folder. A Claude Code `deny` refuses the call, an `ask` raises a card and an `allow`
  answers the agent's catch-all question, combined deny over ask over allow as in Claude Code. See
  [Permission rules](docs/features/permissions.md#claude-code-permission-rules).
- **In progress in the Event Center**: the top of the Event Center shows what runs in the background
  — mini app installs and updates, model downloads, a Localix update, plugin updates — with progress
  and actions, and the updates on offer. The bell shows a thin ring and says how many tasks are in
  progress. Finished installs leave one entry: "Installed Git", or "Could not install Kanban" with
  **Try again**. See [Manage notifications](docs/features/notifications.md).
- **Recommended mini apps**: a new installation installs Git, Documents and Kanban in the
  background. Remove one and it stays removed. Setup's mini apps slide shows them arriving and
  installs more in place, without leaving setup. See [Mini apps](docs/features/mini-apps.md).
- **Updates above the message box**: the update line also offers mini app and plugin updates with
  **Update all**, one at a time, when Localix itself has none; each can be hidden until there is
  something newer. See [Updates](docs/getting-started/installation.md#updates).
- **Built-in plugins**: Localix now ships Claude Code plugins of its own, listed in Settings →
  Capabilities → Plugins under **Built-in**. They are on by default and can be switched off, and
  they update with Localix. The first, `localix-mini-apps`, teaches the agent to build, check, pack
  and publish mini apps (`/localix-mini-apps:new` and the rest). See
  [Built-in plugins and updates](docs/extending/plugin-updates.md#built-in-plugins).
- **Plugin updates**: a plugin installed from a marketplace shows **Update now** with the versions
  it goes from and to, and plugins from marketplaces with auto-update on update themselves a few
  minutes after start and every six hours. Each marketplace has an auto-update switch and **Update
  marketplace**; the official `localix` marketplace auto-updates by default and is added on first
  start. Versions follow Claude Code's rule, and an old version stays on disk for 14 days. See
  [Updates](docs/extending/plugin-updates.md#updates).
- **Mini app store pages**: every mini app has its own icon, and choosing one in the store opens its
  page: screenshots at full resolution with a full-window viewer, its README as About, and details
  such as size, license and what it adds. Tags filter the store, and featured apps come first. See
  [Mini apps](docs/features/mini-apps.md#how-it-works).
- **Install as app** (macOS): beside **Install** in the store, **Install as app** also makes the app
  its own Mac app once it is installed, with the app's own icon in the Dock. See
  [Mac apps](docs/features/mini-app-mac-apps.md).
- **Catalogs**: the store's catalog menu shows one catalog or all of them with their app counts, and
  **Add catalog…** shows who publishes a catalog before you add it. `/mini-app catalog list`, `add`
  and `remove` do the same from the chat, and a publisher can link people straight to the dialog.
  See [Publish a mini app](docs/extending/mini-app-publishing.md).
- **Mini apps**: `/plugin create <what it should do>` has the agent build an app inside Localix — a
  calorie counter that logs a meal from a photo, a dashboard, a game — with its own screen and tools
  the chat agent uses. A mini app can start an agent turn, ask decision models, search its own items
  by meaning, use vault secrets and push live updates to its screen. See
  [Build a plugin or a mini app](docs/extending/mini-apps.md#what-you-can-build).
- **Plugin apps** (macOS): install a mini app as its own Mac app from its tab's menu, the app button
  at the right of the tab strip, its rail button or the command palette. The app has its own Dock
  icon, window, menu bar and project, shows the mini app with the agent beside it, keeps its
  conversations as its history, and starts Localix in the background when it is not running. See
  [Plugin apps](docs/features/mini-app-mac-apps.md).

- **Mods**: a Claude Code plugin with a hooks module runs it, once per project as in a Claude Code
  session. A mod can guard or rewrite tool calls and model requests, shape the system prompt, read
  the conversation, add slash commands, tools and agents, fill the message box, and draw panes in
  the **Mods** view from the rail's overflow menu. Claude Code's own `diff` mod shows a project's
  changes there. Each mod runs in a sandbox of its own with a memory cap, so one that loops or runs
  out of memory stops alone. See [Claude Code plugins](docs/extending/claude-code-plugins.md#mods).
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
- **Opening a folder from a link asks first**: a `localix://open` link or `localix <path>` that
  names a folder not yet open as a project shows a confirmation before the project is created or
  restored. A disk root or your home folder is refused.
- **The agent reads a file before it overwrites it**: replacing an existing file it has not read in
  this chat is refused with a request to read it first, instead of showing its content.
- **Remote sites in a Browser tab** open directly in the web app, without the element picker, which
  stays available for pages served from your machine.

### Fixed

- **Claude Code hooks and mods read every tool as Claude Code shapes it**: a Bash batch arrives as
  one command, a file listing as Glob, a URL read as WebFetch, a delegated task as Agent, a skill as
  Skill, and the built-in tools' results in their Claude Code shape (an edit's `filePath` and patch,
  a read's file record). A hook can answer a question card with `answers`, and post-tool events
  carry the call id and duration. See
  [Tool names and shapes](docs/features/hooks-and-commands.md#tool-names-and-shapes).
- **Claude Code permission rules match as in Claude Code**: a skill's `allowed-tools` and a hook's
  `if` anchor path rules at the working directory, `//` or `~/`, cover writes with `Edit(...)` and
  searches with `Read(...)`, and understand `WebFetch(domain:…)`, `Agent(…)`, `Skill(…)` and a bare
  `mcp__<server>`. See [Permission rules](docs/features/permissions.md).
- **Plugins installed in Claude Code** load from the folder `CLAUDE_CONFIG_DIR` names when you moved
  your Claude Code configuration, and follow your organization's managed settings: a plugin they
  turn off stays off and one they turn on cannot be turned off. A `.claude/settings.local.json` at
  the repository root now applies in a subfolder too, as in Claude Code.
- **Long MCP tool calls** are no longer cut off after 30 seconds: as in Claude Code, a call may run
  for about 28 hours unless the server's `timeout` or `MCP_TOOL_TIMEOUT` says otherwise, and fails
  sooner only when its server stays silent — no answer and no progress — for 30 minutes (stdio) or 5
  (remote), which `CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT` changes. See [MCP](docs/features/mcp.md).
- **MCP servers you added** expand `${VAR}` as Claude Code does: a credential name such as
  `GITHUB_TOKEN` or `ANTHROPIC_API_KEY` reads as empty in a server's URL and headers, so an imported
  configuration no longer sends it to that server, and an unset `${VAR}` without a default stays as
  written instead of turning empty. See [MCP](docs/features/mcp.md).
- **Smaller Documents download**: the Documents mini app no longer carries its fonts twice; its
  download is about half the size.
- **Group chats** keep routing a message to the right participant after the model catalog refreshes:
  the decision model was dropped when the catalog named its vendor's own package.
- **A repository can no longer run code before you allow it**: a plugin in a project named like one
  you enabled no longer takes over your consent, a project's own language-server programs no longer
  replace the bundled ones, a skill the agent loads adds hook commands only where your rules allow
  its shell, and `/plugin reload` builds only your own plugins that are switched on. Project
  instructions import only files inside the project.
- **Permission checks cover every path**: an approval card for a call touching files inside and
  outside the project lists them all and a session approval must cover all of them, writes through a
  linked folder count as outside the project, and in Plan mode a SQL Server query that changes the
  server is no longer treated as a read.
- **Previews and browser tabs stay local**: preview servers answer only on this machine and only for
  files inside the folder they serve, other sites cannot connect through a preview's live reload,
  and a browser tab refuses the app's own address. The app's Windows address is trusted only on
  Windows, and the web app serves only its own files.
- **Plugin views**: a page a plugin view navigates to can no longer send messages into your chat.
- **Research and plugin downloads**: the research tool refuses a site whose address it cannot check,
  and an npm plugin source without its own registry uses the one your `~/.npmrc` names for it.

### Removed

- **Code Review, Deliverables and Webhook Notifier**: the three bundled plugins without a screen of
  their own are gone, with the `/review` command.

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
