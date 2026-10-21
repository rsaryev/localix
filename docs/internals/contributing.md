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

| Operation                         | Command                                                          | Boundary                                                             |
| --------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------- |
| Install exact dependencies        | `bun install --frozen-lockfile`                                  | Run from the repository root.                                        |
| Seed build outputs                | `bun run build`                                                  | Builds the full Turbo graph and public documentation dependencies.   |
| Open desktop development          | `bun run dev`                                                    | Requires Rust and the platform-native Tauri prerequisites.           |
| Open isolated browser development | `bun run dev:web`                                                | Uses `.data/dev/localix.db` by default; no native desktop bridges.   |
| Build a native bundle             | `bun run build:desktop`                                          | Produces a host-platform local build, not a verified public release. |
| Run one API test file             | `cd apps/api && bun test src/features/projects/projects.test.ts` | Build workspace dependencies first.                                  |
| Validate public Markdown          | `bun run --cwd apps/landing docs:gen`                            | Formats nothing; use Oxfmt separately on the files you own.          |

Start a fresh checkout with the pinned tools, install dependencies, and seed package outputs:

```bash
git clone https://github.com/rsaryev/localix.git
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

`bun test` executes TypeScript but does not provide the separate static test-file gate. CI runs both
the runtime suite and `check:tests` before review.

### Pull-request gates

The root
[contribution policy](https://github.com/rsaryev/localix/blob/main/CONTRIBUTING.md#required-checks)
owns the ordered gate list. The public-repository check compares that list with CI, so adding or
removing a required gate must update the policy and workflow together.

Use a focused test while editing. Ordinary commits run formatting and lint on staged files through
`.githooks/pre-commit`, source and test type checks for affected packages and their transitive
consumers, and changed or co-located tests. Turbo prepares upstream builds for those type checks.
Shared compiler settings and dependency manifests at the root select all workspaces. Plugin backend
changes also select the API compile project.

Rust source, dependency, and Tauri configuration changes run formatting and Clippy on the current
platform when Cargo is available. Missing Clippy or rustfmt blocks a Rust commit once Cargo is
available. The hook does not rewrite or stage tracked files, but type checks may generate ignored
output. Staged files and affected packages must have no unstaged edits; stage or stash them before
committing.

After the staged-file checks, the hook runs the CI gates `check:release`, `type-check`,
`check:tests`, and `test` over the whole tree; Turbo replays every unchanged package from its cache.
`bun run test` runs the package suites and the repository tests in `test:repo` side by side and
prints the repository output when it finishes. Run optional architecture, documentation, and audit
checks when relevant. `bun run check:rust` reproduces native validation, including the full Rust
test suite.

### Workflows and releases

| Workflow          | Runs when                                            | Jobs and result                                                                                                           |
| ----------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `Checks`          | PR, merge queue, push to main, manual run            | `App (build, types, tests)` and `Desktop (Rust) and repository scans`, reported as `Checks passed`; nothing is published. |
| `Desktop Release` | Manual run from main                                 | Prepare release → validate source and signing → create draft → build selected platforms → publish release.                |
| `Website Deploy`  | Website input changes, published release, manual run | Build and deploy the website; same-repository PRs get previews. Production requires `LANDING_PRODUCTION=true`.            |

A push can start both `Checks` and `Website Deploy`, because source validation and website delivery
have separate outcomes. It never starts a desktop release. New pushes cancel unfinished automatic
runs for the same ref; manual runs remain independent.

`Checks passed` fails when either job fails or is cancelled, so branch protection needs to require
only that status. The app job builds, type-checks, and tests the workspace and smoke-tests the
desktop bundle. The other job scans the history for secrets with gitleaks, lints every workflow with
actionlint and zizmor, and checks the Rust shell. PRs can skip the Rust steps when the merge diff
changes no desktop sources, root manifest, Bun lockfile, Node version, or shared CI setup.

Trusted Linux jobs use the two self-hosted runners sharing the `localix-linux` label; fork checks
use GitHub-hosted runners. The macOS release leg remains on `macos-15`. Workflows grant no default
token permissions; each job names its own. Scanners are checksummed release binaries, and runner
labels for actionlint live in `.github/actionlint.yaml`.

Self-hosted runners keep the Bun package cache, the Turbo cache, and the Rust target directory on
their own disks, so nothing is restored from GitHub cache archives and cargo builds incrementally.
Hosted runners restore archives; only `main` saves the Rust archive. Dependencies are updated by
hand: the repository has no Dependabot configuration, so no update pull requests queue behind the
two self-hosted runners.

`check:bundle` starts the staged API outside the checkout during `Checks`. Release verification does
not rerun the CI gates: it requires a successful `Checks` run for the tagged commit, then signs a
probe with the updater secret and verifies it against the shipped public key in
`scripts/verify-updater-signature.mjs`, before any draft exists.

Each build leg smoke-tests the packaged API. On macOS it then checks the DMG and the app inside it
with `codesign`, the team ID, `stapler`, and Gatekeeper's `spctl`. Every updater bundle's signature
is verified against the embedded key before upload. Only draft, build-upload, and publication jobs
can write to the release. The `legs` input can select only the platforms that need rebuilding.

To cut a release:

1. Write the version's `CHANGELOG.md` section as described under Releases in
   [AGENTS.md](https://github.com/rsaryev/localix/blob/main/AGENTS.md#releases) and commit it to
   `main`. It is the release's Highlights and the "What's new" of the app's update dialog; the
   workflow refuses a version without one.
2. Wait for `Checks` to pass on the `main` commit being released.
3. Tag that commit with the next semantic version and push the tag:
   `git tag v0.1.0-beta.6 && git push origin v0.1.0-beta.6`.
4. Start the release from `main`: `gh workflow run release.yml --ref main -f tag=v0.1.0-beta.6`.
5. Approve the `release` environment deployment when GitHub asks.
6. If one platform leg fails, rerun only that leg with `-f legs=<leg>`; the draft keeps the assets
   that the other legs already uploaded.

Publication generates `latest.json`, `SHA256SUMS.txt` from the digests GitHub records for each
asset, and the release notes. It refuses a version older than the current latest release and
redeploys the website download buttons. Before publication, deleting the draft is the rollback.
After publication, release a newer version.

The workflow structure follows
[Cap's desktop release](https://github.com/CapSoftware/Cap/blob/main/.github/workflows/desktop-release.yml)
and [uv's CI](https://github.com/astral-sh/uv/blob/main/.github/workflows/ci.yml): shared toolchain
setup, one required status, and native builds separated from publication. The Gatekeeper and updater
signature checks follow
[DigUp's packaging workflows](https://github.com/ARahim3/DigUp/tree/main/.github/workflows).

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
- The development UI releases React Performance Track measures after emission. React's cloned prop
  diagnostics otherwise accumulate in the browser's User Timing buffer across a long session.
  Performance recordings and observers still receive the entries; querying the page's retained
  measures will not return React tracks. Application timing measures remain available. Fast Refresh
  installation clears existing measures once to release an already accumulated buffer.
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
- Release configuration describes a pipeline, not the existence of a public signed artifact. Check
  [GitHub Releases](https://github.com/rsaryev/localix/releases) for a published release and its
  actual assets before writing download instructions. A draft release is not publicly available.

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
