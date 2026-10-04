# Use language server features

Localix routes editor intelligence and agent refactors through an API-managed Language Server
Protocol (LSP) layer. Use it for diagnostics, semantic navigation, rename, code actions, and
formatting without leaving the workspace.

**Availability:** Each result depends on a matching server executable and the response it returns.
Plain editing and text search continue without one.

## What you can do

| Capability                                                     | Product surface                                                        | Boundary                                                                |
| -------------------------------------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Diagnostics                                                    | Editor markers, Problems, and feedback appended after agent file edits | Agent feedback contains errors only; the editor receives every severity |
| Completion, hover, signature help, and inlay hints             | Editor                                                                 | An unsupported or failed request returns an empty or neutral result     |
| Definitions, references, implementations, and type definitions | Editor                                                                 | The server must return a resolvable file URI                            |
| Document and workspace symbols                                 | Editor breadcrumbs, workspace symbol search, and `read` outline mode   | Workspace search queries servers already running for the project        |
| Rename                                                         | Editor                                                                 | Files nobody has open are written one at a time                         |
| Quick fixes and source actions                                 | Editor and the Problems panel                                          | Command-only actions are not executed                                   |
| Document formatting                                            | Editor format and save flows                                           | The server must advertise document formatting                           |

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

Several tabs, split panes, or sessions can hold the same document. Localix sends `didClose` only
after the last holder releases it. A client with no open documents stops after five minutes.

A missing executable, failed initialization, crash, or closed transport removes the client. A later
request can start it again, but the manager does not switch to a second matching definition during
the failed attempt.

### Editor edits, saves, and diagnostics

A language server computes every edit against the editor's live buffer, so edits for an open file go
to that buffer, not to disk:

- **Quick fix and rename.** Files an editor holds open receive the edit as one undoable step. Files
  nobody has open are written to disk. An editor whose text changed since the request refuses the
  edit and says so.
- **Formatting.** Format Document edits the buffer in place. Format-on-save formats the buffer in
  memory and writes it to disk once.
- **Save.** The server receives `didSave` only when the editor actually writes the file. Typing
  never sends it, so servers that check on save do not re-check on every pause.

Each request (completion, hover, a quick fix) first sends any unsynced buffer edits, so the answer
matches the text on screen. Diagnostics tagged unnecessary are drawn faded (unused variables,
imports, parameters, unreachable code). Diagnostics tagged deprecated are struck through.

### How the agent sees it

The agent has no language-server tools. Their schemas cost more tokens on every request than `read`,
`write`, `search`, and `apply_patch` combined, and `search` + `read` already navigate. The language
server reaches the agent by annotating the file tools' results:

| Annotation          | Where                                          | What it says                                                                           |
| ------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------- |
| `<lsp_diagnostics>` | `write`, `edit`, `apply_patch` results         | Errors the change introduced; no report is not proof that a build or test passes       |
| `<editor_buffer>`   | `read`, `write`, `edit`, `apply_patch` results | The file is open in the editor with unsaved edits the disk text lacks, shown as a diff |
| Outline             | `read` with `mode:'outline'`                   | The file's document symbols                                                            |

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

“Built-in” means Localix knows how to find a root and launch the server. Some executables are API
dependencies; others must exist in the project or on `PATH`.

| Definition | Matching files                                                      | Executable source                                |
| ---------- | ------------------------------------------------------------------- | ------------------------------------------------ |
| Deno       | TypeScript and JavaScript inside a `deno.json` or `deno.jsonc` root | `deno` on `PATH`                                 |
| TypeScript | TypeScript and JavaScript outside a Deno root                       | Bundled `vtsls`; project TypeScript is preferred |
| Vue        | `.vue`                                                              | Project `vue-language-server`                    |
| Python     | `.py`                                                               | `pylsp`, then `pyright-langserver`, on `PATH`    |
| Go         | `.go`                                                               | `gopls` on `PATH`                                |
| Rust       | `.rs`                                                               | `rust-analyzer` on `PATH`                        |
| HTML       | `.html`, `.htm`                                                     | Project or `PATH` `html-languageserver`          |
| JSON       | `.json`, `.jsonc`                                                   | Bundled `vscode-json-language-server`            |
| CSS        | `.css`, `.scss`, `.less`                                            | Bundled `vscode-css-language-server`             |
| Dockerfile | Dockerfile names and `.dockerfile`                                  | Bundled `docker-langserver`                      |
| YAML       | `.yaml`, `.yml`                                                     | Bundled `yaml-language-server`                   |

## Configuration

There is no general LSP settings page or per-language enable switch. Install the executable named
above, or enable a plugin that contributes an `lspServers` map.

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

| Plugin field            | Runtime effect                                                                                  |
| ----------------------- | ----------------------------------------------------------------------------------------------- |
| `command`               | Resolves the executable on `PATH`                                                               |
| `args`                  | Adds command arguments                                                                          |
| `extensionToLanguage`   | Uses the extension keys for matching; document `languageId` still comes from Localix's file map |
| `initializationOptions` | Sends the object in the server initialize request                                               |
| `env`                   | Adds environment variables to the stdio process                                                 |

Plugin servers use stdio and the project root.

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
- Plugin `extensionToLanguage` values do not extend the document language-ID map. An unknown custom
  extension is sent as `plaintext` even when its key selects a plugin server.
- `startupTimeout`, `transport`, `settings`, `workspaceFolder`, `maxRestarts`, and `diagnostics` in
  a plugin declaration do not change runtime behavior.
- Built-in definitions are considered before plugin definitions. A built-in match prevents a plugin
  fallback even when the built-in executable is missing.
- A multi-file rename or code action is not transactional for files nobody has open. A concurrent
  edit can reject one file after earlier files were written; the result lists changed and failed
  files.
- The `<editor_buffer>` note covers files open in the same user's editor. It reflects the buffer as
  of the editor's last sync, which follows typing by about 40 ms.
- Diagnostics are not a build or test result. An empty response can mean clean code, no matching
  server, a missing capability, a timeout, or a server failure.

## Service restarts

File and directory reads recover automatically during a brief local service restart. A new file
shows a short reconnecting status; an already loaded buffer stays visible. Transient connection
failures retry for up to 30 seconds, and reconnecting wakes a pending retry immediately. Closing the
editor cancels its initial read. If recovery expires, the editor keeps the reconnecting status and
retries when the connection returns. Missing or unreadable files retain their error, and writes are
not replayed. After reconnecting, the editor reopens its live buffer for language services and
checks disk changes through the existing conflict policy, preserving unsaved edits.

## Related guides

- [Workspace](workspace.md)
- [Plugins](../extending/plugins.md)
- [Capabilities](capabilities.md)
- [Visual Feedback](visual-feedback.md)

## Source of truth

- [Language IDs](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/lsp/lsp-languages.ts)
- [Built-in server definitions](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/lsp/lsp-servers.ts)
- [Manager selection and lifecycle](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/lsp/lsp-manager.ts)
- [Document synchronization and edits](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/lsp/service.ts)
- [Editor request behavior](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/lsp/lsp-editor-features.ts)
- [Plugin server subset](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/lsp/lsp-plugin-servers.ts)
- [Automatic diagnostics report](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/lsp/diagnostics-report.ts)
- [Editor providers](https://github.com/rsaryev/localix/blob/main/apps/ui/src/shared/ui/code-editor/monaco/providers.ts)
