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

Localix uses Bun 1.3.14 and Turborepo:

```bash
git clone <repository-url> localix
cd localix
bun install --frozen-lockfile
bun run build
```

The complete setup, package layout, cross-platform conventions, and per-package test commands are in
the [development guide](docs/internals/contributing.md).

`bun install` points git at the hooks in `.githooks/`. Every commit automatically checks formatting
and lint on staged files, plus Rust formatting when Rust sources change and Cargo is available. The
hook checks without changing or staging files. If a checked file also has unstaged changes, restage
it before committing so the checks cover the committed contents. Full tests, type checks, builds and
audits run in CI; do not repeat them manually just to create a commit.

Maintainers can opt into the additional vendored `vendor/pi` synchronization and model catalog
refresh through `LOCALIX_MAINTAINER=1`.

Runnable applications live in `apps/`, shared TypeScript libraries in `packages/`, installable
extensions in `plugins/`, repository automation in `scripts/`, shared configuration in `config/`,
documentation in `docs/`, and static media in `assets/`. Keep feature-specific code inside its
feature and expose cross-feature behavior through typed ports or registries.

Oxfmt is authoritative: two-space indentation, 100-column width, single-quoted JavaScript strings,
no semicolons, and trailing commas. Use `PascalCase` for React components and types, `camelCase` for
functions, and `useX` for hooks. Tests normally sit beside production code as `*.test.ts` or
`*.test.tsx`; browser-like component tests use `*.dom.test.tsx`.

## Required checks

CI runs the repository-wide JavaScript and documentation gates for pull requests. Use focused tests
while editing and let pre-commit run the quick commit checks. The following list documents the full
CI gates; run them locally when reproducing CI or validating a release, rather than before every
commit. Build first in that case: several gates read built output and generated modules.

```bash
bun run build
bun run check:vendor
bun run check:public
bun run check:release
bun run check:architecture
bun run check:docs
bun run check:plugins
bun run check:audit
bun run format:check
bun run type-check
bun run check:tests
bun run lint
bun run check:deadcode
bun run test
bun run check:globals
bun run test:dropins
```

CI also runs `bun run check:bundle`, which stages the desktop bundle and starts its API outside the
checkout. Run it when you change what the desktop app ships.

Hosted CI always runs the pinned Rust formatting, Clippy, and test job. Use `bun run check:rust`
locally when diagnosing native failures. When reproducing the full CI lint and formatting gates, run
them without a path filter. CI also runs `bun run check:tests` because it type-checks test files,
while `bun test` executes them and the main type check excludes them.

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
`<feature>/<surface>--YYYY-MM-DD.png`. Real captures must be 1600×1000, English-only, and free of
personal names, private paths, secrets, provider keys, real conversations, and unrelated desktop
chrome. Inspect each final image at full size and reuse the same canonical asset in documentation
and the landing page.

## Reporting issues

Use the repository's issue tracker for bugs and feature proposals. Include your OS, Bun version,
reproduction steps, expected behavior, actual behavior, and relevant logs with secrets removed.

Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md), never in a public
issue.
