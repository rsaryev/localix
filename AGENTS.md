# Repository guidelines

This file is the entry point for anyone, human or coding agent, who changes this repository. It
carries the conventions and the checks. [CONTRIBUTING.md](CONTRIBUTING.md) describes the workflow,
[docs/internals/code-map.md](docs/internals/code-map.md) says where a change usually goes, and
`docs/` is the published documentation.

## Project structure

This Bun and Turborepo monorepo keeps runnable applications in `apps/`: `api` is the Hono backend,
`ui` the React and Vite workspace, `desktop-tauri` the Rust desktop shell and `landing` the website.
Reusable TypeScript libraries live in `packages/`, and installable extensions with their
`plugin.json` manifests live in `plugins/`. Repository automation belongs in `scripts/`, shared
configuration in `config/`, documentation in `docs/` and static media in `assets/`. Tests sit next
to the code they cover as `*.test.ts` or `*.test.tsx`, and browser-like component tests use
`*.dom.test.tsx`.

## Build, test and development commands

- `bun install --frozen-lockfile` installs the pinned Bun 1.3.14 workspace dependencies.
- `bun run dev` starts the desktop application. `bun run dev:workspace` starts the workspace
  services without the native shell.
- `bun run build` builds every package and application through Turbo.
- `bun run test` runs the workspace tests and the repository contract tests. `bun run test:dropins`
  covers the plugins.
- `bun run type-check`, `bun run lint` and `bun run format:check` are the full static checks used by
  CI. When diagnosing a full gate locally, run it without a path filter.
- `bun run check:tests` type-checks the test files, which `bun run type-check` excludes and
  `bun test` does not check.
- `bun run check:architecture` validates package, runtime, platform, storage and UI boundaries.
- `bun run check:docs` verifies that `docs/internals/subsystems/*.md` name source files that exist.
- CI runs `bun run check:rust` for the native shell; use it locally when diagnosing Rust failures.
- CI also runs `check:audit`, `check:deadcode`, `check:public`, `check:release` and `check:vendor`.
  Run an individual gate locally only when the change or a failure needs it. `check:audit` ignores
  one advisory, `GHSA-vfj7-8cjw-p6xm` (`braces`): no patched release exists, and it is reached only
  through the development tools `shadcn` and `shx`, never through shipped code. Drop the flag when a
  fix ships.

Run a focused test while you iterate, from the repository root:

```bash
bun test apps/ui/src/features/chat/model/sendRefs.test.ts
```

`bun test <filter>` matches substrings, so keep a filter specific. Run one file or one path rather
than the whole suite while iterating, and stop any dev server or browser you started when you
finish.

For an ordinary commit, stage the requested changes and run `git commit`. The pre-commit hook
automatically checks formatting and lint on staged files and Rust formatting when applicable. Do not
run the full build, test suite, type checks, audits or repository gates solely to create a commit,
and do not repeat the hook's checks manually. CI owns the full gate list in `CONTRIBUTING.md`.
During implementation, run only the focused test or check needed to verify the behavior being
changed. Fix hook failures and retry the commit; do not bypass the hook.

## Coding style

Oxfmt is authoritative: two-space indentation, a 100-column width, single-quoted strings, no
semicolons and trailing commas. Run `bun run format` to apply it and Oxlint to lint. Match the
surrounding module. Use `PascalCase` for React components and types, `camelCase` for functions and
`useX` for hooks. Keep feature-specific code inside its feature and expose cross-feature behavior
through typed shared ports or registries. Reuse the infrastructure that already exists, such as
bounded output capture, the priority queue and the kit's list rows, instead of writing a second
copy. New source files stay under 300 lines (`scripts/source-size-guard.test.ts`).

Build interface from the shared kit in `packages/kit`; do not hand-roll a control the kit already
has. [docs/internals/visual-system.md](docs/internals/visual-system.md) is the design contract and
the checks that enforce it.

Project design skills live in `.agents/skills`; `.agents/README.md` lists their roles and sources.
Before using them for Localix UI, read `.claude/skills/localix-ui-kit/SKILL.md` and the
visual-system contract above. Repository rules, existing kit components and tokens take priority
over generic skill examples, palettes, component installation commands and animation recipes.

## Testing

Bun Test is the default framework. Add a regression test for changed behavior, and cover reducers,
parsers and policies with deterministic unit tests. A guard needs a case proving that it fails when
it should. Use DOM tests only when interaction or accessibility needs rendered evidence. There is no
repository-wide coverage threshold, and new production behavior is expected to be meaningfully
exercised. A test that spawns a child process passes it a `timeout` and `killSignal: 'SIGKILL'`.

## Commits and pull requests

Follow the `type(scope): imperative summary` pattern, such as
`fix(context): retain active resource links`. Keep commits and pull requests focused. A pull request
describes the problem, the user-visible result, the exact verification commands, the risk and the
rollback; the [template](.github/pull_request_template.md) asks for each. Include before and after
screenshots or a recording for UI changes, and link the relevant issue.

Keep the documentation current in the same change. A new user-visible capability gets a page or a
section on the owning page and an entry in `docs/public-nav.json`.

## Security and repository hygiene

Never commit credentials, `.env` files, `.localix/` state, generated output, private project data or
local absolute paths. `bun run check:public` fails on each of those classes, including untracked
files, so run it before you stage anything unusual. Report a vulnerability through
[SECURITY.md](SECURITY.md) rather than a public issue. Treat changes under `vendor/` as intentional
upstream synchronizations and document them.

A schema change is a new file in `apps/api/migrations/`. No existing migration is renamed, edited or
deleted; see `apps/api/migrations/README.md`.

## Maintainers: the vendored runtime

`vendor/pi` is a fork that carries the Localix changes listed in
[`vendor/pi/UPSTREAM.md`](vendor/pi/UPSTREAM.md). Maintainers keep it current with
`bun run vendor:sync` (a git merge of an upstream snapshot, committed on its own),
`bun run vendor:sync:continue` and `bun run vendor:sync:abort`. The pre-commit hook in `.githooks/`
checks for upstream movement and refreshes the checked-in model catalog only when
`LOCALIX_MAINTAINER=1` is set, so an outside contributor's commit is never blocked by it.

## Public documentation and product media

Write public-facing copy in English. Before you add a product claim to the README, the landing page,
release notes or store metadata, verify it against the implementation that makes it true, and keep
planned, configured and default behavior distinct.

Every fenced block in the documentation needs a language such as `bash`, `ts`, `json` or `text`, and
the documentation build rejects unlabelled and oversized blocks. Show the smallest example that
teaches the contract and link to the source instead of pasting a whole implementation. Run
`bun run --cwd apps/landing generate` after changing public Markdown.

Real product captures live in `docs/assets/screenshots/` and nowhere else;
[its README](docs/assets/screenshots/README.md) owns the naming, the capture standard and the
freshness check.
