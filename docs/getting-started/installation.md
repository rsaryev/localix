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

| Command                         | Result                                                                             | Boundary                                                                                  |
| ------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `bun install --frozen-lockfile` | Installs the exact Bun workspace lockfile.                                         | Requires Bun 1.3.14. This repository does not use npm or Yarn for workspace installation. |
| `bun run dev`                   | Opens the native Tauri window and supervises the API and Vite development servers. | This is an unbundled development run.                                                     |
| `bun run dev:web`               | Starts the API and browser workspace with a separate development database.         | No Rust toolchain is needed; native desktop bridges are unavailable.                      |
| `bun run dev:workspace`         | Starts the API and workspace development tasks without the native shell.           | Native file dialogs, deep links, and desktop update APIs are unavailable.                 |
| `bun run build:desktop`         | Builds a Tauri bundle for the current host.                                        | It is not a cross-build, signed release, or updater-enabled release artifact.             |

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

`bun run build:desktop` first stages the built UI, API, bundled plugins, CLI, and Bun sidecar. Tauri
then packages those resources with the native shell for the current host.

The release workflow has two native build legs:

| Host         | Architecture | Configured bundle      | Boundary                                                                              |
| ------------ | ------------ | ---------------------- | ------------------------------------------------------------------------------------- |
| macOS        | arm64        | `.app` and `.dmg`      | The release leg requires signing and notarization credentials and fails without them. |
| Ubuntu 22.04 | x64          | `.AppImage` and `.deb` | The repository does not configure an arm64 Linux release leg.                         |

This matrix records repository configuration. Check the Releases page for the installers a given
release actually published.

## Configuration

| Toolchain | Recorded version           | Scope                                                                                    |
| --------- | -------------------------- | ---------------------------------------------------------------------------------------- |
| Bun       | 1.3.14                     | Package manager, development runtime, CI, and bundled API sidecar.                       |
| Rust      | 1.96.1                     | Pinned by CI and the native release workflow. Local scripts do not enforce this version. |
| Node.js   | ≥18 for CLI; 24 in Actions | CLI workspace build and JavaScript actions in CI. The application runtime uses Bun.      |

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

An installed release checks for a newer signed version thirty seconds after launch and then once an
hour. When one exists, a quiet row appears above the message box in the focused chat: **Update
available**, the new version beside the one you have, and **Restart to update**. The same update is
marked on the rail and offered in Settings → System → Updates, where you can also check on demand.

1. Press **Restart to update**. If a turn or a background job is running, Localix says what the
   restart will stop and waits for you to confirm; with nothing running it starts at once.
2. The row turns into **Updating** with the download's progress. Nothing else on the row can be
   pressed, and it stays that way if you switch to another chat meanwhile.
3. The download is checked against Localix's public key before anything is installed. Then Localix
   saves your windows and drafts, stops its local runtime, installs, and reopens on the new version.
4. Your data is kept. If the new version changes the database, the old one is copied to
   `~/.localix/backups/migrations` first.

If the install fails, you get a message with the reason, the row goes back to **Restart to update**,
and nothing has changed. The × on the row hides it for that version only; the rail mark and Settings
still show it, and a newer version brings the row back. A Localix built from source never updates
itself.

## Limits

- The current release workflow configures macOS arm64 and Linux x64 builds. It does not configure
  Windows or Intel Mac release builds. Check the assets of a published release for availability; old
  drafts can contain artifacts from a different build matrix.
- Every source-built bundle is local and unofficial. Do not present it as a Localix release.
- A desktop build made from a checkout has no updater: it never reads the release feed, and never
  offers an update. Only the release workflow compiles the updater in, with its public key and
  endpoint.
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
