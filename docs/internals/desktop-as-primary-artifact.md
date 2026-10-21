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
| Install the shell launcher  | Use **Settings → System → Command line**.   | The installer writes no shell startup file or user `PATH` value.   |
| Open a project from a shell | Run `localix .` or `localix <directory>`.   | A registered desktop URL handler is required.                      |
| Open a file from a shell    | Run `localix <file>`.                       | Opens in the current conversation without changing the project.    |

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
| Database migrations   | Compiled into `server.js`, with Kysely.              | No migrations folder ships beside the bundle.             |
| Bundled plugins       | Staged plugin tree with TypeScript backends bundled. | Backends minified as the API is; UIs without source maps. |
| Third-party notices   | `resources/THIRD_PARTY_NOTICES/`.                    | The one copy: the embedded UI carries none.               |
| Visual Feedback probe | `resources/visual-feedback-probe.js`.                | The probe still requires a Localix preview connection.    |
| CLI launcher          | CLI shim plus a direct bundle of the launcher entry. | The shim is not a second native executable.               |
| Bun runtime           | Host-triple sidecar under `binaries/`.               | Native builds cannot reuse a sidecar from another target. |
| UI                    | `apps/ui/dist` used as Tauri `frontendDist`.         | Development loads the Vite URL instead of this directory. |

The default Tauri build has no updater: its config carries no key or endpoint, and `build.rs` does
not compile the plugin in. The release command (`run-tauri.mjs --release`) adds an overlay generated
by `apps/desktop-tauri/scripts/build-release-config.mjs` that turns on signed updater bundles and
supplies the key and endpoint, and sets `LOCALIX_UPDATER_ENABLED=1` so the plugin is compiled in.
Afterwards it fails the build unless the public key is inside the built binary.

### The Bun runtime

The API is not compiled to a single executable: the app also runs Bun to build and run the person's
own plugins, so a real Bun ships beside the shell either way. `prepare-sidecar.mjs` copies it to
`src-tauri/binaries/bun-<target-triple>[.exe]`, the name Tauri's `externalBin: ["binaries/bun"]`
requires, and `tauri-build` refuses to run cargo without it. The bundler then places it, without the
triple, next to the main executable: `Contents/MacOS/bun` in the macOS app, `usr/bin/bun` in the
Linux AppImage and `.deb`, and `bun.exe` beside the program on Windows. The shell starts it with
`shell().sidecar("bun")`, which looks in its own directory.

The copy is the Bun that ran the build, so its version is the pinned one (`packageManager`, and
`bun-version` in the workflows). On x64 Linux and Windows that Bun is the AVX2 build, because
`setup-bun` picks by the runner's processor, and it dies on a machine without AVX2, a common
virtual-machine default. The release build therefore sets `LOCALIX_SIDECAR_BASELINE=1`:
`apps/desktop-tauri/scripts/sidecar-bun.mjs` downloads Bun's `-baseline` build for the same version,
checks it against the release's `SHASUMS256.txt`, runs it once to confirm its version, and stages
that instead. arm64 has none and keeps the build's Bun. A native build per platform is required: a
sidecar cannot be cross-built.

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

After a ready runtime crashes, the supervisor applies a sliding restart budget and backoff, then
starts it on a fresh port. The page waits in `starting` and reloads when the new runtime is ready.
[Lifecycle recovery](desktop-runtime-lifecycle.md#keeping-the-runtime-alive) defines the budget and
health probes; quitting or installing an update suppresses recovery.

### Local API browser boundary

The API has no request authentication and defaults to loopback; pages the user's browser opens can
reach loopback. So `apps/api/src/lib/local-origin-guard.ts` runs before CORS and every route,
including websocket upgrades and plugin routes, and answers 403 to anything it refuses.

| Check       | Accepted                                                                     | Defeats                                                               |
| ----------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `Host`      | `127.0.0.1`, `localhost`, `[::1]` on any port, or a concrete `HOST` address. | DNS rebinding, where a site's own name resolves to 127.0.0.1.         |
| `Origin`    | The allowed page origins below, on a websocket handshake or any write.       | A site, a preview server, or a repository dev server driving the API. |
| No `Origin` | A write carrying `x-localix-client` or a non-form `Content-Type` (JSON).     | A browser that omits `Origin` on a body-less `POST` or `DELETE`.      |
| CORS        | Reflects only an allowed origin.                                             | A foreign page reading a response.                                    |

| Mode                                        | Allowed page origins                                                                                  |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Packaged desktop                            | `tauri://localhost` (macOS, Linux), `http://tauri.localhost` and `https://tauri.localhost` (Windows). |
| `bun run dev`                               | The packaged origins, plus `http://localhost:5050` and `http://127.0.0.1:5050` from the launcher.     |
| `bun run dev:web` / `bun run dev:workspace` | The same as `bun run dev`; `LOCALIX_DEV_UI_PORT` moves both dev origins.                              |
| API serves the UI                           | With `LOCALIX_UI_DIR`, the API's own origin is added.                                                 |

`scripts/dev-servers.mjs` passes the dev origins as `LOCALIX_UI_ORIGINS`. Reads (`GET`, `HEAD`) stay
open to any origin, because CORS already withholds the response and preview pages load the probe
script by tag. The UI transport `apiFetch` adds `x-localix-client` to every write, and plugin
interfaces use that transport. The header name lives in `apps/api/src/lib/client-header.ts`, which
both sides import. A non-browser client that sends a write without a body, such as `curl -X POST`,
must add `x-localix-client: 1`; the documented webhook call sends JSON and needs nothing extra.

### Webview content security policy

`app.security.csp` in `tauri.conf.json` applies to every shell webview. A `srcdoc` frame inherits
it, and the frame's own policy can only narrow it, so several sources are wider than the main window
alone needs.

| Source                                                                  | Why it is allowed                                                                                                                 |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `script-src 'unsafe-inline' blob:` and the four library CDNs            | Sandboxed plugin panels run inline bootstrap code and load libraries from `PANEL_CDN_HOSTS`; their own CSP blocks network access. |
| `http://localhost:*`, `http://127.0.0.1:*` in script, style and connect | The Vite dev server, its hot reload socket, and the loopback API.                                                                 |
| `frame-src http: https:`                                                | Browser workbench pages that open in a local frame instead of a native child WebView.                                             |
| `img-src https:`                                                        | Remote images in Markdown, chat content and plugin panels.                                                                        |

Narrowing a CDN host here silently removes it from plugin panels, so
`apps/ui/src/features/inspector/ui/pluginPanelSrcDoc.ts` documents the list both files must share.
`object-src 'none'`, `base-uri 'self'` and `form-action 'self'` stay closed.

### Runtime lifecycle

The shell flushes pending UI writes before a clean exit and supervises the API after startup.
[Desktop runtime lifecycle](desktop-runtime-lifecycle.md) owns quit deadlines, updater state, crash
recovery, and hung-process detection.

### Native browser pages

Browser pages use a framed local preview or a native child WebView according to the URL and host.
[Desktop browser integration](desktop-browser.md) owns engine selection, overlays, renderer leases,
bridge readiness, and platform limits.

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

The UI parser rejects non-absolute paths, control characters, and paths over 4096 characters. The UI
then asks the API to classify the path (`POST /rpc/projects/inspect-path`), which creates nothing. A
file opens in the editor column beside the current conversation's chat, without changing the project
or the layout. Only a directory goes on to find or create one project by normalized working
directory. A missing path fails at once with a notice.

### Release assembly

The release workflow verifies one semver tag commit before creating a draft: it requires the
commit's push CI run on main to have succeeded rather than repeating those gates, then checks the
release tooling and updater signing. Two native runners build macOS arm64 and Linux x64 artifacts;
publication waits for every matrix leg and the signed updater manifest. The current matrix has no
Windows or Intel Mac leg; use source builds on those platforms. Check published release assets
separately from this configuration.

| Platform | Requested bundle targets | Additional package policy                                |
| -------- | ------------------------ | -------------------------------------------------------- |
| macOS    | Application and DMG      | Minimum macOS 13; release path signs and notarizes.      |
| Linux    | AppImage and DEB         | WebKit, GTK and tray indicator; media framework bundled. |

The Linux config also contains RPM dependency metadata, but RPM is absent from the default bundle
target list.

The updater manifest (`scripts/build-updater-manifest.mjs`) gives each Linux install its own
package: `linux-x86_64` points at the AppImage and `linux-x86_64-deb` at the signed `.deb`. The
updater looks up the installer-specific key first, and its Debian installer rejects any other
payload, so without that key a `.deb` install could never update. The workflow passes
`RELEASE_PLATFORMS` to the manifest builder. Every listed platform must have a signed artifact; the
current macOS arm64 and Linux x64 matrix requires three entries. The builder knows five platform
keys, but requires all five only when no platform list is supplied.

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
in the packaged app.

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

Releases are published to this repository (`RELEASE_REPO: rsaryev/localix`) with the workflow's own
`github.token`; the workflow rejects a missing tag or one that resolves to a different commit. If
the repository's GitHub plan does not support required environment reviewers, do not treat the
release path as production-safe until an equivalent approval boundary is available.

## Limits

- The release workflow and bundle targets are packaging configuration, not proof that downloadable,
  signed artifacts exist. Check the repository's GitHub Releases page for a published build.
- Ordinary checkout builds omit the updater; the dedicated release command enables it. A working
  updater additionally requires the matching signing key, uploaded signed bundles, and a published
  `latest.json` on the latest release.
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
- On Windows, a program the runtime starts belongs to its Job Object and closes when Localix quits.
  That includes an app opened from Localix that was not already running, unless it leaves the job.
- Generated third-party notices inventory the installed npm runtime graph, bundled Monaco/Pi
  notices, the Bun runtime, and the Rust crates linked for the host target. Packages and crates that
  publish only license metadata are identified but cannot contribute text absent from their package.

## Related guides

- [Desktop runtime lifecycle](desktop-runtime-lifecycle.md)
- [Desktop browser integration](desktop-browser.md)
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
- [Rust crate notices](../../scripts/rust-third-party-notices.mjs)
- [Production sidecar lifecycle](../../apps/desktop-tauri/src-tauri/src/sidecar.rs)
- [Local API browser boundary](../../apps/api/src/lib/local-origin-guard.ts)
- [First-party client header](../../apps/api/src/lib/client-header.ts)
- [Development launcher](../../scripts/dev-servers.mjs)
- [Sidecar process tree](../../apps/desktop-tauri/src-tauri/src/process_tree.rs)
- [Native application composition](../../apps/desktop-tauri/src-tauri/src/lib.rs)
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
