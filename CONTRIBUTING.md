# Contributing to Localix

Thanks for helping improve Localix.

## Before you start

Open an issue before starting a substantial feature, architecture change, or new public extension
point so the problem and direction can be agreed. Bug fixes, documentation improvements, and focused
maintenance changes are welcome as pull requests.

Keep each pull request focused. Explain the user-visible problem, the architectural impact, and the
evidence used to verify the change. UI changes should include before/after screenshots or a short
recording; logic changes should include a regression test when practical.

## Development setup

Localix uses Bun 1.4.4 and Turborepo:

```bash
git clone https://github.com/rsaryev/localix.git
cd localix
bun install --frozen-lockfile
bun run build
```

The complete setup, package layout, cross-platform conventions, and per-package test commands are in
the [development guide](docs/internals/contributing.md).

`bun install` points git at the hooks in `.githooks/`. Every commit checks formatting and lint on
staged files. Source, package-manifest, and compiler-configuration changes also check source and
test types in affected workspaces and their consumers. Turbo prepares upstream declarations and
reuses unchanged results; shared compiler or dependency changes select all workspaces.

The hook runs changed test files and existing co-located tests. Rust source, manifest, lockfile, and
Tauri configuration changes run formatting and Clippy for the local platform when Cargo is
available; missing Clippy or rustfmt then blocks the commit. Native CI also checks Linux.

The hook does not rewrite or stage tracked files. Unstaged changes in packages being checked must be
staged or stashed first, so the checks cannot validate an unstaged repair instead of the commit.
Type checks may generate ignored build output. Every push runs the CI gates for the packages it
changes and their dependents through `.githooks/pre-push`; commit or stash tracked changes first.
`main` checks the whole tree. Full builds remain in CI; optional architecture, documentation, and
dependency audits run when relevant.

One development dependency is not OSI-licensed: `oxlint-plugin-react-doctor`, used only by the
optional `bun run lint:react-doctor`, ships under a modified MIT license that restricts some uses of
its own source. It is never bundled into Localix artifacts.

Runnable applications live in `apps/`, shared TypeScript libraries in `packages/`, installable
extensions in `plugins/`, repository automation in `scripts/`, shared configuration in `config/`,
documentation in `docs/`, and static media in `assets/`. Keep feature-specific code inside its
feature and expose cross-feature behavior through typed ports or registries.

Oxfmt is authoritative: two-space indentation, 100-column width, single-quoted JavaScript strings,
no semicolons, and trailing commas. Use `PascalCase` for React components and types, `camelCase` for
functions, and `useX` for hooks. Tests normally sit beside production code as `*.test.ts` or
`*.test.tsx`; browser-like component tests use `*.dom.test.tsx`.

## Required checks

CI runs the core build, type checks, and tests for pull requests. Use focused tests while editing
and let pre-commit run the affected-package checks described above. The required JavaScript checks
are:

```bash
bun run build
bun run type-check
bun run check:tests
bun run test
bun run check:bundle
```

Build first when reproducing CI locally: type checks read workspace declarations from built output.
Tests have two tiers in every workspace, the `scripts` workspace of repository contracts included:
`bun run test` (unit tests) and `bun run test:integration` (real processes, PTYs and watchers). Both
run through Turbo, which replays a package whose inputs did not change; CI runs them as parallel
jobs. `check:tests` type-checks test files, while `test` executes them. `bun run coverage` holds the
coverage gates. `check:bundle` stages the desktop bundle and starts its API outside the checkout.

The workflows have separate responsibilities:

| Workflow          | Trigger                                                | Result                                                                                          |
| ----------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `Checks`          | Pull requests, pushes to main, manual runs             | Four parallel `App` jobs and `Desktop (Rust)` validate the source.                              |
| `Desktop Release` | Manual run from main                                   | Prepare and require green CI → validate changelog and signing → create draft → build → publish. |
| `Website Deploy`  | Website input changes, published releases, manual runs | Build the website and deploy a preview or production site.                                      |

A push can therefore start both checks and a website deployment. It does not build a desktop
release. A new push to a pull request cancels its older run; every commit on main keeps its own.

CI runs pinned Rust formatting, Clippy, and tests unless a change reaches none of the desktop
sources, root manifest, Bun lockfile, Node version, or shared CI setup: a pull request's merge diff,
or the commits a push to main added. A manual run, or an unknown previous commit, keeps them
enabled. Use `bun run check:rust` locally when diagnosing native failures. All jobs run on
GitHub-hosted runners: Linux on `ubuntu-24.04` (the Rust job and Linux packaging on `ubuntu-22.04`),
macOS release builds on `macos-15`.

Local composite actions in `.github/actions/` own Node/Bun installation, frozen dependency installs,
Linux native dependencies, and Rust compilation caching. They keep checks and release toolchains
consistent. Pre-commit prints its selected packages, native platform, and test count: passing that
scope does not mean the full CI suite has passed.

Architecture, documentation, generated-output, vendor, plugin-manifest, dependency-audit, dead-code,
global-isolation, and drop-in checks remain available as optional root scripts. Run them when
relevant to a change. They are not required CI or release-verification gates. Full JavaScript
formatting and lint checks are also available locally; pre-commit also checks affected types and
focused tests.

Add a deterministic regression test for changed behavior. Use DOM tests when interaction or
accessibility needs rendered evidence. Run a focused test while iterating; CI runs the
repository-wide gates on the pull request.

Do not commit generated output (except the tracked landing `public/sitemap.xml` refreshed by the
documentation generator), credentials, `.env` files, `.localix/` runtime state, or changes inside
`vendor/` unless the pull request is an intentional, documented upstream sync.

## Public documentation and product media

Write public copy in English and verify product claims against the implementation that makes them
true. Keep planned, configured, and default behavior distinct. Every fenced example must declare its
language and stay focused on the contract it teaches. After changing public Markdown, run:

```bash
bun run --cwd apps/landing generate
```

Store product captures only in `docs/assets/screenshots/`, named
`<feature>/<surface>--YYYY-MM-DD.png`. Use a 1600×1000 CSS-pixel composition, captured natively at
3× density (4800×3000 physical pixels) for current product media. Use English demo data without
personal names, private paths, secrets, provider keys, real conversations, or unrelated desktop
chrome. Follow the [capture workflow](scripts/screenshots/README.md), inspect the native image
before publishing, and reuse the same canonical asset in documentation and the landing page.

## Reporting issues

Use the repository's issue tracker for bugs and feature proposals. Include the Localix version or
commit, client and launch method, OS, reproduction steps, expected behavior, actual behavior, and
relevant logs with secrets removed. Source checkouts need the Bun version; browser-workspace reports
need the browser and version. The bug-report form collects these details.

Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md), never in a public
issue.
