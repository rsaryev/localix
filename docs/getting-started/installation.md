# Run Localix from source

Localix runs from a source checkout, and the first beta is published on the
[Releases](https://github.com/rsaryev/localix/releases) page. That beta was tested only on macOS;
its Windows and Linux installers are experimental. Build from source to run on any other setup: use
the native desktop development command for day-to-day work, or build a bundle for your current
machine.

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
| `bun run dev:workspace`         | Starts the API and workspace development tasks without the native shell.           | Native file dialogs, deep links, and desktop update APIs are unavailable.                 |
| `bun run build:desktop`         | Builds a Tauri bundle for the current host.                                        | It is not a cross-build, signed release, or updater-enabled release artifact.             |

## How it works

```bash
cd <localix-checkout>
bun install --frozen-lockfile
bun run dev
```

`bun run dev` starts the desktop shell. Its development supervisor runs the API watcher and Vite;
the webview loads Vite on port 5050 and the API listens on port 5051 by default.

`bun run build:desktop` first stages the built UI, API, bundled plugins, CLI, and Bun sidecar. Tauri
then packages those resources with the native shell for the current host.

The release workflow has four native build legs:

| Host         | Architecture | Configured bundle      | Boundary                                                                              |
| ------------ | ------------ | ---------------------- | ------------------------------------------------------------------------------------- |
| macOS        | arm64        | `.app` and `.dmg`      | The release leg requires signing and notarization credentials and fails without them. |
| macOS        | x64          | `.app` and `.dmg`      | A normal local build uses ad-hoc signing instead of release notarization.             |
| Windows      | x64          | NSIS `.exe`            | The repository does not configure a Windows arm64 release leg.                        |
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

## Limits

- Only macOS installers have been tested. The Windows and Linux installers on the Releases page are
  experimental, and no package-manager channel exists.
- Every source-built bundle is local and unofficial. Do not present it as a Localix release.
- Ordinary desktop builds disable updater artifacts. The release workflow adds them only with the
  release configuration, signing key, and platform credentials.
- Configured extensions such as `.dmg`, `.exe`, `.AppImage`, and `.deb` do not prove that a current
  downloadable artifact exists.
- The Windows release leg configures no Authenticode signing, so its NSIS installer is unsigned.
  Windows SmartScreen warns about an unrecognized app from an unknown publisher; choose **More info
  → Run anyway** only for an installer whose source you trust.
- Opening the Vite address in a browser does not provide native paths or other desktop bridges. Use
  `bun run dev:workspace` only when those native capabilities are not required.

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
- [Updater release override](https://github.com/rsaryev/localix/blob/main/apps/desktop-tauri/src-tauri/tauri.release.conf.json)
- [Native release matrix](https://github.com/rsaryev/localix/blob/main/.github/workflows/release.yml)
