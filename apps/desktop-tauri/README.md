# `@localixai/desktop-tauri`

This workspace-private application is Localix's native desktop host and is not a reusable external
crate or JavaScript package. It embeds the UI, manages the packaged Bun API sidecar, and translates
operating-system lifecycle, menu, file, notification, update, and navigation events for the UI.

## Consumers

The repository's `dev`, `build:desktop`, and `release:desktop` scripts invoke this package. Its
production build consumes the UI build, API entry, migrations, bundled plugins, CLI shim, and a
staged Bun binary. The UI consumes the command and event bridge exposed to the main webview;
operating-system launch services consume the app binary, registered `localix` scheme, and declared
file associations.

## Entry points

| Entry point                                                | Contract                                                                                                                                         |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`src-tauri/src/main.rs`](./src-tauri/src/main.rs)         | Native executable entry; delegates application construction to the library.                                                                      |
| [`src-tauri/src/lib.rs`](./src-tauri/src/lib.rs)           | Builds the single-instance app, main window, native plugins, menus, navigation policy, sidecar lifecycle, and UI command registry.               |
| [`src-tauri/src/commands.rs`](./src-tauri/src/commands.rs) | Implements notifications, external URLs, theme, title, badge, save and pick dialogs, file-drop paths, restart, and frontend logs.                |
| [`src-tauri/src/deeplink.rs`](./src-tauri/src/deeplink.rs) | Buffers and forwards `localix://` URLs, converts opened paths to deep links, and gates webview navigation.                                       |
| [`src-tauri/src/menu.rs`](./src-tauri/src/menu.rs)         | Builds application and tray menus and accepts recent-session, project, and active-project state from the UI.                                     |
| [`src-tauri/src/sidecar.rs`](./src-tauri/src/sidecar.rs)   | Selects a loopback port, starts or attaches the packaged API child, reports readiness, and performs bounded shutdown.                            |
| [`src-tauri/src/updater.rs`](./src-tauri/src/updater.rs)   | Checks the configured endpoint, retains the pending update handle, verifies its download on install, streams progress, and restarts.             |
| [`tauri:dev`](./scripts/dev-servers.mjs)                   | Stages build prerequisites and runs the shared API-and-Vite development supervisor under the desktop process.                                    |
| [`tauri:build`](./scripts/run-tauri.mjs)                   | Builds a local native bundle after staging the UI, API, plugins, CLI, migrations, and Bun sidecar.                                               |
| [`tauri:release`](./scripts/run-tauri.mjs)                 | Compiles the updater in, enables updater artifacts and, on macOS, requires signing credentials and notarizes the produced app and DMG.           |
| [`tauri:check`](./scripts/check-rust.mjs)                  | Stages build-script prerequisites and runs rustfmt, locked Clippy, and the locked Rust tests; reports a skip when Rust or Clippy is unavailable. |

## Limits

- The Rust shell transports `localix://` URLs but does not own their product navigation grammar; the
  UI parses session, project, new-chat, prompt, and open-path destinations. macOS document URLs are
  converted to open-path links once; launch arguments also accept plain paths and local `file://`
  URLs. Cold opens queue until the UI installs its handler. The UI then waits for the local service
  and the destination project's conversation and editor before opening the file. Multiple file
  intents complete in arrival order, including across project switches.
- macOS uses LaunchServices for a bundle's single instance; the argv-based single-instance plugin
  runs only on Windows/Linux. Exiting a second macOS bundle during setup would discard its document
  Apple event, particularly when an unbundled development instance was already running.
- Development does not run the packaged sidecar. The Tauri development command supervises the API
  watcher and Vite server, while production starts the staged Bun runtime as a managed child.
- Ordinary builds have no updater: no key, no endpoint, and the plugin is not compiled in. Only
  `tauri:release` adds them, through an overlay generated from `updater.release.json`, and a usable
  release still requires the matching signing key and a published `latest.json`.
- Configured bundle targets and file associations describe packaging inputs, not evidence that a
  signed public artifact exists for every target.
- The command capability applies to the `main` window. Browser-hosted UI sessions do not receive
  this native bridge, and the UI must tolerate missing commands.
- Local builds require Bun plus the native Rust toolchain and platform prerequisites. The
  `tauri:check` script deliberately exits successfully after a visible skip when Rust or Clippy is
  unavailable.

## Capabilities

[`src-tauri/capabilities/default.json`](./src-tauri/capabilities/default.json) is the entire plugin
IPC surface: the app builds exactly one webview (label `main`), `app.security.capabilities` names
only this file, and `build.removeUnusedCommands` strips every plugin command no permission here
admits. That matters more than usual because `withGlobalTauri` publishes `window.__TAURI__` to the
document, and the content-security policy lets a plugin panel iframe load libraries from four public
CDNs — so a granted permission is a permission reachable by code the app did not write.

Two rules decide what belongs here, and only the second is obvious:

1. A permission is needed when the **UI calls it**. All the UI has is
   [`apps/ui/src/shared/lib/tauri.ts`](../ui/src/shared/lib/tauri.ts): `core.invoke`,
   `event.listen`, and the current window's `isFullscreen()` / `setBadgeCount()`. Hence
   `core:default` plus `set-badge-count` (not in the core defaults) and `start-dragging` (what
   `data-tauri-drag-region` invokes behind the custom titlebar).
2. A permission is also needed when the **plugin injects a JavaScript shim** that calls its own
   command — the shim is injected whether or not the permission is granted, so denying it does not
   remove an API, it leaves a broken one:
   - `opener:default` — the plugin intercepts clicks on `<a target="_blank">` and Cmd/Ctrl-clicks
     and invokes `plugin:opener|open_url`. Without it every external link in the app silently does
     nothing. (`open_external` in `commands.rs` goes through the Rust API and would still work,
     which is exactly why this failure would be so hard to attribute.)
   - `dialog:default` — the plugin replaces `window.alert` / `window.confirm`.
   - `notification:default` — the plugin replaces `window.Notification`.

Deliberately **absent**, because the shell drives them from Rust and no JavaScript touches them —
the plugin's Rust `…Ext` traits do not go through the ACL, so removing the permission removes only
the webview's ability to call them:

| Plugin         | Used from                                    | Why the webview must not reach it                    |
| -------------- | -------------------------------------------- | ---------------------------------------------------- |
| `updater`      | `updater_check` / `updater_install` commands | `plugin:updater                                      | download_and_install` runs an installer. |
| `deep-link`    | `on_open_url` / `get_current` in `lib.rs`    | Scheme (de)registration is a launch-time concern.    |
| `window-state` | the plugin's own save/restore hooks          | Geometry is restored on the window the shell builds. |
| `shell`        | `sidecar.rs` (the Bun sidecar)               | `plugin:shell                                        | execute` would be arbitrary execution.   |

Nothing grants `fs`, `http`, or the asset protocol: the UI reaches the filesystem and the network
through the local API sidecar, not through Tauri.

`app.security.capabilities` in [`tauri.conf.json`](./src-tauri/tauri.conf.json) names `default`
explicitly, so a capability file dropped into the directory does not widen the app by existing. The
corollary is the thing to remember: **a new capability file is inert until it is added to that
list.**

### Who hands what to the OS

| Target                                                    | Owner                                                                        | Why it is the owner                                                                                                                                         |
| --------------------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A URL a person clicked (`http`, `https`, `mailto`, `tel`) | This shell — `open_external` in [`commands.rs`](./src-tauri/src/commands.rs) | It runs in the process the person is looking at, inside their GUI session. The webview reaches it through one port: `platformCapabilities().external.open`. |
| A file, an application, a reveal                          | The API sidecar — [`@localixai/os-open`](../../packages/os-open/README.md)   | The webview has no filesystem; the sidecar does, and it is where the plugin `files` port already lives.                                                     |
| A `localix://` deep link from a shell prompt              | The CLI launcher — the same package                                          | There is no app process yet; the launcher's whole job is to reach one.                                                                                      |

The split is deliberate and must not be collapsed. Routing a browser open through the sidecar looks
like deduplication and is not: the sidecar is a different process, it can be started in a different
session, and on a hosted deployment it is not even on the person's machine — so "open this link"
would open it somewhere nobody is sitting. The thing that must not be duplicated is the CONTRACT,
and that is what the package and `open_external` share: wait for the opener, treat its exit status
as the answer, log every attempt (successes included, so an empty log cannot mean both "never
called" and "called and ignored"), and never fail quietly.

### The CSP is not as loose as it looks

`app.security.csp` allows scripts and styles from four public CDNs. That is not a convenience for
the app shell, which loads nothing from them — it is load-bearing for plugin views. They are
`srcdoc` iframes ([`pluginPanelSrcDoc.ts`](../ui/src/features/inspector/ui/pluginPanelSrcDoc.ts))
that carry their own, much stricter `<meta>` policy — but a `srcdoc` frame INHERITS the parent
policy and the two intersect. Removing a host here silently removes it from every plugin view, no
matter what the view's own CSP allows. The single source for the list is `PANEL_CDN_HOSTS` in that
file; keep this policy a superset of it (`pluginPanelSrcDoc.test.ts` fails when it is not).

## Source of truth

- [Package scripts](./package.json)
- [Native dependency manifest](./src-tauri/Cargo.toml)
- [Desktop and bundle configuration](./src-tauri/tauri.conf.json)
- [Application composition](./src-tauri/src/lib.rs)
- [Sidecar staging](./scripts/prepare-sidecar.mjs)
- [Main-window capabilities](./src-tauri/capabilities/default.json)
