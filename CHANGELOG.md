# Changelog

Localix is in beta: versions before 1.0 may change behavior between releases.

## Unreleased

## v0.1.0-beta.20 — 2026-10-30

Mini apps are signed: the Store says whether an app's catalog is signed, and only signed apps update
on their own. The Store also offers the app that opens a file, and asks before an install the way
the rest of Localix asks.

### Added

- **Signed mini app catalogs**: a mini app's page in the Store says beside its publisher whether its
  catalog is **Signed**, **Not signed**, or its **Signature changed**, and the **⋯** menu beside
  **Open** has **Update automatically**, which you can untick for that app. Publishing a mini app
  with the authoring plugin now signs its catalog with your own key.
- **An app for a file**: opening a CSV, a Word document, an e-book or a SQLite database that no
  installed app opens now shows one line above the file, **Documents opens this file**, with
  **Install** or **Keep in editor**. It comes from what each mini app declares it opens, and an open
  file switches to the app once it is installed.
- **Recommended plugins install on their own**: the plugins the Localix marketplace recommends are
  installed once in the background, like its recommended mini apps; one you remove is not added
  back.

### Changed

- **Only signed mini apps update on their own**: apps from a signed catalog, the Localix one
  included, still update within six hours; an unsigned app updates when you choose **Update**. A
  catalog whose signature changed installs nothing until you remove it and add it again.
- **A calmer install question**: before a package that runs programs on this computer or comes from
  a community marketplace is installed, the Store asks in the app's usual dialog: where it comes
  from, in a sentence what it runs, the hosts it reaches and what it adds, and whether it is for you
  or only for the open project.
- **Get and Open look like the app's other buttons**: where to get a package (such as **Install as
  app**) and its options are in a small menu beside the button.
- **What's inside, by kind**: a package's page groups its parts (**Skills · 6**, **Hook**) in the
  order you use them, and each row says what it does: a skill's description, or when a hook runs.

### Fixed

- **The desktop app keeps up while it is open**: the Store page of a package you install or remove,
  its **Open** button, a new mini app's rail section, status bar icon, tool card, commands and
  search filter, the update and recommendation lines, the spend warning and the "minutes ago" times
  no longer wait for the page to be opened again.
- **A plugin you removed installs again**: **Get** on a plugin removed from the Store no longer
  fails with "A plugin already exists at this destination".
- **A mini app whose screen fails to load says so**: its tabs stay open while the screen is tried
  again, and if it keeps failing the Event Center says so under that mini app.
- **A mini app's tools are set up once**: a mini app no longer sets itself up again with every
  message, so one that watches files no longer starts another watcher each time.
- **The disk image from a release** shows the same styled install window as one built locally.

## v0.1.0-beta.19 — 2026-10-29

Localix gets smaller: the mini app kit leaves the app, and a written contract keeps mini apps and
Localix in step. The Store's recommendations look at your work more closely and say why.

### Changed

- **Better recommendations in the Store**: **For your work** asks about each open tab, chip, group
  of installs and the project on its own, so one large file no longer crowds out the rest, and no
  single publisher takes the whole row. Packages that come with Localix no longer count as your
  choices, and the project's dependencies now say what it uses. What you installed lately counts for
  more, a package made for the file you have open comes first, and one shown day after day that you
  never open makes room for the next. The row in Discover shows only what suits your work.
- **Quieter composer strips**: the recommendation line reads _Recommended · Docker tools and 2 more
  for compose.yaml_, without icons, and the tip waits while it shows, so there is one piece of
  advice above the composer at a time. The strips stay while the chat is on screen instead of
  appearing only after a click into it, and **Send** no longer jumps in when you start typing.
- **A smaller app**: Localix no longer carries the mini app kit (about 75 MB installed). A mini app
  installs the kit of the Localix release it is built against into its own folder; the
  mini-app-authoring plugin does this when it creates or checks one.
- **Cards follow the transparency level**: under glass, cards, Store collections and panels are one
  step denser than the pane beneath them at every level, instead of dark slabs at High.

### Added

- **Why a package is recommended**: each recommendation in **See all**, and the strip above the
  composer, says what found it — the open file, a chip, what you installed or the project.
- **Not interested**: the thumbs-down beside **Get** in the recommendations removes a package from
  them for good, and a package you remove through the Store is not recommended again. **Not
  recommended**, under the list, brings any of them back.
- **Packages say what they are for**: the Localix marketplace lists the files and dependencies each
  plugin and mini app suits — Database for `.sql` files and database drivers, DevOps for a
  Dockerfile or compose file, Documents for Office files — and the Store recommends it when one of
  them is open or in the project.
- **The mini app contract**: everything a mini app may rely on from Localix is written down in one
  file, and a Localix release that would break a mini app built against it is stopped before it is
  published. `mini-app kit` says whether a mini app's kit is exactly the running Localix's, and
  `mini-app kit --update` installs the current one.

### Fixed

- **Settings follow changes made elsewhere**: a vault item removed while its dialog is open closes
  the dialog; project settings take a name or prompt saved elsewhere instead of writing the old one
  back; a project removed while its settings are open steps back to Preferences.
- **The Store keeps up while a package page is open**: a package removed meanwhile no longer says
  Installed in the list behind it, and its open page steps back to where you came from.
- **Typed path and secret helpers in the mini app kit**: `isPathWithin`, `resolveWithin`,
  `redactSecrets` and the SDK's other path and secret helpers are typed in a mini app built outside
  Localix, where they were `any`.

## v0.1.0-beta.18 — 2026-10-29

Localix's own mini apps and plugins now come from the
[Localix marketplace](https://github.com/rsaryev/localix-marketplace) and install, update and are
trusted like anyone else's. Localix itself ships the mini app SDK and kit to build them with.

### Changed

- **Our mini apps and plugins install from the Store**: Project Space, the task board, Git,
  Database, the games and the rest, and the mini-app-authoring and Team plugins, are no longer built
  in. They are listed in the Store under the Localix marketplace, which is already added; install
  the ones you use again. Your data stays where it was.
- **Mini apps ask before they run**: every mini app, ours included, waits for your consent the first
  time, and the Store marks the Localix marketplace's packages as verified.
- **A compact Store page**: a package's page has a smaller header, with **Get** under the name.
- **Faster edits in a project with a language server**: after the assistant writes a file, Localix
  waits only until the language server goes quiet instead of a fixed deadline.

### Added

- **Build mini apps outside Localix**: each release publishes the mini app kit, so a mini app can
  live in its own repository, with its own checks and CI, and test its screens and backend with the
  SDK's testing helpers.

### Fixed

- **Plugin commands in a terminal pane**: commands a plugin ships in its `bin/` folder now run in a
  terminal pane too, not only in the assistant's own shell.

### Removed

- **Desktop file associations for mini app formats**: Localix no longer offers to open SQLite, SQL,
  PDF, Office, EPUB and request files from Finder; open them in a mini app that handles them.

## v0.1.0-beta.17 — 2026-10-28

This release makes Localix work the way Claude Code does: one agent per chat with subagents, Claude
Code's tool names, memory, commands and status line, and mini apps you can make from either app. The
Store and Settings are laid out anew.

### Added

- **Make mini apps from Claude Code too**: the built-in **mini-app-authoring** plugin works the same
  in Localix and in Claude Code (`/plugin install mini-app-authoring@localix`).
  `/mini-app-authoring:create <what it should do>` creates the app in your project, checks it and
  installs it into the running Localix; `/mini-app-authoring:publish` packs it into a catalog others
  can add, and `/mini-app-authoring:get-localix` installs Localix itself. See
  [Build a mini app with the agent](docs/extending/build-with-the-agent.md).
- **MCP servers' prompts are slash commands**: a connected server's prompts appear in the composer
  menu and run as `/mcp__<server>__<prompt>` with their arguments. `/mcp` groups servers by where
  they come from and can reconnect, enable or disable one, and a WebSocket server now receives its
  configured headers.
- **More of Claude Code's commands**: `/init`, `/status`, `/hooks`, `/diff`, `/add-dir` and
  `/export` work as in Claude Code, and `/compact` takes a context checkpoint by hand and tells your
  `PreCompact` hooks. A Claude Code command Localix cannot run says why instead of "unknown".
- **Claude Code's status line under the message box**: your `statusLine` command gets what Claude
  Code gives it, including whether the prompt cache is still warm, and its rows show with their
  colors and links.
- **Store recommendations**: Discover opens with a **For your work** row ranked against your open
  tabs, project and installed packages, and a **Recommended for you** strip appears above the
  composer.

### Changed

- **Subagents work as in Claude Code**: the assistant starts one with `Agent`, talks to it with
  `SendMessage` and stops it with `TaskStop`, with Claude Code's own fields, so skills and agent
  files written for Claude Code run unchanged. Up to 10 run at once (was 3) and several start
  together; a subagent works in the background, can ask the agent a question, and its whole answer
  arrives as a message. Its card is titled by its task and says truthfully whether it is queued,
  running, waiting for an answer, done or stopped. See [Subagents](docs/features/delegation.md).
- **Tools have one name, Claude Code's**: every built-in tool is named as in Claude Code (`Bash`,
  `Read`, `AskUserQuestion`, `Agent`) in the tool list, permission rules, hooks and the
  conversation. Existing rules and past conversations are updated on first start; an agent file's
  `tools`, a skill's `allowed-tools`, a hook matcher or a mod's `tool` filter must use the new
  names. Tool cards show what a tool was called with under **In** and what came back under **Out**,
  and a run of calls reads as a sentence: "Started 2 agents, ran 1 command". See
  [Tool names](docs/features/tools.md#tool-names).
- **Memory lives in Claude Code's own folder**: a chat loads the `MEMORY.md` of
  `~/.claude/projects/<project>/memory/`, the one Claude Code keeps, so what you taught either app
  the other already knows. `/memory` shows the folder and `/memory <fact>` saves a fact. See
  [Memory](docs/features/learning-loop.md#memory).
- **A new Store and Settings layout**: the Store has search and your library (Installed, Updates,
  Yours, Sources) on one row and the catalog as tabs beneath, and opens on Discover. Settings shows
  its sections as tabs across the top instead of a sidebar.
- **The tip strip stays put**: the tips above the message box no longer blink in and out; a tip
  stays between turns and when you switch chats, and the next one follows a few seconds later.
- **Lighter requests**: rarely used tools wait in `ToolSearch` until the assistant needs them, as in
  Claude Code, and `TaskStop` stops any background work, so every request carries fewer tokens.
- **Language servers install when you need them**: they no longer ship inside the app. The first
  time you open a file of a language, its server downloads into `~/.localix/language-servers`, and
  the status bar shows the install or why it could not finish.
- **A project cannot pick a permissive mode for you**: `bypassPermissions` or `auto` as the
  `defaultMode` of a project's or local settings file no longer applies.

### Fixed

- **Stop gives your queued messages back**: messages sent while the assistant worked return to the
  message box when you press Stop. An empty Enter never sends, and a message sent mid-run waits in
  the queue without flashing into the conversation.
- **The prompt cache hits again**: new conversations with the same agent, model and project reuse
  the provider's cache, and OpenAI requests carry the headers that let it hit.
- **Local models no longer pile up in memory**: a local model server stops within about two seconds
  after Localix quits or crashes, and the desktop app and a development server share one.
- **`SessionEnd` hooks run when you quit Localix**, and **Set up Localix** opens at its first step.

### Removed

- **Group conversations**: a conversation has one agent, fixed when you start it. Participants,
  `@handle` and `@all`, leaders, handoffs and `/agents add`, `remove` and `members` are gone; the
  agent starts a subagent to bring another agent in.
- **The agent island**: the quick chat at the notch on macOS, its **Cmd+Shift+J** shortcut and its
  **Quick Chat** menu-bar item are gone. Ask the agent from the workspace chat.
- **Tools Claude Code does not have**: the `CodeMode` script tool, the topic tool and the `Memory`
  tool. Earlier runs still show in your conversations; notes saved with the old `Memory` tool stay
  in `~/.localix/memories` but no longer load.

## v0.1.0-beta.16 — 2026-10-25

One Store for everything you add to Localix, and Claude Code's own files, settings and commands
working as they do in Claude Code: what you copy from Claude Code now runs here unchanged.

### Added

- **The Store**: one tab, opened from the rail's **+**, for mini apps, Claude Code plugins, skills,
  agents and MCP servers. **Discover** opens on **Start here**, search covers packages and what is
  inside them, and **Installed**, **Updates**, **Yours** and **Sources** list every kind together.
  **Get** asks first, in a sheet showing what would run, before a community plugin or one that runs
  programs is installed. See [Store](docs/features/store.md).
- **The assistant can use the Store**: a `store` tool searches your sources, shows what a package
  installs and runs, and installs, updates, removes, enables or creates an agent or a skill. Each
  change waits for your approval on a card.
- **Agents, skills and MCP servers as Claude Code files**: agents live in `~/.claude/agents/`,
  skills in `~/.claude/skills/`, so one you write works in both. Each has a page in the Store with
  its settings, and an agent's **Access** tab switches its tools, skills, servers and mini apps.
  Agent files can carry their own `hooks`, `mcpServers` and `permissionMode`.
- **Claude Code's everyday commands**: `/clear`, `/resume`, `/rename`, `/rewind`, `/plan`,
  `/context`, `/copy`, `/permissions`, `/config` and `/effort` work in the composer and offer their
  arguments as crumbs. `/plugin install name@marketplace --scope project`, `/plugin uninstall` and
  `/plugin market add` work as pasted from Claude Code's docs.
- **Fork a subagent**: `delegate` with `context: "fork"` starts a copy of the delegating agent that
  has seen everything it has seen, so the provider's prompt cache reads the conversation instead of
  writing it again. It works in solo and group chats. See
  [Delegation](docs/features/delegation.md#what-a-child-sees).
- **Your Claude Code setup carries over**: hooks, MCP servers (with `headersHelper` and the `oauth`
  block), the status line, `env`, permission rules, the starting mode, output styles and managed
  lock-downs from your Claude Code settings apply in Localix. Settings → Permissions shows the rules
  and the file each came from.
- **Archive unused skills**: **Store → Yours** previews which skills would be archived and why, and
  archives nothing until you confirm; a skill can be pinned to keep it.
- **Session recap**: coming back to a chat after a break, a one-line summary of where you left off
  waits in the transcript; `/recap` writes one on demand.

### Changed

- **Settings live on a package's page**: an installed mini app or plugin with options has a
  **Settings** tab on its Store page; Settings no longer manages agents, skills, plugins or MCP
  servers.
- **Quieter background indexing**: semantic search indexes in the background at low priority,
  scrolling the Store no longer starts it, and its progress no longer passes 100%.
- **Mini apps you build appear in the Store**: an app made with `/mini-app create` shows on
  **Yours** and **Installed**.

### Fixed

- **The Store says when it cannot read something**, with the reason and **Try again**, instead of an
  empty shelf or a page that never loads; **Install** waits until it can show what will run.
- **Mods' band** keeps its controls in place when a mod draws more than one row.
- **Claude Code hooks, plugins and permission rules behave as in Claude Code**: tool names and
  inputs arrive in Claude Code's shapes, long MCP calls are no longer cut off after 30 seconds, and
  a repository can no longer run code before you allow it.

### Removed

- **The bundled Code Review, Deliverables and Webhook Notifier plugins**, and the import of MCP
  servers from pasted JSON in Settings.

## v0.1.0-beta.15 — 2026-10-21

Localix now tells you what is new: each update is announced in a dialog with its release notes,
setup opens as a dialog over a new chat, and every dialog arrives with the same motion.

### Added

- **Update dialog**: a newly found version is announced once, with what is new in it, before you
  restart. **Later** keeps it offered above the message box, in the title bar and in Settings.
- **Setup dialog**: setup opens over a new chat at launch, with the workspace tips and their
  controls, until you close it once. Open it again from the command palette with **Set up Localix**.

### Changed

- **Mods look like the rest of the app**: the strip a mod draws above the message box uses the
  composer strips' compact type, a list of picks reads as one row of chips with their keys, lines
  sit side by side, and the strip scrolls rather than pushing the message box away; collapsed, it is
  one row of what it says. A pane is drawn at workbench density. See
  [How Localix draws a mod](docs/extending/claude-code-mods.md#how-localix-draws-a-mod).
- **Settings pages line up**: every page and section keeps its actions on its title's line, and
  moving between pages and tabs no longer moves the title, the tabs or the first section.

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

- **Mods look like the rest of the app**: the strip a mod draws above the message box uses the
  composer strips' compact type, a list of picks reads as one row of chips with their keys, lines
  sit side by side, and the strip scrolls rather than pushing the message box away; collapsed, it is
  one row of what it says. A pane is drawn at workbench density. See
  [How Localix draws a mod](docs/extending/claude-code-mods.md#how-localix-draws-a-mod).
- **Settings pages line up**: every page and section keeps its actions on its title's line, and
  moving between pages and tabs no longer moves the title, the tabs or the first section.

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

- **Mods look like the rest of the app**: the strip a mod draws above the message box uses the
  composer strips' compact type, a list of picks reads as one row of chips with their keys, lines
  sit side by side, and the strip scrolls rather than pushing the message box away; collapsed, it is
  one row of what it says. A pane is drawn at workbench density. See
  [How Localix draws a mod](docs/extending/claude-code-mods.md#how-localix-draws-a-mod).
- **Settings pages line up**: every page and section keeps its actions on its title's line, and
  moving between pages and tabs no longer moves the title, the tabs or the first section.

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

- **Mods look like the rest of the app**: the strip a mod draws above the message box uses the
  composer strips' compact type, a list of picks reads as one row of chips with their keys, lines
  sit side by side, and the strip scrolls rather than pushing the message box away; collapsed, it is
  one row of what it says. A pane is drawn at workbench density. See
  [How Localix draws a mod](docs/extending/claude-code-mods.md#how-localix-draws-a-mod).
- **Settings pages line up**: every page and section keeps its actions on its title's line, and
  moving between pages and tabs no longer moves the title, the tabs or the first section.

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
