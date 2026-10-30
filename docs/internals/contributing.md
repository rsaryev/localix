# Contributing

Localix contributors use Bun and Turbo to build the desktop, API, UI, and packages from one
workspace. Localix's own mini apps and plugins live in the
[Localix marketplace](https://github.com/rsaryev/localix-marketplace). This guide gets a checkout
running and maps each change to the checks that catch regressions.

## Terminology

| Term               | Meaning                                                               | Boundary                                                           |
| ------------------ | --------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Root task          | A script in the repository `package.json` that drives workspace work. | Prefer it when a Turbo task must build dependencies first.         |
| Focused check      | A test or package command run while iterating on one change.          | It does not replace the required pull-request gates.               |
| Workspace package  | A Bun workspace under `apps/`, `packages/`, or `vendor/`.             | Turbo runs tasks per package; root scripts cover the rest.         |
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
| Update the language servers       | `bun run --cwd apps/api lsp:update`                              | Newest releases a week old into `language-servers.json`; review it.  |

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
| `scripts/`            | Repository checks, staging, release helpers, and development launchers.     |
| `config/`             | Shared tool configuration.                                                  |
| `docs/`               | Public guides, contributor references, and canonical product captures.      |
| `vendor/`             | Checked-in upstream workspaces consumed by the Bun graph.                   |

The [architecture guide](architecture.md) owns import direction and runtime composition. The
[mini app guide](../extending/mini-apps.md) and the
[plugins and mini apps contract](https://github.com/rsaryev/localix/blob/main/docs/internals/plugins-and-mini-apps.md)
own extension boundaries; do not duplicate those contracts inside feature changes.

### Turbo and focused commands

Root `build`, `test`, `type-check`, and `check:tests` tasks use the dependency graph in
`turbo.json`. `build` and `test` build upstream packages first. `type-check` and `check:tests`
depend on the `type-check` of the packages they import, which keeps their cache keys correct, and
need no build.

Every internal package lists a `@localixai/source` condition in its `exports`, pointing at `src`,
and `tsconfig.base.json` sets it as a `customConditions` entry. The compiler therefore reads
dependencies from source. The `tsconfig.build.json` files clear the condition, so a build still
emits against `dist`, and the packaged app, Bun and Vite never see it.

A workspace that reads another workspace's files through tsconfig `paths` must hash them: depend on
the target's `type-check` in its `turbo.json`, or list the target in `inputs`.
`scripts/type-check-inputs-guard.test.ts` fails when a `paths` target is neither.

Source checking applies the consumer's strictness to a dependency's files; fix the dependency file
rather than relaxing the consumer. Each package keeps an incremental build info under
`node_modules/.cache/tsc`, so a re-check only revisits what changed.

Type checks run through `scripts/tsc.mjs`, which bounds the checker threads TypeScript 7 starts (2
per process by default; `LOCALIX_TSC_CHECKERS` overrides). With Turbo running two tasks at a time
(`TURBO_CONCURRENCY`, default 2), a full run uses about half of a 10-core machine. Raise both on CI
or a large machine. A new package that other packages import adds the condition to its `exports`,
and the one script that generates landing documentation still builds the packages it imports.

A raw package command bypasses that preparation. Use it for iteration only after the root build, or
run the corresponding root task with an appropriate Turbo filter.

### Source and test type checking

The API uses two TypeScript projects:

| Project                       | Reads                                             | Command                              |
| ----------------------------- | ------------------------------------------------- | ------------------------------------ |
| `apps/api/tsconfig.json`      | API production sources.                           | `bun run type-check` through Turbo.  |
| `apps/api/tsconfig.test.json` | The same source set with test exclusions removed. | `bun run check:tests` through Turbo. |

`bun test` executes TypeScript but does not provide the separate static test-file gate. CI runs both
the runtime suite and `check:tests` before review.

### Pull-request gates

The root
[contribution policy](https://github.com/rsaryev/localix/blob/main/CONTRIBUTING.md#required-checks)
owns the ordered gate list. The public-repository check compares that list with CI, so adding or
removing a required gate must update the policy and workflow together.

Use a focused test while editing. Ordinary commits run formatting and lint on staged files through
`.githooks/pre-commit`, and changed or co-located tests.

Rust source, dependency, and Tauri configuration changes run formatting and Clippy on the current
platform when Cargo is available. Missing Clippy or rustfmt blocks a Rust commit once Cargo is
available. The hook does not rewrite or stage tracked files. A file it checks must have no unstaged
edits; stage or stash it before committing.

Before every push, `.githooks/pre-push` runs `type-check` and `check:tests` for the packages the
pushed commits change and every package that depends on them (Turbo's `--affected` against the
remote branch, or `origin/main` for a new one), two tasks at a time. `TURBO_FILTER= git push` checks
the whole tree. The unit tests run in CI on our own runner: pull requests for the packages they
change, `main` over the whole tree. The gates check the working tree, so commit or stash tracked
changes before pushing.

Hooks never pass git's repository variables (`GIT_DIR`, `GIT_INDEX_FILE` and the rest) to the tools
and tests they start: a test that creates a scratch repository would otherwise act on this one,
which is what a commit from a linked worktree used to do. Tests that run git build their environment
with `scripts/scratch-git-env.mjs`; a runner that starts git drops the variables
`git rev-parse --local-env-vars` lists. A commit made under a scratch identity (`*.invalid`,
`*.test`, `*.example`, `localhost`) is refused.

Every workspace has two test tiers, run through Turbo: `test` for unit tests and `test:integration`
for files named `*.integration.test.ts`. The repository's own contracts live in the `scripts`
workspace like any package's tests, so a new file runs without being listed anywhere. Run optional
architecture, documentation, and audit checks when relevant. `bun run check:rust` reproduces native
validation, including the full Rust test suite.

### Workflows and releases

| Workflow          | Runs when                                    | Jobs and result                                                                                                                              |
| ----------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `Checks`          | PR, push to main (not docs-only), manual run | `App (types)` (types, test layout, size), `App (tests)` (unit tests) and `Desktop (Rust) and repository scans`, reported as `Checks passed`. |
| `Desktop Release` | Manual run from main                         | Prepare release and require green CI → validate changelog and signing → create draft → build → publish.                                      |
| `Website Deploy`  | Manual run                                   | Build and deploy the website, a preview unless `production` is chosen and `LANDING_PRODUCTION=true`.                                         |

A push starts only `Checks`; the website and a desktop release are always started by hand, so a
deploy costs a build only when someone wants one. Run `Website Deploy` again after a release is
published, so the download buttons link its installers. A new push to a pull request cancels its
unfinished run. Main runs one `Checks` at a time and keeps only the newest waiting one, so a burst
of pushes costs the first run and the last; a push that changes only `docs/`, Markdown or `assets/`
starts none. A release needs a run for its exact commit: when the tagged commit has none (or main
superseded it), `Prepare release` asks for one and waits for it.

`Checks passed` fails when any job fails or is cancelled and names each job's result, so branch
protection needs to require only that status. The app jobs run in parallel, each building from its
own Turbo archive: `types` (source and test types), `unit tests` (`bun run test`),
`integration tests` (`bun run test:integration`), `desktop bundle` (a smoke test of the staged
bundle) and `coverage` (`bun run coverage`, see [Testing](testing.md#coverage)). One failing job
does not stop the others.

A failing job lists its failing tests, type errors and Turbo tasks on the run's summary page
(`scripts/ci-failure-summary.mjs`). The other job scans the history for secrets with gitleaks, lints
every workflow with actionlint and zizmor, and checks the Rust shell. A push scans only the commits
since main's last successful run (a pull request, its own), and the workflows are linted only when a
change reaches `.github`. The Rust steps are skipped when the change reaches none of the desktop
sources, root manifest, Bun lockfile, Node version, or shared CI setup, over the same commits. A
manual run, or a push with no successful run to compare with, always runs everything; a release
compiles the Rust shell itself either way.

`Checks` and `Website Deploy` run on our own runner, labelled `localix`: a service on the CI server
(`localix-runner.service`) registers an ephemeral runner in a fresh Docker container, takes one job
and leaves, so no job sees another's files. The image is Ubuntu 24.04 with Rust, sccache and the
webview's libraries; Node and Bun come from the setup actions and stay in a cache volume. A pull
request from a fork runs on GitHub's `ubuntu-24.04` instead, so code from outside never runs on our
machine.

The release stays on GitHub-hosted runners: the Linux leg on `ubuntu-22.04` for an older glibc
baseline, and the macOS leg on `macos-15`. Workflows grant no default token permissions; each job
names its own. Scanners are checksummed release binaries.

The Bun package cache, the Turbo cache, and the Rust target are restored from GitHub cache archives.
Only pushes to `main` save CI's Turbo and Rust archives, so pull requests restore them without
evicting them; the release keeps its own `turbo-release` archive. The Turbo archive drops entries
untouched for two weeks before it is saved, and after each main run only the newest archive of each
slice is kept, so the 10 GB cache quota is never filled by superseded entries. Pinned actions,
workspace packages and crates are updated by hand; there is no Dependabot.

`check:bundle` starts the staged API outside the checkout during `Checks`. Release verification does
not rerun the CI gates: it requires a successful `Checks` run for the tagged commit, then signs a
probe with the updater secret and verifies it against the shipped public key in
`scripts/verify-updater-signature.mjs`, before any draft exists.

`Prepare release` requires a green `Checks` run for the tagged commit before any job reaches the
`release` environment and its signing secrets. The verify job installs dependencies without
lifecycle scripts, since it holds the updater signing key. The draft records its source commit, so a
rerun finds and reuses its own draft (looked up among drafts, which the tag endpoint omits) and
refuses one built from another commit. Production website deployments queue in one group, so a build
from before a release never replaces the page that links its installers.

Each build leg smoke-tests the packaged API. On macOS it then checks the DMG and the app inside it
with `codesign`, the team ID, `stapler`, and Gatekeeper's `spctl`. Every updater bundle's signature
is verified against the embedded key before upload. Only draft, build-upload, and publication jobs
can write to the release. The `legs` input can select only the platforms that need rebuilding.

To cut a release:

1. Write the version's `CHANGELOG.md` section as described under Releases in
   [AGENTS.md](https://github.com/rsaryev/localix/blob/main/AGENTS.md#releases) and commit it to
   `main`. It is the release's Highlights and the "What's new" of the app's update dialog; the
   workflow refuses a version without one.
2. Wait for `Checks` to pass on the `main` commit being released. Tag the commit that has its own
   `Checks` run: when several commits are pushed at once, only the newest one gets a run.
3. Tag that commit with the next semantic version and push the tag:
   `git tag v0.1.0-beta.6 && git push origin v0.1.0-beta.6`.
4. Start the release from `main`: `gh workflow run release.yml --ref main -f tag=v0.1.0-beta.6`.
5. Approve the `release` environment deployment when GitHub asks.
6. If one platform leg fails, rerun only that leg with `-f legs=<leg>`; the draft keeps the assets
   that the other legs already uploaded.

The release also attaches `mini-app-kit.tar.gz`, built by its `mini-app-kit` job: the kit the
authoring plugin and the [Localix marketplace](https://github.com/rsaryev/localix-marketplace) build
mini apps against. The core publishes no mini app marketplace; the marketplace repository does that
with its own releases.

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

| Tool                  | Repository selection                      | Boundary                                                              |
| --------------------- | ----------------------------------------- | --------------------------------------------------------------------- |
| Bun                   | `1.4.4` in root `package.json`.           | CI installs this exact version. The only JavaScript runtime: no Node. |
| Rust                  | `1.96.1` in CI and the release workflow.  | Local scripts detect Rust; hosted checks pin this exact version.      |
| Git                   | Required for checkout and source control. | The agent shell still requires a Bash executable on Windows.          |
| Native platform tools | Listed in the installation guide.         | Requirements differ across macOS, Windows, and Linux.                 |

Use the root Bun scripts. Do not run a second package-manager install inside `vendor/`; the root
workspace install creates its links.

### Formatting and static analysis

| Concern    | Owner                | Current contract                                                        |
| ---------- | -------------------- | ----------------------------------------------------------------------- |
| Formatting | `.oxfmtrc.json`      | Two spaces, 100 columns, LF, single-quoted JavaScript, no semicolons.   |
| Lint       | `.oxlintrc.json`     | Type-aware Oxlint rules plus React, hooks, import, and Unicorn rules.   |
| Dead code  | `knip.json`          | Runtime-discovered mini app, migration, and package entry points.       |
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
- Development starts with `bun install --frozen-lockfile`, so a pull that moved `bun.lock` installs
  what it pins before anything builds. A lockfile that no longer matches its `package.json` is
  reported and development continues on what is installed.
- The core builds no mini app and ships no mini app kit. To build one against this checkout,
  `bun run mini-app-kit` stages its kit into `.turbo/mini-app-kit`; point a mini app or the Localix
  marketplace at it with `MINI_APP_KIT=<that folder>`, then install the package into your running
  Localix with `mini-app install`.
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
- [Build a mini app](../extending/mini-apps.md)

## Source of truth

- [Root scripts and Bun version](https://github.com/rsaryev/localix/blob/main/package.json)
- [Turbo task graph](https://github.com/rsaryev/localix/blob/main/turbo.json)
- [Continuous integration workflow](https://github.com/rsaryev/localix/blob/main/.github/workflows/ci.yml)
- [Required contribution checks](https://github.com/rsaryev/localix/blob/main/CONTRIBUTING.md)
- [Oxfmt configuration](https://github.com/rsaryev/localix/blob/main/.oxfmtrc.json)
- [Oxlint configuration](https://github.com/rsaryev/localix/blob/main/.oxlintrc.json)
- [Knip configuration](https://github.com/rsaryev/localix/blob/main/knip.json)
- [API source TypeScript project](https://github.com/rsaryev/localix/blob/main/apps/api/tsconfig.json)
- [API test TypeScript project](https://github.com/rsaryev/localix/blob/main/apps/api/tsconfig.test.json)
