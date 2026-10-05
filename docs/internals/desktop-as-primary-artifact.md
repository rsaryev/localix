# Desktop package and shell launcher

Localix packages the UI, API, CLI shim, plugins, migrations, and Bun runtime inside one Tauri
desktop application. Use this page to trace native builds, production startup, and the `localix`
command installed by the desktop runtime.

## Terminology

| Term             | Meaning                                                                | Boundary                                                              |
| ---------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Desktop bundle   | The Tauri application plus staged UI and runtime resources.            | A local bundle is not evidence of a signed public release.            |
| API sidecar      | The staged Bun executable running the bundled API on loopback.         | Development uses API and Vite watchers instead.                       |
| CLI shim         | The bundled JavaScript entry that loads the launcher bundle.           | It requires the staged Bun executable.                                |
| Shell launcher   | A user-owned `localix` script or command file written by the API.      | Its directory may still need to be added to `PATH`.                   |
| Path handoff     | A `localix://open` URL delivered through the operating-system handler. | The desktop UI and API resolve the path; the CLI does not inspect it. |
| Primary artifact | The package assembled and published by the desktop release workflow.   | The source CLI launcher path remains in the repository.               |

## What you can do

| Operation                   | Mechanism                                   | Boundary                                                           |
| --------------------------- | ------------------------------------------- | ------------------------------------------------------------------ |
| Develop the native app      | Run `bun run dev` from the repository root. | Requires Rust and platform-native Tauri dependencies.              |
| Build a local native bundle | Run `bun run build:desktop`.                | Builds only for the host platform and architecture.                |
| Exercise release packaging  | Run `bun run release:desktop`.              | Signing and macOS notarization inputs are required where relevant. |
| Install the shell launcher  | Use **Settings → General → Command line**.  | The installer writes no shell startup file or user `PATH` value.   |
| Open a project from a shell | Run `localix .` or `localix <directory>`.   | A registered desktop URL handler is required.                      |
| Open a file from a shell    | Run `localix <file>`.                       | The API opens its parent directory as the project.                 |

The [CLI guide](../features/cli.md) owns command parsing, flags, and exit statuses.

## How it works

### Native edit commands

The native Edit menu routes Select All, Undo, and Redo to the focused webview without changing
focus. `apps/desktop-tauri/src-tauri/src/deeplink.rs` calls the UI's `window.__localixEdit` bridge
only when that document has focus; other webviews retain DOM editing. Native Cut, Copy, and Paste
continue to deliver clipboard events.

`apps/ui/src/shared/lib/nativeEditing.ts` offers these commands to registered text owners before
falling back to ordinary DOM fields. `apps/ui/src/shared/ui/code-editor/monaco/nativeEditing.ts`
requires Monaco text focus, so split editors, a find query, and the composer cannot edit one
another's contents. Read-only editors allow Select All and reject history mutations. This avoids
AppKit operating on Monaco's hidden textarea instead of its document and undo stack.

While typing code, the workspace dispatcher leaves its default Cmd/Ctrl+K to Monaco for chord
sequences, and Cmd/Ctrl+Alt+Up/Down on macOS/Windows for multiple cursors. Those workspace commands
remain available outside code input, through the command palette, and after an explicit rebind.
Linux keeps its group shortcuts because Monaco uses Shift+Alt+Up/Down there. The policy lives in
`apps/ui/src/shared/lib/keybindings/editorKeyOwnership.ts`.

### Bundle staging

`prepare-sidecar.mjs` creates the production resource tree before Tauri builds the native shell.

| Staged input          | Packaged result                                      | Boundary                                                  |
| --------------------- | ---------------------------------------------------- | --------------------------------------------------------- |
| API entry             | `resources/server.js` Bun bundle, minified.          | Whitespace and syntax only: stack traces keep names.      |
| Database migrations   | Migration sources plus adjacent Kysely dependency.   | They are loaded by the bundled API at runtime.            |
| Bundled plugins       | Staged plugin tree with TypeScript backends bundled. | Backends minified as the API is; UIs without source maps. |
| Third-party notices   | `resources/THIRD_PARTY_NOTICES/`.                    | The one copy: the embedded UI carries none.               |
| Visual Feedback probe | `resources/visual-feedback-probe.js`.                | The probe still requires a Localix preview connection.    |
| CLI launcher          | CLI shim plus a direct bundle of the launcher entry. | The shim is not a second native executable.               |
| Bun runtime           | Host-triple sidecar under `binaries/`.               | Native builds cannot reuse a sidecar from another target. |
| UI                    | `apps/ui/dist` used as Tauri `frontendDist`.         | Development loads the Vite URL instead of this directory. |

The default Tauri build has no updater: its config carries no key or endpoint, and `build.rs` does
not compile the plugin in. The release command (`run-tauri.mjs --release`) adds an overlay generated
by `scripts/build-release-config.mjs` that turns on signed updater bundles and supplies the key and
endpoint, and sets `LOCALIX_UPDATER_ENABLED=1` so the plugin is compiled in. Afterwards it fails the
build unless the public key is inside the built binary.

### Production startup

The native shell reserves a loopback port, paints the hidden main window, and starts the staged Bun
sidecar with `server.js --desktop-runtime`. The sidecar receives the port, desktop parent process,
and staged CLI path through environment values.

The API emits a structured readiness line. The shell records that state, hands the attested port to
the webview, retries one timed-out start, and reports the last runtime log line when startup fails.

A new sidecar attaches to a runtime that is already serving only when that runtime is the same
build. The runtime descriptor records a `buildId` taken from the size and modification time of the
entry module (`apps/api/src/lib/runtime-build.ts`), so after an update the previous build's runtime
is stopped and replaced instead of serving the new UI. A runtime that has begun to shut down clears
its descriptor first and answers `/health` with 503 `draining`, so a reopen right after quit starts
a fresh runtime rather than attaching to the dying one.

The owned runtime also stops when the shell's end of its stdin pipe closes
(`apps/api/src/lib/desktop-parent.ts`). Unlike the one-second parent-pid watchdog, that signal
cannot be fooled by Windows reusing the shell's process id. It is armed only when stdin is a pipe,
never for a terminal, `/dev/null` or a redirected file.

A runtime the shell owns that exits after it was ready is started once more, after a one-second
pause and on a fresh port. The page reads `starting` again and reloads onto the new port when the
new runtime reports ready. A second such exit, or one while the app quits or installs an update, is
reported as an error instead.

### Local API browser boundary

The API has no credentials and listens on loopback, and every page the user's browser opens can
reach loopback. So `apps/api/src/lib/local-origin-guard.ts` runs before CORS and every route,
including websocket upgrades and plugin routes, and answers 403 to anything it refuses.

| Check       | Accepted                                                                     | Defeats                                                               |
| ----------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `Host`      | `127.0.0.1`, `localhost`, `[::1]` on any port, or a concrete `HOST` address. | DNS rebinding, where a site's own name resolves to 127.0.0.1.         |
| `Origin`    | The allowed page origins below, on a websocket handshake or any write.       | A site, a preview server, or a repository dev server driving the API. |
| No `Origin` | A write carrying `x-localix-client` or a non-form `Content-Type` (JSON).     | A browser that omits `Origin` on a body-less `POST` or `DELETE`.      |
| CORS        | Reflects only an allowed origin.                                             | A foreign page reading a response.                                    |

| Mode                    | Allowed page origins                                                                                  |
| ----------------------- | ----------------------------------------------------------------------------------------------------- |
| Packaged desktop        | `tauri://localhost` (macOS, Linux), `http://tauri.localhost` and `https://tauri.localhost` (Windows). |
| `bun run dev`           | The packaged origins, plus `http://localhost:5050` and `http://127.0.0.1:5050` from the launcher.     |
| `bun run dev:workspace` | The same as `bun run dev`; `LOCALIX_DEV_UI_PORT` moves both dev origins.                              |
| API serves the UI       | With `LOCALIX_UI_DIR`, the API's own origin is added.                                                 |

`scripts/dev-servers.mjs` passes the dev origins as `LOCALIX_UI_ORIGINS`. Reads (`GET`, `HEAD`) stay
open to any origin, because CORS already withholds the response and preview pages load the probe
script by tag. The UI transport `apiFetch` adds `x-localix-client` to every write, and plugin
interfaces use that transport. The header name lives in `apps/api/src/lib/client-header.ts`, which
both sides import. A non-browser client that sends a write without a body, such as `curl -X POST`,
must add `x-localix-client: 1`; the documented webhook call sends JSON and needs nothing extra.

### Quitting, restarting and updating

Every way out first lets the page save, then gives the runtime its `shutdown` line and a bounded
wait before the shell kills it.

The page keeps its newest state in debounced writes: the editor grid, a caret and scroll position, a
settings change sent to the runtime, and a half-typed message. A quit that ended the process while
those timers were pending restored an older state on the next launch, and a settings edit came back
reverted because the server copy won the sync. So the shell runs a before-quit handshake
(`apps/desktop-tauri/src-tauri/src/quit.rs`): it defers the exit, emits `localix://before-quit` to
the page, and waits up to 1.5 s for the page's `quit_ready`. Then it saves the window size and
position and stops the runtime. The handshake runs in development builds too, where there is no
runtime child to stop. On the page, `apps/ui/src/shared/lib/quitFlush.ts` is the one list of pending
writes: each owner registers its flush there, and the handshake awaits all of them, bounded at 1.2
s. The same list also runs on `pagehide` and when the page is hidden, which covers the reloads that
follow a port handoff or a runtime respawn.

| Route                                                  | Page flush | Wait before the kill | Why this route                                                    |
| ------------------------------------------------------ | ---------- | -------------------- | ----------------------------------------------------------------- |
| Quit in the app menu, File menu or tray                | 1.5 s      | 6 s                  | `app.exit` raises `ExitRequested`, which defers the exit.         |
| Closing the last window, as Alt+F4 does without a tray | 1.5 s      | 6 s                  | The close is turned into the same `app.exit` while the page runs. |
| `restart_app`; an update install on macOS or Linux     | 1.5 s      | 6 s                  | Tauri cannot defer a restart, so the initiator runs both first.   |
| Windows update install                                 | 1.5 s      | 6 s                  | The installer hook runs both before `std::process::exit`.         |
| macOS Dock Quit or logout; a Windows `WM_QUIT`         | none       | 3 s                  | These reach only `Exit`, as the process is already ending.        |

The window geometry is saved in the handshake as well as on `Exit`, because the Windows installer
path never raises `Exit`. A crash still loses the geometry since the last clean exit.

Quit is a custom menu item, because the predefined one skips `ExitRequested` on macOS and Windows
and does nothing on Linux. It is bound to Cmd+Q on macOS and Ctrl+Q on Linux. Windows File ▸ Exit
has no accelerator: Alt+F4 quits there, and Ctrl+Q stays with the terminal. On Windows the runtime
runs in its own Job Object that kills its remaining processes when the job closes, including when
the shell itself dies.

### Updating

One flow connects a published release to an installed app. Each step names the code that owns it.

1. **Publish.** `release.yml` stamps the tag's version (`scripts/stamp-version.mjs`), builds with
   `tauri:release` (the overlay, the updater compiled in, updater artifacts signed with
   `TAURI_SIGNING_PRIVATE_KEY`), smokes the packaged app, then builds `latest.json` from the signed
   bundles. The release is published as the **latest** one, a `-beta.N` version included, because
   the app reads `releases/latest/download/latest.json` and GitHub's `latest` skips a prerelease.
   `scripts/assert-newest-release.mjs` refuses a version older than the current latest.
2. **Check.** The rail's `DesktopUpdateButton` is the one poller: thirty seconds after launch, then
   hourly, it calls `updater_check` (`updater.rs`), which reads the manifest, compares versions and
   keeps the `Update` handle. A failed check is quiet and reports "no update".
3. **Notice.** `useDesktopUpdate` holds one shared state, so three surfaces agree: `UpdateStrip`
   above the focused composer (`ComposerHeaderStrips`), the rail button, and Settings → Updates.
   Hiding the strip is remembered per version.
4. **Press.** All three go through `restartToUpdate`. If any session has a running turn or
   background job, it asks first and names what stops; otherwise it installs at once.
5. **Install.** `updater_install` marks the state `installing`, holds runtime respawns, downloads
   (progress events, about twice a second, become the strip's percentage), and verifies the minisign
   signature against the public key inside the app. Then `leave_cleanly` flushes the page, saves the
   window and stops the runtime (`shutdown`, bounded, then the kill), and `app.restart()`
   relaunches.
6. **Relaunch.** The new shell starts the new runtime, which applies its embedded migrations after
   copying an existing database to `~/.localix/backups/migrations`.
7. **Failure.** Any error before the restart releases the respawn hold, clears `installing`, shows
   "Could not install the update" with the reason, and leaves the old version running.

A build without `LOCALIX_UPDATER_ENABLED` skips all of it: `UPDATER_ENABLED` is false, the init
script sets `__LOCALIX_UPDATER=false`, and the page never polls or shows a notice.

Development takes a different path. Tauri's `beforeDevCommand` stages build-script prerequisites,
then the shared supervisor starts the API watcher and Vite process while the native shell loads the
development URL.

The production UI keeps editor, diff, terminal, HITL, and contributed workbench renderers behind
surface-local dynamic imports. The generated `index.html` is the startup-graph authority: the build
counts that document, its entry module, static module preloads, and startup stylesheet against both
a 269-file and 1,940,000-byte uncompressed budget. This guards first paint without merging small
chunks in ways that can pull a lazy Monaco or workbench dependency back into startup.

### Native browser pages

A browser tab showing an external site is a child WebView that the shell stacks above the app's own
WebView. App HTML can never paint over it, so the page steps aside while any app overlay is up.

| Moment               | What the page does                                                          | Boundary                                                     |
| -------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------ |
| No overlay on screen | The native view is framed to its pane box and shown.                        | Hidden while its tab, group, or pane box is not displayed.   |
| An overlay opens     | A JPEG of the current frame is painted in the box, then the view is hidden. | The view hides after 150 ms even when no picture has landed. |
| While it is hidden   | The picture is toned with half of the app's opaque ground.                  | The app's glass surfaces stay legible over a bright page.    |
| The overlay closes   | The native view is shown again over its picture.                            | A close and reopen within one task keeps the view hidden.    |
| The pane moves       | `browser_bounds` receives the new frame, one call at a time, newest only.   | Framing, showing, and hiding are the whole native protocol.  |

The overlay signal is the shared focus stack's `overlayOnScreen`. Shared dialogs, drawers, menus,
popovers, and confirmations claim the stack through `useOverlayFocus`, a ref on the content element,
so a claim lasts exactly as long as that element is mounted and a closed overlay claims nothing.

The pane box is followed by a `ResizeObserver` and window resize and scroll events. A box hidden by
`visibility`, as in a group maximized away, reads as no frame. The shell never reorders the page
against the app's WebView: showing, hiding, and a picture replace any stacking change.

On macOS a page introduces itself as the installed Safari: the user agent carries
`Version/<Safari bundle version> Safari/605.1.15`. A plain WKWebView omits those tokens, and Google
then serves its legacy page, which has no dark theme and does not follow the pane's width.

One rule, `browserEngine` in `browserUrl.ts`, picks the engine for every tab.

| Tab                                         | Engine           | Boundary                                            |
| ------------------------------------------- | ---------------- | --------------------------------------------------- |
| The history list                            | The history view | No page behind it.                                  |
| A local page that allows framing            | The in-app frame | The only engine with Visual Feedback and HMR relay. |
| Any other page, or one opened as a web page | A native WebView | macOS and Windows shells; elsewhere it is framed.   |

A typed address loads in place when the tab's engine serves it, and opens where a fresh tab for it
would otherwise (`addressDestination`). A page opened in the browser keeps the native engine, so a
link or redirect to a local server never moves it.

Both engines share `BrowserToolbar`. Reload, frame sizes, dev-server ports, and opening in the
system browser appear on every page; back and forward appear where the engine keeps the page's own
history, which is the native WebView; Visual Feedback and stopping a dev server appear only for a
framed local page. A load in flight sweeps along the toolbar's bottom edge. What belongs to the
browser rather than to one page lives once on the tab strip: history, a new tab, closing, and
reordering by drag. A new tab is a tab of its own, its address field focused over the pages visited
most recently.

The agent bridge is injected once the page's document has parsed and is the one the tab is loading,
never by comparing addresses: a page that rewrites its own URL after loading, as Google search does,
is still the page that loaded. While WebKit reports a load in flight, a `complete` document is the
outgoing one and waits; an `interactive` one is the incoming page and takes the bridge without
waiting for its last resource. A command the bridge cannot run is answered to the agent that sent
it; a page that fails to open, reload, or navigate is reported to the Event Center rather than in a
strip over the page.

### Shell launcher

The desktop sidecar sets `LOCALIX_CLI_ENTRY` to the staged shim. On startup, the API checks the
launcher and best-effort installs it when missing or stale; the Settings row exposes status,
install, reinstall, and uninstall operations.

| Platform        | Launcher path                            | Contents                       |
| --------------- | ---------------------------------------- | ------------------------------ |
| macOS and Linux | `~/.local/bin/localix`                   | Executable POSIX shell script. |
| Windows         | `%LOCALAPPDATA%\Localix\bin\localix.cmd` | Command shim forwarding `%*`.  |

The portable Linux AppImage is the exception: its staged Bun and CLI paths live under an ephemeral
mount, so the API reports launcher installation as unavailable. The `.deb` package has stable paths
and supports normal auto-installation. AppImage startup removes a legacy launcher only when its
contents still reference an ephemeral `.mount_*` path, preserving launchers from durable packages.

Both forms quote the staged Bun and CLI paths and forward every argument. Status reports whether the
launcher directory appears in the inherited `PATH`; it does not modify that value.

### Path handoff

The CLI resolves `.`, `~`, relative paths, and absolute paths before encoding an absolute
`localix://open?path=...` URL. The operating system activates the registered scheme; the Tauri
single-instance layer focuses an existing window or the OS launches the app.

The UI parser rejects non-absolute paths, control characters, and paths over 4096 characters. The
API stats the path: a file maps to its parent-directory project and an editor tab, while a directory
finds or creates one project by normalized working directory.

### Release assembly

The release workflow verifies one semver tag commit before creating a draft. Two native runners
build macOS arm64 and Linux x64 artifacts; publication waits for every matrix leg and the signed
updater manifest. Windows and Intel Mac have no installer: they build from source.

| Platform | Requested bundle targets | Additional package policy                                |
| -------- | ------------------------ | -------------------------------------------------------- |
| macOS    | Application and DMG      | Minimum macOS 13; release path signs and notarizes.      |
| Linux    | AppImage and DEB         | WebKit, GTK and tray indicator; media framework bundled. |

The Linux config also contains RPM dependency metadata, but RPM is absent from the default bundle
target list.

The updater manifest (`scripts/build-updater-manifest.mjs`) gives each Linux install its own
package: `linux-x86_64` points at the AppImage and `linux-x86_64-deb` at the signed `.deb`. The
updater looks up the installer-specific key first, and its Debian installer rejects any other
payload, so without that key a `.deb` install could never update. A release missing any of the five
signed bundles fails before publication.

The shell and the API runtime share one contract, and its source of truth is
`apps/api/src/lib/runtime-protocol.ts`: the ready-frame prefix and fields, the `shutdown` word, the
environment the shell sets, and the two deadlines the shell's own timeouts must outlast.
`scripts/runtime-contract.mjs` renders the Rust half into `src-tauri/src/runtime_contract.rs`, which
is committed because cargo must see it with no step before it. `bun run check:generated` compares
the committed file with a fresh render, `RuntimeEndpoint` extends the frame the shell parses, and
`sidecar.rs` asserts at compile time that its start budget and shutdown wait exceed the runtime's.
After changing a value, run `bun scripts/runtime-contract.mjs --write`.

`scripts/stamp-version.mjs` writes the tag's version into the three files that carry it
(`tauri.conf.json`, `Cargo.toml` and the crate's `Cargo.lock` entry) and refuses anything that is
not a semantic version. `--check` fails when the three disagree, and a test runs it against the
committed files.

The API's migrations are compiled into `server.js` rather than staged as loose files. A bundler
plugin (`scripts/embed-migrations-plugin.mjs`) answers one virtual module that statically imports
every file in `apps/api/migrations` and carries its text, so `kysely` is bundled with them and the
bundle has no `migrations/` folder or vendored `node_modules` beside it. The migration ledger
digests the embedded text exactly as it digests a file, so one database opens in the dev server and
in the packaged app. Spacedrive, GitButler and Buzz compile their migrations into the binary the
same way.

`apps/desktop-tauri/scripts/smoke-bundle.mjs` starts the API the way the shell does: the sidecar Bun
runs `server.js --desktop-runtime` against a throwaway home, the script waits for the
`LOCALIX_RUNTIME_READY` frame, reads `/health`, sends `shutdown` and requires a clean exit. It
copies the bundle outside the checkout first, because inside it a missing vendored module still
resolves from the repository's own `node_modules`. `bun run check:bundle` runs it on the freshly
staged bundle in CI. The release workflow runs it with `--root` on each built app (the macOS `.app`,
the extracted AppImage and the unpacked `.deb`) before collecting assets, so a bundle that cannot
start never reaches the draft.

A release bundle's `__UI_BUILD__` stamp is the source commit. `scripts/build-stamp.mjs` ignores the
version files the workflow stamps, prefers an explicit `LOCALIX_BUILD_STAMP` (hashed by Turbo), and
under Turbo without one uses the task hash, so a cached build never reports another commit.

## Configuration

| Input or file               | Effect                                                      | Boundary                                                         |
| --------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------- |
| `bun run build:desktop`     | Builds API dependencies, stages resources, then runs Tauri. | Uses ordinary local-build signing behavior.                      |
| `bun run release:desktop`   | Adds updater artifacts and macOS notarization handling.     | It does not upload or publish a release.                         |
| `tauri.conf.json`           | Owns UI path, scheme, sidecar and targets.                  | Version is `0.0.1` until release CI runs `stamp-version.mjs`.    |
| Platform Tauri config files | Add macOS, Windows, or Linux packaging settings.            | Tauri merges only the current target platform's file.            |
| `LOCALIX_CLI_ENTRY`         | Selects the shell launcher's CLI target.                    | Only the desktop sidecar triggers automatic installation.        |
| `TAURI_SIGNING_PRIVATE_KEY` | Signs updater artifacts in the release path.                | Its public key is `updater.release.json`, embedded at build.     |
| `LOCALIX_UPDATER_PUBKEY`    | Replaces the committed updater public key for one build.    | For a channel or a fork; the build still fails if it is invalid. |
| `LOCALIX_UPDATER_ENDPOINTS` | Replaces the update manifest URL(s), comma-separated.       | HTTPS only.                                                      |
| Apple signing environment   | Signs and notarizes release app and DMG artifacts.          | The release script fails early when required values are missing. |

## Release operations

Run the release workflow manually from the protected `main` branch and pass an existing semantic
version tag. The workflow rejects a tag whose commit is not reachable from `origin/main`; tag pushes
do not start releases automatically.

Before the first release, create a protected GitHub Environment named `release`. Allow deployments
from `main` only, require reviewers, prevent self-review and administrator bypass, and store every
release, updater-signing, and Apple-signing secret only in that environment—not as a repository- or
organization-level secret. Protect `main` with pull requests, required reviews and status checks,
and require review for changes to `.github/workflows/**` and release scripts. Workflow YAML can
select the environment, but repository settings are the trust boundary that enforces its reviewers,
deployment policy and secret scope.

The public artifact repository is `rsaryev/localix`. Mirror the exact source commit and the same tag
there before dispatch, and give its environment-scoped `RELEASE_TOKEN` `contents:write` access; the
workflow rejects a missing tag or one that resolves to a different commit. If the repository's
GitHub plan does not support required environment reviewers, do not treat the release path as
production-safe until an equivalent approval boundary is available.

## Limits

- The release workflow and bundle targets are packaging configuration, not proof that downloadable,
  signed artifacts exist. Check the repository's GitHub Releases page for a published build.
- A build from a checkout has no updater at all. A working one additionally requires the matching
  signing key, uploaded signed bundles, and a published `latest.json` on the latest release.
- The deep-link parser records `new=1`, but the UI path handler currently ignores that field. A path
  handoff therefore reuses or creates the project by working directory rather than forcing a fresh
  project.
- The shell installer removes only its launcher file on uninstall and never edits shell profiles or
  the Windows user `PATH`.
- An unstatable or nonexistent path is treated as a directory candidate by the project service. The
  path can therefore create a project record before the directory exists.
- “Primary artifact” describes the configured desktop release, not the only runnable source path.
  The repository still runs an unbundled development shell.
- Platform association lists and installer settings do not prove every target has been tested on a
  physical machine.
- Only macOS captures a native browser page's picture. On Windows the page still hides under an app
  overlay, and its box shows the plain app ground until the overlay closes.
- Linux has no native browser page. Tauri packs a child WebView into the window's vbox, where wry
  ignores its bounds, so every page is framed until the shell hosts pages in a `gtk::Fixed`.
- On Windows, a program the runtime starts belongs to its Job Object and closes when Localix quits.
  That includes an app opened from Localix that was not already running, unless it leaves the job.
- While an app overlay is up, the browser page is a still picture: its video and animation appear
  paused, and a click lands on the app rather than the page. Tooltips and hover cards make no focus
  claim, so one that reaches over the page renders underneath it.
- A native page cannot be clipped or scrolled like an iframe, so a pinned frame size larger than the
  pane is shown at the pane's size. The agent's `viewport` action still refuses a fixed size for a
  native tab.
- Generated third-party notices inventory the installed npm runtime graph and bundled Monaco/Pi
  notices. Packages that publish only license metadata are identified but cannot contribute text
  absent from their package, and Rust crate licensing is not yet emitted as a separate inventory.

## Related guides

- [Installation](../getting-started/installation.md)
- [Command-line interface](../features/cli.md)
- [Architecture](architecture.md)
- [Environment contract](environment.md)

## Source of truth

- [Root desktop scripts](../../package.json)
- [Desktop package scripts](../../apps/desktop-tauri/package.json)
- [Tauri bundle configuration](../../apps/desktop-tauri/src-tauri/tauri.conf.json)
- [Release overlay generator](../../apps/desktop-tauri/scripts/build-release-config.mjs)
- [Sidecar staging](../../apps/desktop-tauri/scripts/prepare-sidecar.mjs)
- [Production sidecar lifecycle](../../apps/desktop-tauri/src-tauri/src/sidecar.rs)
- [Local API browser boundary](../../apps/api/src/lib/local-origin-guard.ts)
- [First-party client header](../../apps/api/src/lib/client-header.ts)
- [Development launcher](../../scripts/dev-servers.mjs)
- [Sidecar process tree](../../apps/desktop-tauri/src-tauri/src/process_tree.rs)
- [Native application composition](../../apps/desktop-tauri/src-tauri/src/lib.rs)
- [Native browser pages](../../apps/desktop-tauri/src-tauri/src/native_browser.rs)
- [Browser WebCrypto master key](../../apps/desktop-tauri/src-tauri/src/webcrypto_key.rs)
- [Browser page layering](../../apps/ui/src/features/inspector/model/nativePageLayer.ts)
- [Browser page host](../../apps/ui/src/features/inspector/ui/useNativeBrowserPage.ts)
- [Browser engine rule](../../apps/ui/src/features/inspector/model/browserUrl.ts)
- [Browser toolbar](../../apps/ui/src/features/inspector/ui/BrowserToolbar.tsx)
- [Browser tab strip](../../apps/ui/src/features/inspector/ui/BrowserTabStrip.tsx)
- [Browser bridge readiness](../../apps/ui/src/features/inspector/ui/nativeProbe.ts)
- [Overlay focus claims](../../packages/plugin-sdk/src/ui/focus/useOverlayFocus.ts)
- [Shell launcher plan](../../apps/api/src/features/shell-command/plan.ts)
- [Shell launcher service](../../apps/api/src/features/shell-command/service.ts)
- [Desktop launcher bootstrap](../../apps/api/src/boot/shell-command.ts)
- [CLI path URL construction](../../packages/cli/src/open-url.ts)
- [Deep-link grammar](../../apps/ui/src/shared/lib/deepLink.ts)
- [Deep-link UI handler](../../apps/ui/src/shared/hooks/useDeepLinks.ts)
- [Project path resolution](../../apps/api/src/features/projects/service.ts)
- [UI build boundaries](../../apps/ui/vite.config.ts)
- [UI startup budget](../../scripts/check-ui-startup-budget.mjs)
- [Release workflow](../../.github/workflows/release.yml)
