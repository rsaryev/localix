# Contributing

Localix contributors use Bun and Turbo to build the desktop, API, UI, packages, and bundled plugins
from one workspace. This guide gets a checkout running and maps each change to the checks that catch
regressions.

## Terminology

| Term               | Meaning                                                               | Boundary                                                           |
| ------------------ | --------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Root task          | A script in the repository `package.json` that drives workspace work. | Prefer it when a Turbo task must build dependencies first.         |
| Focused check      | A test or package command run while iterating on one change.          | It does not replace the required pull-request gates.               |
| Workspace package  | A Bun workspace under `apps/`, `packages/`, `plugins/`, or `vendor/`. | Bundled plugins are not all represented by Turbo package tasks.    |
| Generated output   | Build, documentation, test, or desktop staging material.              | Keep ignored output out of review unless its source file is owned. |
| Vendored workspace | Source retained under `vendor/` and linked by the root install.       | Update it only through its documented upstream-sync process.       |

## What you can do

| Operation                  | Command                                                          | Boundary                                                             |
| -------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------- |
| Install exact dependencies | `bun install --frozen-lockfile`                                  | Run from the repository root.                                        |
| Seed build outputs         | `bun run build`                                                  | Builds the full Turbo graph and public documentation dependencies.   |
| Open desktop development   | `bun run dev`                                                    | Requires Rust and the platform-native Tauri prerequisites.           |
| Build a native bundle      | `bun run build:desktop`                                          | Produces a host-platform local build, not a verified public release. |
| Run one API test file      | `cd apps/api && bun test src/features/projects/projects.test.ts` | Build workspace dependencies first.                                  |
| Validate public Markdown   | `bun run --cwd apps/landing docs:gen`                            | Formats nothing; use Oxfmt separately on the files you own.          |

Start a fresh checkout with the pinned tools, install dependencies, and seed package outputs:

```bash
git clone <repository-url> localix
cd localix
bun install --frozen-lockfile
bun run build
```

Run `bun run build` again in a new Git worktree before invoking raw package-level TypeScript or test
commands. Workspace imports resolve through built `dist` declarations, so an unbuilt worktree can
report missing `@localixai/*` modules that are not source defects.

## How it works

### Repository ownership

| Path                  | Owns                                                                        |
| --------------------- | --------------------------------------------------------------------------- |
| `apps/api/`           | Hono API, agent runtime composition, persistence, and backend features.     |
| `apps/ui/`            | React workspace and client-side feature surfaces.                           |
| `apps/desktop-tauri/` | Native shell, staged API sidecar, platform bridge, and packaging.           |
| `apps/landing/`       | Product site and generated documentation renderer.                          |
| `packages/`           | Shared runtime-neutral libraries, adapters, CLI launcher, and SDK surfaces. |
| `plugins/`            | Bundled tools, workbenches, skills, hooks, commands, and channels.          |
| `scripts/`            | Repository checks, staging, release helpers, and development launchers.     |
| `config/`             | Shared tool configuration.                                                  |
| `docs/`               | Public guides, contributor references, and canonical product captures.      |
| `vendor/`             | Checked-in upstream workspaces consumed by the Bun graph.                   |

The [architecture guide](architecture.md) owns import direction and runtime composition. The
[plugin guide](../extending/plugins.md) owns extension boundaries; do not duplicate those contracts
inside feature changes.

### Turbo and focused commands

Root `build`, `test`, `type-check`, and `check:tests` tasks use the dependency graph in
`turbo.json`. Their `dependsOn` entries build upstream packages and generate public documentation
before the consumer task runs.

A raw package command bypasses that preparation. Use it for iteration only after the root build, or
run the corresponding root task with an appropriate Turbo filter.

### Source and test type checking

The API uses two TypeScript projects:

| Project                       | Reads                                             | Command                              |
| ----------------------------- | ------------------------------------------------- | ------------------------------------ |
| `apps/api/tsconfig.json`      | API and bundled-backend production sources.       | `bun run type-check` through Turbo.  |
| `apps/api/tsconfig.test.json` | The same source set with test exclusions removed. | `bun run check:tests` through Turbo. |

`bun test` executes TypeScript but does not provide the separate static test-file gate. Run both the
runtime suite and `check:tests` before review.

### Pull-request gates

The root
[contribution policy](https://github.com/rsaryev/localix/blob/main/CONTRIBUTING.md#required-checks)
owns the ordered gate list. The public-repository check compares that list with CI, so adding or
removing a required gate must update the policy and workflow together.

Use a focused test while editing, then run the complete root list before opening a pull request.
Rust changes under the Tauri source also need `bun run check:rust`.

## Configuration

### Toolchain

| Tool                  | Repository selection                      | Boundary                                                            |
| --------------------- | ----------------------------------------- | ------------------------------------------------------------------- |
| Bun                   | `1.3.14` in root `package.json`.          | CI installs this exact version.                                     |
| Node.js               | `24` in `.nvmrc`.                         | The CLI package build invokes `node`; application runtime uses Bun. |
| Rust                  | `1.96.1` in CI and the release workflow.  | Local scripts detect Rust; hosted checks pin this exact version.    |
| Git                   | Required for checkout and source control. | The agent shell still requires a Bash executable on Windows.        |
| Native platform tools | Listed in the installation guide.         | Requirements differ across macOS, Windows, and Linux.               |

Use the root Bun scripts. Do not run a second package-manager install inside `vendor/`; the root
workspace install creates its links.

### Formatting and static analysis

| Concern    | Owner                | Current contract                                                        |
| ---------- | -------------------- | ----------------------------------------------------------------------- |
| Formatting | `.oxfmtrc.json`      | Two spaces, 100 columns, LF, single-quoted JavaScript, no semicolons.   |
| Lint       | `.oxlintrc.json`     | Type-aware Oxlint rules plus React, hooks, import, and Unicorn rules.   |
| Dead code  | `knip.json`          | Runtime-discovered plugin, migration, and package entry points.         |
| TypeScript | `tsconfig.base.json` | Strict shared defaults; package projects can narrow targets and inputs. |

Format only files in your change while collaborating in a shared worktree. Run the repository-wide
format check as a read-only gate before review.

## Limits

- `bun run dev` is a Tauri workflow. Port `5050` supplies the desktop webview during development;
  opening it as a normal browser workspace does not provide native file paths.
- A second runtime cannot write the same Localix database. Stop the existing desktop or API owner
  before starting a full development runtime for that database.
- `bun run check:rust` exits successfully with a visible skip when Rust, Cargo, or Clippy is absent.
  A skipped local check is not evidence that Rust changes compile.
- `bun run test:dropins` is separate because runtime-loaded plugins are not all discovered through
  Turbo's package graph.
- Development starts with `bun install --frozen-lockfile`, so a pull that moved `bun.lock` installs
  what it pins before anything builds. A lockfile that no longer matches its `package.json` is
  reported and development continues on what is installed.
- In development a bundled plugin whose backend does not build is skipped, not fatal. It keeps the
  copy from its last successful build if there is one, and the Event Center names the plugin and the
  build error. Fixing the source or running `bun install` re-stages it without a restart. A release
  build stops on the same error. Changes under `plugins/` are seen by the native file watcher the
  API's file tree uses, so a scaffold's whole burst of new files re-stages the plugin.
- Generated desktop resources, sidecar binaries, package `dist` trees, Turbo state, and generated
  landing modules are ignored build products. Change their inputs instead.
- Release configuration describes a pipeline, not the existence of a public signed artifact. Use the
  release-state gate in the product evidence ledger before publishing download language.

## Related guides

- [Installation and native prerequisites](../getting-started/installation.md)
- [Documentation standards](https://github.com/rsaryev/localix/blob/main/docs/internals/doc-standards.md)
- [Architecture](architecture.md)
- [Environment contract](environment.md)
- [Plugin authoring](../extending/plugins.md)

## Source of truth

- [Root scripts and Bun version](https://github.com/rsaryev/localix/blob/main/package.json)
- [Node version](https://github.com/rsaryev/localix/blob/main/.nvmrc)
- [Turbo task graph](https://github.com/rsaryev/localix/blob/main/turbo.json)
- [Continuous integration workflow](https://github.com/rsaryev/localix/blob/main/.github/workflows/ci.yml)
- [Required contribution checks](https://github.com/rsaryev/localix/blob/main/CONTRIBUTING.md)
- [Oxfmt configuration](https://github.com/rsaryev/localix/blob/main/.oxfmtrc.json)
- [Oxlint configuration](https://github.com/rsaryev/localix/blob/main/.oxlintrc.json)
- [Knip configuration](https://github.com/rsaryev/localix/blob/main/knip.json)
- [API source TypeScript project](https://github.com/rsaryev/localix/blob/main/apps/api/tsconfig.json)
- [API test TypeScript project](https://github.com/rsaryev/localix/blob/main/apps/api/tsconfig.test.json)
