# `@localixai/api`

This workspace-private application is Localix's local backend and is not a supported external API
package. It composes the agent runtime, persistence, plugins, task engine, tools, HTTP routes,
WebSockets, and process lifecycle behind the desktop, browser, and headless clients.

## Consumers

The web UI imports the client contract and dependency-light presentation leaves. The Database plugin
UI imports a client-side model-routing helper. The desktop build bundles the `src/index.ts` entry,
which attaches to a compatible runtime or starts one in-process. The `localix` executable in this
package starts that entry and serves a pre-built UI. The separate CLI workspace builds a desktop
launcher; it does not bundle this backend.

## Entry points

The table highlights common seams. The package manifest is the complete export inventory.

| Entry point                                                                      | Contract                                                                                                                       |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| [`localix`](./bin/localix)                                                       | Resolves a built UI, defaults the combined server to port 5050, then executes the backend entry.                               |
| [`@localixai/api`](./src/index.ts)                                               | Starts, attaches to, or ensures a managed runtime and returns its address plus an idempotent stop handle.                      |
| [`@localixai/api/bootstrap`](./src/bootstrap.ts)                                 | Composes the Hono app, Bun WebSocket handler, services, plugin hosts, post-listen work, cache warming, and shutdown resources. |
| [`@localixai/api/client`](./src/client.ts)                                       | Exposes the typed Hono app contract plus client-safe DTOs, limits, catalogs, and presentation helpers.                         |
| [`@localixai/api/slash-catalog`](./src/features/chat/slash-catalog.ts)           | Owns built-in slash-command metadata, argument parsing, suggestions, grouping, and command descriptions.                       |
| [`@localixai/api/slash-match`](./src/features/chat/slash-match.ts)               | Scores exact, prefix, word, description, and fuzzy slash-command matches.                                                      |
| [`@localixai/api/context-refs`](./src/contracts/context-refs.ts)                 | Parses and builds context references, manages mention tokens, and classifies expansion budgets.                                |
| [`@localixai/api/item-format`](./src/features/chat/item-format.ts)               | Supplies tool-action labels, standalone-tool policy, and text or patch change counts.                                          |
| [`@localixai/api/loops-format`](./src/features/loops/format.ts)                  | Formats loop cadence, previews, countdowns, holds, and last-run status.                                                        |
| [`@localixai/api/preview-actions`](./src/contracts/preview-actions.ts)           | Exposes the `browser` tool's action union without importing the server implementation.                                         |
| [`@localixai/api/queue-presentation`](./src/features/chat/queue-presentation.ts) | Derives queue-item actions and delivery labels from queue state.                                                               |
| [`@localixai/api/secrets-limits`](./src/features/secrets/limits.ts)              | Exposes secret key and value limits, the key pattern, and its user-facing hint.                                                |
| [`@localixai/api/session-ref`](./src/contracts/session-ref.ts)                   | Formats a numeric session sequence as its stable display reference.                                                            |
| [`@localixai/api/tool-names`](./src/features/agent-core/tool-names.ts)           | Owns the built-in tool catalog, categories, and namespace reserved against plugin shadowing.                                   |
| [`@localixai/api/wire-tools`](./src/features/tools/wire-tools.ts)                | Finds tool names advertised to a model but absent from the executable tool set.                                                |
| [`@localixai/api/terminal-emulator`](./src/features/terminal/emulator.ts)        | Creates the headless terminal emulator that renders a PTY's screen for panes and agent reads.                                  |
| [`@localixai/api/wake-provenance`](./src/features/chat/wake-provenance.ts)       | Validates, labels, and derives session wake sources from transcript rows.                                                      |
| [`@localixai/api/ws-frame`](./src/features/ext/ws-frame.ts)                      | Encodes session cursors, compares replay positions, and parses multiplexed WebSocket frames.                                   |

The workspace currently has no source importer for the explicit `bootstrap` or `terminal-emulator`
subpaths. They remain declared boundaries, not permission to import other backend source files.

## Limits

- The server defaults to `127.0.0.1:5051` and a single local user. Its request identity is a
  sanitized caller-supplied header. The origin boundary checks loopback Host names, an explicit set
  of allowed browser origins, and non-browser mutation headers; it is not authentication or a
  multi-tenant boundary.
- One process owns a database runtime at a time. Managed startup may attach to a compatible live
  runtime, while incompatible runtime descriptors are stopped before replacement.
- `@localixai/api/client` exports contracts and pure values, not a configured network client. Each
  UI constructs transport against the runtime address it was given.
- The typed `App` excludes the dependency-free health route and dynamically mounted plugin routes.
  Generic plugin WebSocket frames are also resolved through a runtime registry.
- The root and bootstrap entries require Bun and local process, filesystem, SQLite, and child-tool
  access. Only the dedicated client and leaf subpaths are intended for browser bundles.
- Export-map paths are workspace compatibility seams. The package is private, and source files not
  listed in `package.json` are not supported imports.

## Source of truth

- [Package manifest and export map](./package.json)
- [Managed runtime lifecycle](./src/index.ts)
- [Runtime composition](./src/bootstrap.ts)
- [HTTP and WebSocket route composition](./src/app.ts)
- [Client contract barrel](./src/client.ts)
- [Request origin boundary](./src/lib/local-origin-guard.ts)
- [Request identity](./src/lib/request-identity.ts)
