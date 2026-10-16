<p align="center">
  <img src="assets/logo.svg" width="72" height="72" alt="Localix">
</p>

<h1 align="center">Localix</h1>

<p align="center">
  <strong>One workspace for you and a team of agents.</strong><br>
  An open source workspace where you and your agents share the editor, terminals, preview, and databases.
</p>

<p align="center">
  <a href="https://github.com/rsaryev/localix/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/rsaryev/localix/ci.yml?branch=main&label=CI"></a>
  <a href="https://github.com/rsaryev/localix/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/rsaryev/localix?include_prereleases&label=release"></a>
  <img alt="Tested on macOS; Linux experimental" src="https://img.shields.io/badge/tested-macOS-informational">
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-informational"></a>
  <img alt="Status: beta" src="https://img.shields.io/badge/status-beta-lightgrey">
</p>

<p align="center">
  <a href="https://github.com/rsaryev/localix/releases/latest"><strong>Download</strong></a> ·
  <a href="https://localix.ai">Website</a> ·
  <a href="docs/README.md">Documentation</a> ·
  <a href="#quick-start">Run from source</a> ·
  <a href="CONTRIBUTING.md">Contributing</a>
</p>

<p align="center">
  <img src="docs/assets/films/team.gif" alt="A team of agents building a project in one Localix workspace" width="880">
</p>

## Download

Get an installer from the [latest release](https://github.com/rsaryev/localix/releases/latest).

| Platform             | File                      | Status                          |
| -------------------- | ------------------------- | ------------------------------- |
| macOS, Apple silicon | `Localix-macos-arm64.dmg` | Tested; signed and notarized    |
| macOS, Intel         | None yet                  | [Run from source](#quick-start) |
| Linux                | None yet                  | [Run from source](#quick-start) |
| Windows              | None yet                  | [Run from source](#quick-start) |

Localix ships and has been tested only on macOS on Apple silicon. On other systems, run it from
source; installers for them will follow. Each release lists checksums in `SHA256SUMS.txt`.

## Quick start

For the desktop app, install [Bun](https://bun.sh) **1.3.14**, a Rust toolchain, and your platform's
[Tauri prerequisites](https://tauri.app/start/prerequisites/).

```bash
git clone https://github.com/rsaryev/localix.git
cd localix
bun install --frozen-lockfile
bun run dev
```

Connect a provider through the model picker, choose a model, and start a conversation.

To use the browser workspace instead of the desktop shell:

```bash
bun run dev:web
```

Open `http://localhost:5050` after the servers start; the API listens on `127.0.0.1:5051`. This uses
a separate, git-ignored database at `.data/dev/localix.db`.

See [installation](docs/getting-started/installation.md) for platform requirements and local builds,
and [troubleshooting](docs/getting-started/troubleshooting.md) for startup problems.

## Contributing

Localix is in beta. Read [CONTRIBUTING.md](CONTRIBUTING.md) for the workflow and
[the code map](docs/internals/code-map.md) to find the owning module. Changes are recorded in
[CHANGELOG.md](CHANGELOG.md).

Follow the [Code of Conduct](CODE_OF_CONDUCT.md). Report vulnerabilities per
[SECURITY.md](SECURITY.md).

[MIT license](LICENSE).
