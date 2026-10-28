# Use language server features

Localix routes editor intelligence and agent refactors through an API-managed Language Server
Protocol (LSP) layer. Use it for diagnostics, semantic navigation, rename, code actions, and
formatting without leaving the workspace.

**Availability:** Each result depends on a matching server and the response it returns. Localix does
not ship its language servers: the first time you open a file of a language it supports, it installs
that language's server and starts it. Plain editing and text search work while it installs, and
without one.

## What you can do

| Capability                                                     | Product surface                                                        | Boundary                                                                     |
| -------------------------------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Diagnostics                                                    | Editor markers, Problems, and feedback appended after agent file edits | Agent feedback contains errors only; the editor receives every severity      |
| Completion, hover, signature help, and inlay hints             | Editor                                                                 | An unsupported or failed request returns an empty or neutral result          |
| Definitions, references, implementations, and type definitions | Editor                                                                 | The server must return a resolvable file URI                                 |
| Document and workspace symbols                                 | Editor breadcrumbs, workspace symbol search, and `Read` outline mode   | Workspace search queries servers already running for the project             |
| Rename                                                         | Editor                                                                 | Files outside the requesting session's open buffers use separate disk writes |
| Quick fixes and source actions                                 | Editor and the Problems panel                                          | Command-only actions are not executed                                        |
| Document formatting                                            | Editor format and save flows                                           | The server must advertise document formatting                                |

The [Workspace](workspace.md) guide owns the editor-grid and file-tab behavior. This page covers the
language-server mechanism and how it reaches the agent.

The editor breadcrumb always shows the file name. Open it to browse document symbols, with a filter
for long lists. The cursor adds enclosing classes, functions, or keys to the trail; their menus
navigate siblings, and the trailing **…** opens children of the current scope. Click a symbol label
to jump to its line. This replaces the separate Outline panel. Symbol structure works across
languages, including JSON, TypeScript, JavaScript, and Python, when a matching language server
returns document symbols. Without symbols, the file segment remains available and its menu reports
an empty result.

Symbol menus use compact rows with line numbers. The list scrolls within a picker capped at half the
window height (and at most 24rem), while the search field stays visible. Choosing a symbol scrolls
smoothly to its line and uses the same fading destination highlight as search navigation.

## How it works

### Document and server lifecycle

Opening a file selects the first matching server definition, starts one client for the project root
and resolved server root, and sends the current editor buffer. Buffer changes are serialized so a
navigation or formatting request cannot overtake a pending change.

Several visible editors or sessions can hold the same document. Localix sends `didClose` only after
the last holder releases it. A client with no open documents stops after five minutes.

A parked or hidden editor releases its language-server document even if the editor remains mounted.
Its buffer stays in the workspace; making it visible again reopens the latest text, including
unsaved edits, without needing a new disk read just to restart language services.

A missing executable, failed initialization, crash, or closed transport removes the client. A later
request can start it again, but the manager does not switch to a second matching definition during
the failed attempt.

### Editor edits, saves, and diagnostics

A language server computes edits against the document it last received. Files tracked as open in the
requesting session use the buffer path:

- **Quick fix and rename.** Files open in the requesting session receive edits as an undoable buffer
  operation. Other files use disk writes, even if another session holds them open. The editor checks
  the returned buffer fingerprint before applying edits and warns when it no longer matches.
- **Formatting.** Format Document edits the buffer in place. Format-on-save formats the buffer in
  memory and writes it to disk once.
- **Save.** The server receives `didSave` only when the editor actually writes the file. Typing
  never sends it, so servers that check on save do not re-check on every pause.

Each request (completion, hover, a quick fix) first sends any unsynced buffer edits, so the answer
matches the text on screen. Diagnostics tagged unnecessary are drawn faded (unused variables,
imports, parameters, unreachable code). Diagnostics tagged deprecated are struck through.

### How the agent sees it

The agent has no language-server tools. Their schemas cost more tokens on every request than `Read`,
`Write`, `Edit`, and `Search` combined, and `Search` + `Read` already navigate. The language server
reaches the agent by annotating the file tools' results:

| Annotation          | Where                           | What it says                                                                           |
| ------------------- | ------------------------------- | -------------------------------------------------------------------------------------- |
| `<lsp_diagnostics>` | `Write`, `Edit` results         | Current reported errors; no report is not proof that a build or test passes            |
| `<editor_buffer>`   | `Read`, `Write`, `Edit` results | The file is open in the editor with unsaved edits the disk text lacks, shown as a diff |
| Outline             | `Read` with `mode:'outline'`    | The file's document symbols                                                            |

The diagnostics block is a current snapshot, not a comparison with the file before the edit.
Pre-existing errors can appear. Identical message/code pairs are grouped, with at most 15 distinct
error lines per file and three positions per group. Errors from at most five other files are shown;
counts report additional omitted errors. A missing severity is treated as an error.

The editor-buffer check uses the text on disk _before_ the write. Afterwards, a clean tab still
showing the old text looks the same as a tab with unsaved edits.

### Language mapping

The file map supplies the `languageId` in document notifications. Recognition identifies a file; it
does not install or select a language server.

| Language ID                      | Recognized files                                 |
| -------------------------------- | ------------------------------------------------ |
| `typescript`                     | `.ts`, `.mts`, `.cts`                            |
| `typescriptreact`                | `.tsx`                                           |
| `javascript`                     | `.js`, `.mjs`, `.cjs`                            |
| `javascriptreact`                | `.jsx`                                           |
| `python`, `go`, `rust`, `java`   | `.py`, `.go`, `.rs`, `.java`                     |
| `c`, `cpp`, `csharp`             | `.c`, `.h`; `.cpp`, `.cc`, `.cxx`, `.hpp`; `.cs` |
| `ruby`, `php`, `swift`, `kotlin` | `.rb`, `.php`, `.swift`, `.kt`                   |
| `vue`, `svelte`                  | `.vue`, `.svelte`                                |
| `css`, `scss`, `less`            | `.css`, `.scss`, `.less`                         |
| `json`, `jsonc`, `yaml`          | `.json`, `.jsonc`, `.yaml`, `.yml`               |
| `markdown`, `html`, `lua`        | `.md`, `.html`, `.lua`                           |
| `shellscript`                    | `.sh`, `.bash`, `.zsh`                           |
| `zig`, `dart`, `elixir`          | `.zig`, `.dart`, `.ex`, `.exs`                   |
| `dockerfile`                     | `Dockerfile`, `Dockerfile.*`, `*.dockerfile`     |
| `plaintext`                      | Every unmatched path                             |

### Built-in server definitions

“Built-in” means Localix knows how to find a root and launch the server. Where nothing local
provides the executable, Localix installs it the first time a matching file opens, at the version
that Localix release names.

| Definition | Matching files                                                      | Executable source                                                      |
| ---------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Deno       | TypeScript and JavaScript inside a `deno.json` or `deno.jsonc` root | `deno` on `PATH`                                                       |
| TypeScript | TypeScript and JavaScript outside a Deno root                       | Installed `vtsls`; project TypeScript is preferred                     |
| Vue        | `.vue`                                                              | Project `vue-language-server`                                          |
| Python     | `.py`                                                               | `pylsp`, then `pyright-langserver`, on `PATH`; else installed Pyright  |
| Go         | `.go`                                                               | `gopls` on `PATH`; else `gopls` built with your Go toolchain           |
| Rust       | `.rs`                                                               | `rust-analyzer` on `PATH`; else the installed release                  |
| HTML       | `.html`, `.htm`                                                     | Installed `vscode-html-language-server` (vscode-langservers-extracted) |
| JSON       | `.json`, `.jsonc`                                                   | Installed `vscode-json-language-server` (same package)                 |
| CSS        | `.css`, `.scss`, `.less`                                            | Installed `vscode-css-language-server` (same package)                  |
| Dockerfile | Dockerfile names and `.dockerfile`                                  | Installed `docker-langserver`                                          |
| YAML       | `.yaml`, `.yml`                                                     | Installed `yaml-language-server`                                       |

### Installing on first use

Opening a file whose server is not available starts its install in the background:

- **Status bar.** The bottom bar shows `Installing <language>` with a spinner, and a percentage for
  downloads that report one, beside the **LSP** segment. When the server is ready, the segment goes
  away. Hover, completion and the other editor features answer with nothing until then; the buffers
  you opened or edited meanwhile are sent to the server as soon as it starts.
- **Where.** Installs live in `~/.localix/language-servers/<server>/<version>`. Each is installed
  once per version, and files that share a server share one install: JSON, CSS and HTML come from
  one package. When a Localix update moves a server to a newer version, the newer one installs the
  next time it is needed. The older folder is removed only once nothing can be running from it:
  never while a server in this Localix started from it, and not until no Localix sharing
  `~/.localix` (a dev build beside a packaged one) has launched it for 30 days.
- **Checked.** Every server is installed at an exact version. npm servers install with the Bun that
  runs Localix, so no Node or npm is needed. Each ships with a lockfile that pins its whole
  dependency tree, transitive packages included, with the registry's integrity hash of every
  package; the install is frozen to it and fails rather than float to newer versions. No install
  scripts run, and no package published in the last seven days is taken. The Rust release is checked
  against its size and SHA-256 before it is unpacked. Go builds `gopls` itself, checked by the Go
  checksum database.
- **When it cannot.** The segment turns into a warning that says why: `<language> offline` when the
  download could not connect, `Go needs Go` when the toolchain that builds the server is missing,
  and `<language> not installed` for any other failure; hover it for the details. Editing a file of
  that language tries again after 30 seconds offline, a minute for a missing toolchain, and five
  minutes after another failure.

## Configuration

There is no general LSP settings page or per-language enable switch. Built-in servers install
themselves on first use; an executable of your own on `PATH` (or, for Vue, in the project) is used
instead where the table above says so. For other languages, enable a plugin that contributes an
`lspServers` map.

```json
{
  "lspServers": {
    "clangd": {
      "command": "clangd",
      "args": ["--background-index"],
      "extensionToLanguage": { ".c": "c", ".cpp": "cpp" },
      "initializationOptions": {},
      "env": { "CLANGD_FLAGS": "--log=error" }
    }
  }
}
```

| Plugin field            | Runtime effect                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------- |
| `command`               | Resolves the executable on `PATH`, else installs a known server on first use          |
| `args`                  | Adds command arguments                                                                |
| `extensionToLanguage`   | Selects the server by extension and opens each file with the mapped `languageId`      |
| `initializationOptions` | Sends the object in the server initialize request                                     |
| `settings`              | Sent as the server's configuration and answered to its `workspace/configuration` asks |
| `env`                   | Adds environment variables to the stdio process                                       |
| `workspaceFolder`       | The server's root instead of the project root                                         |
| `startupTimeout`        | How long the initialize request may take (30 seconds when unset)                      |
| `requestTimeout`        | How long any other request may take; 60 seconds when unset                            |
| `shutdownTimeout`       | How long a graceful shutdown may take before the process is ended                     |
| `restartOnCrash`        | `false` leaves a server that exited on its own stopped                                |
| `maxRestarts`           | How many times a server that exited on its own starts again                           |
| `diagnostics`           | `false` keeps the server's diagnostics out of `Edit` and `Write` results              |
| `transport`             | `stdio` or `socket`; both run over stdio, as in Claude Code                           |

The server process also receives `CLAUDE_PLUGIN_ROOT`, `CLAUDE_PLUGIN_DATA` and
`CLAUDE_PROJECT_DIR`. A server config is a strict object: an unknown key keeps that server from
loading, and the plugin's validation notes name the key.

For each enabled plugin server, Localix reports two things in the plugin's validation notes (the
Store (Plugins) and `/plugin details`) and in the agent's `# Plugins` prompt section:

- Extensions a built-in server already handles. The built-in server is kept for those files, and the
  plugin server registers only the remaining extensions.
- A `command` that is not on `PATH`. When Localix knows the command, the note says it installs on
  first use instead (see below). Otherwise it names what the server needs, for example
  `csharp-ls not found on PATH — needs the .NET SDK (dotnet tool install -g csharp-ls)`.

### Plugin servers without Node or npm

Claude Code's LSP plugins name a server and assume it is installed, often with `npm i -g`. Localix
assumes neither Node nor npm. A plugin server whose `command` is not on `PATH` is installed the
first time a matching file opens, with the same installer and status-bar states as the built-in
servers, when the command is one of these:

| `command`                                                                                                                                        | Installed                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| `typescript-language-server`                                                                                                                     | typescript-language-server 6.0.2 with TypeScript 5.9.3 |
| `pyright-langserver`                                                                                                                             | Pyright 1.1.414                                        |
| `intelephense`                                                                                                                                   | Intelephense 1.18.5                                    |
| `vtsls`, `vscode-json-language-server`, `vscode-css-language-server`, `vscode-html-language-server`, `yaml-language-server`, `docker-langserver` | The package the built-in server of that name uses      |
| `rust-analyzer`                                                                                                                                  | The pinned rust-analyzer release                       |
| `gopls`                                                                                                                                          | gopls v0.24.0, built with your Go toolchain            |

The plugin's `args`, `env`, `initializationOptions` and other fields apply as written. A server that
is an npm package always runs with Localix's own Bun, also when it is found on `PATH`, so its
`#!/usr/bin/env node` line never needs a Node install. A `command` given as a path is the plugin's
own and is never replaced. Other servers name the toolchain they need: clangd (LLVM), jdtls (Java),
kotlin-language-server (a JDK), lua-language-server, sourcekit-lsp (Xcode or the Swift toolchain),
csharp-ls (the .NET SDK) and ruby-lsp (Ruby).

There is no LSP tool. The agent receives diagnostics inside `Edit` and `Write` results, and the
prompt line for a plugin server says so.

Executable lookup uses the API host's login-shell environment. The npm servers Localix installs
(TypeScript, JSON, CSS, HTML, YAML, Dockerfile) run from their install first and use the project's
`node_modules/.bin` only while that install is missing; they are never taken from `PATH`. Other
npm-based servers look in the project's `node_modules/.bin` first, then `PATH`. Project lookup never
goes above the project root. A missing `PATH` executable is cached for 60 seconds, so installing it
may require another attempt after that interval. A found `PATH` location is cached until the API
restarts; restart after moving an executable or changing the launch environment.

## Changes made outside Localix

A file created, changed, or deleted in the session's folder by something other than the agent — a
terminal edit, a build, a branch switch — reaches the project's running language servers as
`workspace/didChangeWatchedFiles`, from the same local watcher that refreshes the file tree. Each
server receives only the changes under its own root. A file open in the editor is left out: its
buffer is what the server checks, and the editor reloads it from disk itself.

- Local sessions only; an SSH or Docker session has no local watcher.
- Changes inside `.git`, `.hg`, or `.svn`, and inside an installed package under `node_modules`, are
  not sent.
- A burst of more than 1,024 changed paths in one settled batch is not sent at all. Servers then
  keep their current view of those files until they are touched again or the server restarts.

## Limits

- Java, C/C++, C#, Ruby, PHP, Swift, Kotlin, Svelte, Markdown, Lua, shell, Zig, Dart, and Elixir
  have recognized language IDs but no built-in server definition.
- Language-server processes and executable discovery run on the API host. Selecting SSH or Docker
  for file tools does not start an LSP server there. Remote editing can work while language services
  remain unavailable; the server needs a usable local root and dependencies on the API host.
- Built-in definitions win over plugin definitions. A plugin server never registers an extension a
  built-in definition handles, even when the built-in executable is missing or still installing.
- The first file of a language needs a network connection (and Go, for Go files without `gopls`).
  Vue and Deno are not installed: they need `vue-language-server` in the project and `deno` on
  `PATH`.
- Rename and code actions apply text edits only. Workspace file-create, file-rename, and file-delete
  operations are skipped. Attached commands are not executed, even when an action also has edits.
- Disk writes for a multi-file rename or code action are independent. A write failure does not undo
  earlier changes or stop later files; the backend returns changed and failed files. Unreadable
  files and unchanged edits are skipped without a failure entry.
- Buffer fingerprints describe the tracked text when the edit reply is prepared. They detect later
  buffer changes, but do not validate a language server's document version. Disk hashes protect
  changes between the local read and write, not changes since the server computed its edits. If you
  change a document while a refactor is being computed, review the result and repeat it if needed.
- The `<editor_buffer>` note covers files open in the same user's editor. It reflects the buffer as
  of the editor's last sync, which follows typing by about 40 ms.
- Initialization waits up to 30 seconds. Editor feature requests generally wait up to three seconds;
  waiting for pushed diagnostics has a six-second budget. A timeout can return a neutral result.
- Diagnostics are not a build or test result. An empty response can mean clean code, no matching
  server, a missing capability, a timeout, or a server failure.

## Service restarts

File and directory reads recover automatically during a brief local service restart. A new file
shows a short reconnecting status; an already loaded buffer stays visible. The first recoverable
connection failure starts a 30-second retry window, and reconnecting wakes a pending retry
immediately. This window limits retries; it does not impose a deadline on each individual read.
Closing the editor cancels its initial read. If recovery expires, the editor keeps the reconnecting
status and retries when the connection returns. Missing or unreadable files retain their error, and
writes are not replayed.

After reconnecting, the editor reopens its live buffer for language services and checks disk changes
through the existing conflict policy, preserving unsaved edits.

## Related guides

- [Workspace](workspace.md)
- [Install Claude Code plugins](../extending/claude-code-plugins.md)
- [Capabilities](capabilities.md)
- [Visual Feedback](visual-feedback.md)

## Source of truth

- [Language IDs](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/lsp/lsp-languages.ts)
- [Built-in server definitions](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/lsp/lsp-servers.ts)
- [Executable discovery and cache](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/lsp/lsp-bin-resolve.ts)
- [Manager selection and lifecycle](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/lsp/lsp-manager.ts)
- [Buffer versus disk routing](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/lsp/edit-routing.ts)
- [Independent disk edit commits](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/lsp/edit-commit.ts)
- [Workspace edit normalization](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/lsp/lsp-normalize-edits.ts)
- [Document synchronization and edits](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/lsp/service.ts)
- [Editor request behavior](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/lsp/lsp-editor-features.ts)
- [Plugin server subset](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/lsp/lsp-plugin-servers.ts)
- [Automatic diagnostics report](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/lsp/diagnostics-report.ts)
- [Read retry policy](https://github.com/rsaryev/localix/blob/main/apps/ui/src/shared/api/readRecovery.ts)
- [Visible-document lifecycle](https://github.com/rsaryev/localix/blob/main/apps/ui/src/features/inspector/ui/useFileEditorLsp.ts)
- [Reconnect recovery](https://github.com/rsaryev/localix/blob/main/apps/ui/src/features/inspector/ui/useFileConnectionRecovery.ts)
- [Editor providers](https://github.com/rsaryev/localix/blob/main/apps/ui/src/shared/ui/code-editor/monaco/providers.ts)
