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

| Entry point                                                    | Contract                                                                                                                                         |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`src-tauri/src/main.rs`](./src-tauri/src/main.rs)             | Native executable entry; delegates application construction to the library.                                                                      |
| [`src-tauri/src/lib.rs`](./src-tauri/src/lib.rs)               | Builds the single-instance app, main window, native plugins, menus, navigation policy, sidecar lifecycle, and UI command registry.               |
| [`src-tauri/src/commands.rs`](./src-tauri/src/commands.rs)     | Implements notifications, external URLs, theme, title, badge, save and pick dialogs, file-drop paths, restart, and frontend logs.                |
| [`src-tauri/src/deeplink.rs`](./src-tauri/src/deeplink.rs)     | Buffers and forwards `localix://` URLs, converts opened paths to deep links, and gates webview navigation.                                       |
| [`src-tauri/src/menu.rs`](./src-tauri/src/menu.rs)             | Builds application and tray menus and accepts recent-session, project, and active-project state from the UI.                                     |
| [`src-tauri/src/sidecar.rs`](./src-tauri/src/sidecar.rs)       | Selects a loopback port, starts or attaches the packaged API child, reports readiness, and performs bounded shutdown.                            |
| [`src-tauri/src/updater.rs`](./src-tauri/src/updater.rs)       | Checks the configured endpoint, retains the pending update handle, verifies its download on install, streams progress, and restarts.             |
| [`src-tauri/src/supervisor.rs`](./src-tauri/src/supervisor.rs) | Decides when a crashed runtime is started again (a sliding window with a growing pause) and notices a hung one by asking `/health` on a beat.    |
| [`tauri:resilience`](./scripts/check-resilience.mjs)           | Launches the packaged app and kills, freezes and quits its runtime, checking that each is recovered. A local check on a `tauri:build`.           |
| [`tauri:dev`](./scripts/dev-servers.mjs)                       | Stages build prerequisites and runs the shared API-and-Vite development supervisor under the desktop process.                                    |
| [`tauri:build`](./scripts/run-tauri.mjs)                       | Builds a local native bundle after staging the UI, API, plugins, CLI, migrations, and Bun sidecar.                                               |
| [`tauri:release`](./scripts/run-tauri.mjs)                     | Compiles the updater in, enables updater artifacts and, on macOS, requires signing credentials and notarizes the produced app and DMG.           |
| [`tauri:check`](./scripts/check-rust.mjs)                      | Stages build-script prerequisites and runs rustfmt, locked Clippy, and the locked Rust tests; reports a skip when Rust or Clippy is unavailable. |

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
- The command capability applies to trusted workspace webviews (`main` and generated `workspace-*`
  labels). Browser-hosted UI sessions do not receive this native bridge, and the UI must tolerate
  missing commands.
- Local builds require Bun plus the native Rust toolchain and platform prerequisites. The
  `tauri:check` script deliberately exits successfully after a visible skip when Rust or Clippy is
  unavailable.

## Capabilities

[`src-tauri/capabilities/default.json`](./src-tauri/capabilities/default.json) is the entire plugin
IPC surface: trusted workspace webviews use `main` or generated `workspace-*` labels; browser
children use distinct `browser-*` labels and receive no capability. `app.security.capabilities`
names only this file, and `build.removeUnusedCommands` strips every plugin command no permission
here admits. That matters more than usual because `withGlobalTauri` publishes `window.__TAURI__` to
the document, and the content-security policy lets a plugin panel iframe load libraries from four
public CDNs — so a granted permission is a permission reachable by code the app did not write.

Two rules decide what belongs here, and only the second is obvious:

1. A permission is needed when the **UI calls it**. All the UI has is
   [`apps/ui/src/shared/lib/tauri.ts`](../ui/src/shared/lib/tauri.ts): `core.invoke`,
   `event.listen`, and the current window's `isFullscreen()` / `setBadgeCount()`. Hence
   `core:default` plus `set-badge-count` (not in the core defaults) and `start-dragging` (what
   `data-tauri-drag-region` invokes behind the custom titlebar).
2. A permission is also needed when a **plugin injects a JavaScript shim**. The current capability
   grants `opener:allow-open-url` and `opener:allow-default-urls` for the opener's click handler,
   and `notification:allow-is-permission-granted` for the notification permission probe. These are
   narrower than either plugin's default permission set. Native dialogs, notifications, and links
   also have shell-owned Rust commands; registering a plugin does not grant all its JavaScript
   commands.

Deliberately **absent**, because the shell drives them from Rust and no JavaScript touches them —
the plugin's Rust `…Ext` traits do not go through the ACL, so removing the permission removes only
the webview's ability to call them:

| Plugin         | Used from                                    | Why the webview must not reach it                         |
| -------------- | -------------------------------------------- | --------------------------------------------------------- |
| `updater`      | `updater_check` / `updater_install` commands | `plugin:updater\|download_and_install` runs an installer. |
| `deep-link`    | `on_open_url` / `get_current` in `lib.rs`    | Scheme (de)registration is a launch-time concern.         |
| `window-state` | the plugin's own save/restore hooks          | Geometry is restored on the window the shell builds.      |
| `shell`        | `sidecar.rs` (the Bun sidecar)               | `plugin:shell\|execute` would be arbitrary execution.     |

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

The shell opens clicked links in the person's GUI session. The sidecar owns filesystem handoffs and
may run in a different session or on another machine. Both paths report handler failures. The shell
logs external-link attempts; `@localixai/os-open` records attempts only when its caller supplies a
logger, and bounds its wait for an opener to 15 seconds by default. A successful handoff means the
handler accepted the request, not that the destination is visibly open.

### The CSP is not as loose as it looks

`app.security.csp` allows scripts and styles from four public CDNs. That is not a convenience for
the app shell, which loads nothing from them — it is load-bearing for plugin views. They are
`srcdoc` iframes ([`pluginPanelSrcDoc.ts`](../ui/src/features/inspector/ui/pluginPanelSrcDoc.ts))
that carry their own, much stricter `<meta>` policy — but a `srcdoc` frame INHERITS the parent
policy and the two intersect. Removing a host here silently removes it from every plugin view, no
matter what the view's own CSP allows. The single source for the list is `PANEL_CDN_HOSTS` in that
file; keep this policy a superset of it (`pluginPanelSrcDoc.test.ts` fails when it is not).

## Native workspace tabs (macOS)

Command+T and the native tab bar's + action create an independent workspace WebView in an AppKit
window tab. `workspace_builder.rs` uses a full-size content overlay so the native window buttons and
HTML breadcrumb toolbar share one row. `native_chrome.rs` measures the button gap and observes
AppKit's KVO-compliant `contentLayoutRect`, reserving a separate native tab band without polling.
Embedded browser bounds follow the resulting UI layout. `macos_tabs.rs` defers window tab operations
to the GCD main queue, outside Tao's event-handler lock.

`window_material.rs` places one appearance-aware vibrancy view behind the entire native frame, so
the titlebar and workspace share the same desktop-sampling material. Theme changes replace that
view; they do not stack another effect. The native tab band uses the UI's resolved `--sidebar`
colour and alpha unchanged. The UI stamps its platform selectors before sampling this token at
startup, so the native header receives the macOS coat density. The coat paints between AppKit's
content layout and the shared toolbar row. The UI paints the toolbar itself, so its background is
never applied twice.

`native_tab_controls.rs` removes the new-tab button's bezel through public `NSButton` properties,
keeping its native action and hit target. The bounded view search accommodates Tahoe's button
subclass and reapplies the treatment when AppKit rebuilds the tab bar.

On Tahoe, `native_titlebar_backdrop.rs` suppresses AppKit's extra titlebar background and clears its
layer fill, following
[Ghostty's transparent titlebar implementation](https://github.com/ghostty-org/ghostty/blob/main/macos/Sources/Features/Terminal/Window%20Styles/TransparentTitlebarTerminalWindow.swift).
This optional hook uses internal view names with public view operations; a missing hierarchy is a
no-op. Focus and tab operations resync the appearance after AppKit can rebuild these views.

`workspace_windows.rs` tracks trusted identities and selected-window routing. Workspace and browser
WebViews are addressed separately from their Window: Tauri's `get_webview_window` no longer finds a
window after child browser views are added. Each browser child is named by its workspace and tab ID;
its events and commands stay in that workspace. Layout and navigation storage keys are
window-scoped, while account preferences and API-owned resources remain shared.

The native red window button and Window → Close Window flush and save the whole native group, then
hide it without destroying workspaces. `workspace_visibility.rs` handles this separately from native
tab close / Close Workspace Tab, which flush and remove one workspace. Dock reopen, tray Show and
external launches use one AppKit reveal path that preserves group selection and releases
minimization. New Workspace Window remains an explicit fresh-workspace action.

Quit requests a flush from all workspaces under one bounded budget. An unresponsive workspace may
leave pending writes unsaved. Request IDs and caller labels prevent a stale or duplicate
acknowledgement from releasing another window. The last workspace hides instead of exiting. A clean
quit snapshots native tab groups from AppKit and restores stable labels, routes, group order and
selected tabs on launch.

Run the live AppKit smoke check on a Mac with a desktop session:

```bash
bun run --cwd apps/desktop-tauri tauri:tabs
```

It starts deterministic local HTML with a separate app identifier and no API process. A debug-only
`workspace_probe` reads actual native groups, geometry and child ownership; this command is absent
from release builds. It checks the native + action, close, clean quit, and tab order, selection and
outer geometry after restart. Manual visual checks still cover vibrancy in both appearances,
fullscreen, mouse-driven tab reordering and detaching, and the native + button's appearance.

## Source of truth

- [Package scripts](./package.json)
- [Native dependency manifest](./src-tauri/Cargo.toml)
- [Desktop and bundle configuration](./src-tauri/tauri.conf.json)
- [Application composition](./src-tauri/src/lib.rs)
- [Sidecar staging](./scripts/prepare-sidecar.mjs)
- [Main-window capabilities](./src-tauri/capabilities/default.json)
- [Native chrome measurement](./src-tauri/src/native_chrome.rs)
- [Window material](./src-tauri/src/window_material.rs)
- [Native tab controls](./src-tauri/src/native_tab_controls.rs)
- [Workspace lifecycle](./src-tauri/src/workspace_lifecycle.rs)
- [Workspace visibility](./src-tauri/src/workspace_visibility.rs)
- [Workspace identity and routing](./src-tauri/src/workspace_windows.rs)
- [Bounded frontend flush](./src-tauri/src/frontend_flush.rs)
- [Native tab smoke-check runner](./scripts/check-native-tabs.mjs)
