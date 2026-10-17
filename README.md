<p align="center">
  <img src="assets/logo.svg" width="72" height="72" alt="Localix">
</p>

<h1 align="center">Localix</h1>

<p align="center">
  <strong>Everything is context</strong>
</p>

<p align="center">
  Localix is a desktop development environment built around agents. The editor, terminals, browser, databases, plugins, and coding agents like Claude Code and Codex are parts of one app, so anything you open can become context for an agent, and anything an agent does shows up where you work.
</p>

<p align="center">
  <a href="https://github.com/rsaryev/localix/releases/latest">Download</a> ·
  <a href="docs/README.md">Documentation</a> ·
  <a href="#run-from-source">Run from source</a>
</p>

<p align="center">
  <a href="https://localix.ai">
    <img src="docs/assets/films/demo.png" alt="Watch the Localix demo: a /workflows prompt fills the board, agents build and test a 2048 game in the browser, and a comment gets the cells resized" width="880">
  </a>
</p>

## Download

- **macOS, Apple silicon:** `Localix-macos-arm64.dmg` from the
  [latest release](https://github.com/rsaryev/localix/releases/latest), signed and notarized
- **macOS Intel, Linux, Windows:** no installer yet, [run from source](#run-from-source)

Each release lists checksums in `SHA256SUMS.txt`.

## Run from source

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

Localix is in beta. Start with [CONTRIBUTING.md](CONTRIBUTING.md) and
[the code map](docs/internals/code-map.md).
