# Repository Guidelines

Localix uses Bun 1.3.14 and Turborepo. [CONTRIBUTING.md](CONTRIBUTING.md) documents the workflow;
[docs/internals/code-map.md](docs/internals/code-map.md) maps source ownership.

## Development Workflow

- Read relevant files, batch independent searches, and avoid rereading unchanged material.
- Make focused changes using existing infrastructure; avoid unrelated cleanup.
- Run checks for concrete questions. Documentation-only edits need no build or runtime tests. Do not
  routinely run every gate.
- Repeat successful checks only after relevant changes or for unresolved failures.
- For requested commits, stage intended changes and commit. Pre-commit checks formatting, lint,
  affected source/test types, focused tests, and applicable Rust formatting/Clippy; do not duplicate
  those checks manually or bypass failures.
- Pre-push runs the CI gates for affected packages (`--affected`); commit or stash first. Full
  builds belong to CI. Run optional architecture, documentation, and audit gates when relevant or
  explicitly requested. Report verification accurately; stop servers and browsers you started.

## Project Structure

`apps/` holds the Hono API, React/Vite UI, Tauri shell, and landing website. Shared libraries live
in `packages/`, extensions in `plugins/`, automation in `scripts/`, configuration in `config/`, docs
in `docs/`, and media in `assets/`. Keep feature code within its owner; use typed ports for
cross-feature behavior.

## Architecture

Read [docs/internals/architecture/README.md](docs/internals/architecture/README.md) before changing
how features, packages or surfaces depend on each other. Its rules have ids (A1–A8, C1–C7); cite the
id when a change touches one, and record any exception in the audit rather than in code.

- Keep the core agnostic: no provider SDK, UI framework, transport or storage engine in
  `packages/agent` or `packages/engine-loop`; adapters live at the edge.
- Dependencies point inward. Only `apps/api/src/bootstrap/` builds another feature's repository or
  service; Kysely belongs in repositories; domain code throws domain errors, routes map them to
  HTTP.
- Owners announce, consumers react: a write records its change notice in its own transaction, and a
  follow-up in another feature runs in a change-feed consumer unless it is a documented command.
- Consumers are idempotent and reconcilable; derived data can be rebuilt from its owners.
- Store identities that survive recreation; a provider connection id is a hint for a model route.
- UI: no imports between slices of the same layer; clients re-read on a poke, and a write never
  patches another surface's store.

## Common Commands

- `bun install --frozen-lockfile`: install dependencies when needed.
- `bun run dev`: desktop; `bun run dev:workspace`: workspace services.
- `bun run build`: full build; `bun run test`: full suite.
- `bun test apps/ui/src/entities/chat/model/sendRefs.test.ts`: focused test from the root.

## Coding Style

Oxfmt: two-space indentation, 100-column width, single quotes, no semicolons, trailing commas.
Format edited files. Use Oxlint, `PascalCase` components/types, `camelCase` functions, and `useX`
hooks. New source files stay under 300 lines.

Use `packages/kit` for UI. First read `.claude/skills/localix-ui-kit/SKILL.md` and
`docs/internals/visual-system.md`; repository components and tokens take precedence over generic
skills.

## Testing

Read [docs/internals/testing.md](docs/internals/testing.md) before writing tests. Use Bun Test with
colocated `*.test.ts`; `*.dom.test.tsx` for interaction or accessibility evidence;
`*.integration.test.ts` for real processes, PTYs, watchers or long replays (never in `test`). Unit
tests never sleep: inject the delay, clock or window as an option. Use `@localixai/testing` for temp
dirs (`tempDirPerTest`), processes (`run`, deadline + SIGKILL), git (`scratchGitEnv`) and network
(stub `fetch`; real hosts fail). Each file passes alone and under `--isolate`; run big suites as
shards (`scripts/test-shards.mjs`), never `--parallel`. Add a regression test that fails without the
fix. No coverage threshold.

## Commits and Pull Requests

Use `type(scope): imperative summary`, `fix(context): retain active resource links`. Follow
`.github/pull_request_template.md`: problem, result, verification, risk, rollback, relevant issue,
and UI captures.

## Documentation and Hygiene

Document new capabilities and update `docs/public-nav.json`. Public copy is English; verify claims
and label fenced blocks. Generate public Markdown changes once with
`bun run --cwd apps/landing generate`. Captures belong in `docs/assets/screenshots/`.

Never commit secrets, `.env`, `.localix/`, generated output, private data, or local absolute paths.
Use `check:public` for suspicious files. Add migrations without editing existing ones. Document
`vendor/` synchronizations. Report vulnerabilities via `SECURITY.md`.

## Releases

Before tagging, write what is new. The version's `CHANGELOG.md` section becomes the GitHub release's
Highlights and the "What's new" of the app's update dialog, and the release workflow stops a version
without one (`scripts/assert-release-changelog.mjs`). Then follow the steps in
[docs/internals/contributing.md](docs/internals/contributing.md#workflows-and-releases).

1. Collect: `git log <last-tag>..origin/main` with bodies, plus the entries under `## Unreleased`.
   Read the diff where a subject does not say what a person would notice.
2. Write `## v<version> — <YYYY-MM-DD>` above the previous version; move the `Unreleased` entries
   into it and leave `## Unreleased` empty.
3. Open with one or two sentences on what the release is about. Then `### Added`, `### Changed`,
   `### Fixed`, `### Removed`, only the groups that have entries, most important entry first.
4. Write for the person using the app: what they can now do or will notice, and where (Settings → …,
   a command, a panel). Start an entry with the feature in bold. Merge commits that make one change
   into one entry. Leave out refactors, tests, CI, internal docs and dependency bumps that change
   nothing visible. No commit hashes, file paths or internal module names. Check each claim against
   the code.
5. Aim for at most about twelve entries; commit the section as `docs(changelog): v<version>`.

For changes to how a run is assembled or routed (run policy axes in
`apps/api/src/features/chat/policy`, prompt sections in `agent-core/prompt`, tool gating,
membership, handoffs), run the end-to-end scenarios with
`bun run test:sessions --grep '<behaviour>'`. They boot an isolated API with a scripted model and
assert on the transcript and on the prompt and tools each model request carried. Use `--keep` and
the request log to debug a conversation behaviour. Add a scenario for a new behaviour. See
[scripts/session-e2e/README.md](scripts/session-e2e/README.md). Not part of the normal suite or CI.

## UI evidence and screenshots

Maintain the optional capture tests with visible feature changes. Read
[scripts/screenshots/README.md](scripts/screenshots/README.md) before taking product captures.
Update the owning scenario and meaningful assertions when its UI or behavior changes; add a scenario
and deterministic fixture for a new visual feature. Keep semantic keys in
[scripts/screenshots/plan.mjs](scripts/screenshots/plan.mjs) stable and name each image for the
action or result it proves. Avoid unrelated screens, empty placeholders and private workspace data.

Run `bun run test:screenshots --grep '<semantic-key>'` deliberately; these tests are not in the
normal suite or CI. Review their native 3× captures. `bun run screenshots:update --grep '<key>'`
refreshes approved compositions, updates existing Markdown references and generates the landing only
after the test run passes. Add new figures where they help the guide, not everywhere. Do not
hand-edit generated shot manifests or recolor screenshots. Stop the isolated capture runtime and any
fixture services you started.
