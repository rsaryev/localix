# Run Localix from source

Run Localix from a source checkout as a native desktop app or an isolated browser workspace. This
guide covers prerequisites, development commands, and local bundles. For packaged builds, check
[GitHub Releases](https://github.com/rsaryev/localix/releases): a draft or a configured build matrix
does not mean an installer is publicly available.

## Terminology

| Term            | Meaning here                                                          |
| --------------- | --------------------------------------------------------------------- |
| Source checkout | A local copy of this repository and its lockfile.                     |
| Desktop shell   | The Tauri process that owns the native window and bridges.            |
| Sidecar         | The bundled Bun runtime and Localix API started by the desktop shell. |
| Local bundle    | A host-native package produced from your source checkout.             |

## What you can do

Run these commands from the repository root.

| Command                         | Result                                                                             | Boundary                                                                                 |
| ------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `bun install --frozen-lockfile` | Installs the exact Bun workspace lockfile.                                         | Requires Bun 1.4.4. This repository does not use npm or Yarn for workspace installation. |
| `bun run dev`                   | Opens the native Tauri window and supervises the API and Vite development servers. | This is an unbundled development run.                                                    |
| `bun run dev:web`               | Starts the API and browser workspace with a separate development database.         | No Rust toolchain is needed; native desktop bridges are unavailable.                     |
| `bun run dev:workspace`         | Starts the API and workspace development tasks without the native shell.           | Native file dialogs, deep links, and desktop update APIs are unavailable.                |
| `bun run build:desktop`         | Builds a Tauri bundle for the current host.                                        | It is not a cross-build, signed release, or updater-enabled release artifact.            |

## How it works

```bash
git clone https://github.com/rsaryev/localix.git
cd localix
bun install --frozen-lockfile
bun run dev
```

`bun run dev` starts the desktop shell. Its development supervisor runs the API watcher and Vite;
the webview loads Vite on port 5050 and the API listens on port 5051 by default.

For a browser workspace, use:

```bash
bun run dev:web
```

Open `http://localhost:5050` once the servers start. The API listens on `127.0.0.1:5051`. This
command defaults to the git-ignored `.data/dev/localix.db`, separate from the installed app's
`~/.localix/localix.db`; an explicit `LOCALIX_DB_FILE` overrides that default. Stop the servers with
Ctrl+C. `bun run dev:workspace` starts the wider workspace development tasks and uses the normal
runtime database unless you override it.

`bun run build:desktop` first stages the built UI, API, mini app kit, CLI, and Bun sidecar. Tauri
then packages those resources with the native shell for the current host.

The release workflow builds one native leg, macOS on Apple silicon, which requires signing and
notarization credentials and fails without them. Linux and Intel Mac legs are parked until their
packaging works; on those systems, and on Windows, run Localix from source as described above.

This matrix records repository configuration. Check the Releases page for the installers a given
release actually published.

## Configuration

| Toolchain | Recorded version | Scope                                                                                          |
| --------- | ---------------- | ---------------------------------------------------------------------------------------------- |
| Bun       | 1.4.4            | Package manager, the only JavaScript runtime (scripts, tools, CI), and bundled API sidecar.    |
| Rust      | 1.96.1           | Pinned by `apps/desktop-tauri/src-tauri/rust-toolchain.toml`; rustup installs it on first use. |

Native desktop builds also require Rust, Cargo, and the platform compiler and WebView dependencies
used by Tauri. The repository pins the Linux release image and installs these Ubuntu packages:

```bash
sudo apt-get update
sudo apt-get install -y \
  libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf \
  libxdo-dev libssl-dev build-essential file
```

The repository does not pin macOS SDK, Windows SDK, compiler, or WebView2 versions. See the
[desktop build notes](https://github.com/rsaryev/localix/blob/main/apps/desktop-tauri/README.md)
before creating a native bundle.

## Updates

An installed release checks for a newer signed version a few seconds after launch and then once an
hour. A newly found version is announced once in a dialog: the new version beside the one you have,
its release notes under **What's new**, **Later** and **Restart to update**. Closing the dialog
leaves the update offered in a quiet row above the message box in the focused chat, on the rail, and
in Settings → System → Updates, where you can also check on demand.

1. Press **Restart to update**. When the UI reports running root turns or work items other than
   monitors, Localix describes what the restart will stop and asks for confirmation. Otherwise it
   starts at once. This warning uses the UI's known work roster.
2. The row turns into **Updating** with the download's progress, which the Event Center's **In
   progress** also shows as a bar. Nothing else on the row can be pressed, and it stays that way if
   you switch to another chat meanwhile.
3. The download is checked against Localix's public key before installation. The shell installs and
   relaunches, requesting window/draft saves and stopping its runtime on the exit path. Platform
   installation order differs; saving has a time limit, so an unresponsive window can leave pending
   writes unsaved.
4. For a database with migration history and pending upgrades, Localix writes a backup first. It
   lives beside that database under `backups/migrations` — normally `~/.localix/backups/migrations`.
   Cleanup keeps the two newest backups for that database filename; older-file removal is
   best-effort. This is not a backup of all workspace files or the Vault master key.

If the install fails, you get a message with the reason and the row leaves its busy state. This does
not guarantee rollback of the installer's side effects. The × on the row hides it for that version
only; the rail mark, the Event Center and Settings still show it, and a newer version brings the row
back.

The same line above the message box also offers mini app and plugin updates (**N mini app updates —
Update all**, **N plugin updates — Update all**) when Localix itself has none, one at a time, taking
turns every few seconds unless the pointer rests on it or reduced motion is on; **›** shows the
next. Each is hidden with × until what it offers changes. Local model downloads keep their own line
below it. A Localix built with the ordinary source-build commands has no updater.

**No newer version found** is not proof that the release feed was reached: a native check failure
also returns no available update and records the failure in the desktop log. Retry when connectivity
is restored; see [startup logs](troubleshooting.md#read-the-logs-of-one-launch).

## Limits

- The current release workflow configures macOS arm64 and Linux x64 builds. It does not configure
  Windows or Intel Mac release builds. Check the assets of a published release for availability; old
  drafts can contain artifacts from a different build matrix.
- An ordinary source-built bundle is local and unofficial. Do not present it as a Localix release.
- Ordinary `build:desktop` bundles have no updater. The dedicated `tauri:release` command, used by
  the release workflow, enables it through the release overlay and build flag. Building from a
  checkout alone does not determine whether the updater is enabled.
- Configured extensions such as `.dmg`, `.AppImage`, and `.deb` do not prove that a current
  downloadable artifact exists.
- Opening the Vite address in a browser does not provide native paths or other desktop bridges. Use
  `bun run dev:web` when those native capabilities are not required.

## Related guides

- [Start your first session](first-session.md)
- [Providers](../features/providers.md)
- [Command-line launcher](../features/cli.md)
- [Contributing setup](../internals/contributing.md#what-you-can-do)

## Source of truth

- [Root scripts and Bun version](https://github.com/rsaryev/localix/blob/main/package.json)
- [Development supervisor](https://github.com/rsaryev/localix/blob/main/scripts/dev-servers.mjs)
- [Desktop sidecar staging](https://github.com/rsaryev/localix/blob/main/apps/desktop-tauri/scripts/prepare-sidecar.mjs)
- [Tauri bundle configuration](https://github.com/rsaryev/localix/blob/main/apps/desktop-tauri/src-tauri/tauri.conf.json)
- [Updater release overlay](https://github.com/rsaryev/localix/blob/main/apps/desktop-tauri/scripts/build-release-config.mjs)
- [Native release matrix](https://github.com/rsaryev/localix/blob/main/.github/workflows/release.yml)
- [Native updater outcomes](https://github.com/rsaryev/localix/blob/main/apps/desktop-tauri/src-tauri/src/updater.rs)
- [Bounded save request](https://github.com/rsaryev/localix/blob/main/apps/desktop-tauri/src-tauri/src/frontend_flush.rs)
- [Restart warning roster](https://github.com/rsaryev/localix/blob/main/apps/ui/src/entities/chat/model/interruptibleWork.ts)
- [Migration backup and retention](https://github.com/rsaryev/localix/blob/main/apps/api/src/db/connection.ts)
