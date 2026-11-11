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
  labels) and the dedicated `island` webview. Browser-hosted UI sessions do not receive this native
  bridge, and the UI must tolerate missing commands.
- Local builds require Bun plus the native Rust toolchain and platform prerequisites. The
  `tauri:check` script deliberately exits successfully after a visible skip when Rust or Clippy is
  unavailable.

## Capabilities

[`src-tauri/capabilities/default.json`](./src-tauri/capabilities/default.json) is the entire plugin
IPC surface: trusted workspace webviews use `main` or generated `workspace-*` labels; the trusted
`island` webview hosts the top-edge agent island outside the workspace/tab registry. Its lifecycle,
layout and session-handoff commands validate the calling webview. Browser children use distinct
`browser-*` labels and receive no capability. `app.security.capabilities` names only this file, and
`build.removeUnusedCommands` strips every plugin command no permission here admits. That matters
more than usual because `withGlobalTauri` publishes `window.__TAURI__` to the document, and the
content-security policy lets a plugin panel iframe load libraries from four public CDNs — so a
granted permission is a permission reachable by code the app did not write.

Two rules decide what belongs here, and only the second is obvious:

1. A permission is needed when the **UI calls it**. All the UI has is
   [`apps/ui/src/shared/lib/tauri.ts`](../ui/src/shared/lib/tauri.ts): `core.invoke`,
   `event.listen`, and the current window's `isFullscreen()`. Hence `core:default` plus
   `start-dragging` (what `data-tauri-drag-region` invokes behind the custom titlebar). The dock
   badge goes through the Rust `set_badge` command and needs no capability.
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

Capabilities gate **plugin** commands. The app's own `#[tauri::command]`s are not gated by them:
with no `AppManifest` in `build.rs`, Tauri checks an app command only for a remote origin (`tauri`
2.11.5, `webview/mod.rs:1823`), so every webview serving the app's own origin may call every app
command. What keeps a browser page out is that its origin is remote and no capability has `remote`
URLs, and that `native_browser::navigable` never loads the app's origin. Plugin views are
opaque-origin `sandbox="allow-scripts"` frames with no invoke key. A standalone mini app runs in a
plain `WKWebView` with no Tauri IPC at all.
[`tauri-security.test.ts`](./scripts/tauri-security.test.ts) holds these lines.

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
`srcdoc` iframes ([`miniAppPanelSrcDoc.ts`](../ui/src/features/inspector/ui/miniAppPanelSrcDoc.ts))
that carry their own, much stricter `<meta>` policy — but a `srcdoc` frame INHERITS the parent
policy and the two intersect. Removing a host here silently removes it from every plugin view, no
matter what the view's own CSP allows. The single source for the list is `PANEL_CDN_HOSTS` in that
file; keep this policy a superset of it (`miniAppPanelSrcDoc.test.ts` fails when it is not).

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

## The app icon

One vector, `assets/logo.svg` (the bird), and one generator,
[`scripts/app-icons.mjs`](../../scripts/app-icons.mjs), make every file in `src-tauri/icons/`. Never
edit them by hand: `bun scripts/app-icons.mjs --write` redraws the set (macOS: it packs the `.icns`
with `iconutil`), and `check:generated` fails when the set is stale or edited. `generated.json`
records the digests that check compares.

- **macOS** follows Apple's grid: an 824 px plate, 100 px from each edge of the 1024 canvas, with
  corner radius 185.4. It has no baked shadow, because the system draws the shadow (HIG, "App
  icons"). macOS 26 masks an `.icns` of that shape to its own rounded rectangle (WWDC25 session
  220). The icon tested masked cleanly on 26.6, without the gray backing a full-bleed square gets.
  macOS 13 to 15 show it as drawn. SVG `rx` is a circular corner, not Apple's continuous one; the
  difference is visible only before 26. LLX Desk drew the same bird on a larger 896 plate, and that
  plate stays for Windows and Linux, which mask nothing.
- **Every raster** is drawn at its own size from the vector by `tauri icon`, so nothing is scaled up
  from a smaller raster. `icon.png` (512) comes first in `bundle.icon`, because Linux takes its
  window icon from the first PNG there.
- **Menu bar**: `tray-template.png` is the bird alone in black, 36 px for an 18 pt bar at 2x, set
  with `icon_as_template` so AppKit tints it for the bar. Windows and Linux trays show `64x64.png`
  in colour.
- **Badge**: the macOS Dock badge is the system's own (`NSDockTile` badge label, via
  `set_badge_count`), as in LLX Desk. A count goes there; it never bounces or animates. Windows has
  no numeric badge, so `badge-overlay.png` (a 32 px red dot) is set on every workspace window.
- **Icon Composer (`.icon`)**: the bundler (2.10) accepts a `.icon` in `bundle.icon`. It compiles
  the file with `actool` into `Assets.car` and sets `CFBundleIconName`, and the `.icns` stays as the
  fallback for macOS before 26. To adopt it: author the layered icon in Icon Composer (the format is
  undocumented, so never generate it), commit it next to the `.icns`, add it to `bundle.icon`, and
  build releases with Xcode 26 or later selected (`xcode-select`), so `actool` is on `PATH`.

## Tauri practices

Rules this shell follows, checked against the Tauri 2 docs for the installed versions (`tauri`
2.11.5, CLI 2.12.4):

- **IPC**: a capability names its webviews explicitly and never matches `browser-*`. No capability
  has `remote` URLs. Plugins the shell drives from Rust (`shell`, `updater`, `deep-link`,
  `window-state`, `dialog`, `fs`) get no permission, and `removeUnusedCommands` stays on. An app
  command that acts on a window checks its calling webview. A command that takes a path, URL or
  label validates it in Rust: the page's checks are not the boundary.
- **Content**: the CSP stays present, with `default-src 'self'`, `object-src 'none'`,
  `base-uri 'self'` and no `'unsafe-eval'`. Tauri's nonce and hash injection stays on, and the asset
  protocol stays off: files reach the page through the API sidecar. `withGlobalTauri` is read only
  by `apps/ui/src/shared/lib/tauri.ts`.
- **Navigation**: every Tauri webview gets `on_navigation` and `on_new_window`. App URLs stay;
  loopback stays, for the Preview frame; `http(s)`, `mailto` and `tel` go to the system handler;
  anything else is denied.
- **Process**: the Bun sidecar binds `127.0.0.1` on a reserved port and receives only its port,
  parent pid and launch id. It is stopped gracefully, then killed with its tree, on every exit path.
  The updater is compiled only into release builds (`cfg(localix_updater)`), with its public key
  from `updater.release.json`.
- **Build**: the release profile is `lto = "fat"`, `codegen-units = 1`, `opt-level = "s"`,
  `panic = "abort"` and `strip = true`. Devtools are not a `tauri` feature, so a release build has
  none.

`scripts/tauri-security.test.ts` guards the IPC and content rules.

## Source of truth

- [Package scripts](./package.json)
- [Native dependency manifest](./src-tauri/Cargo.toml)
- [Desktop and bundle configuration](./src-tauri/tauri.conf.json)
- [Application composition](./src-tauri/src/lib.rs)
- [Sidecar staging](./scripts/prepare-sidecar.mjs)
- [Main-window capabilities](./src-tauri/capabilities/default.json)
- [IPC and content guards](./scripts/tauri-security.test.ts)
- [App icon generator](../../scripts/app-icons.mjs)
- [Native chrome measurement](./src-tauri/src/native_chrome.rs)
- [Window material](./src-tauri/src/window_material.rs)
- [Native tab controls](./src-tauri/src/native_tab_controls.rs)
- [Workspace lifecycle](./src-tauri/src/workspace_lifecycle.rs)
- [Workspace visibility](./src-tauri/src/workspace_visibility.rs)
- [Workspace identity and routing](./src-tauri/src/workspace_windows.rs)
- [Bounded frontend flush](./src-tauri/src/frontend_flush.rs)
- [Native tab smoke-check runner](./scripts/check-native-tabs.mjs)
