# Repository Guidelines

Localix uses Bun 1.3.14 and Turborepo. [CONTRIBUTING.md](CONTRIBUTING.md) documents the workflow;
[docs/internals/code-map.md](docs/internals/code-map.md) maps source ownership.

## Development Workflow

- Read relevant files, batch independent searches, and avoid rereading unchanged material.
- Make focused changes using existing infrastructure; avoid unrelated cleanup.
- Run checks for concrete questions. Documentation-only edits need no build or runtime tests. Do not
  routinely run every gate.
- Repeat successful checks only after relevant changes or for unresolved failures.
- For requested commits, stage intended changes and commit. Pre-commit checks formatting, lint, and
  applicable Rust formatting; do not duplicate those checks manually or bypass failures.
- Full builds, suites, type checks, audits, and repository gates belong to CI. Run individual gates
  when needed or explicitly requested. Report verification accurately; stop servers and browsers you
  started.

## Project Structure

`apps/` holds the Hono API, React/Vite UI, Tauri shell, and landing website. Shared libraries live
in `packages/`, extensions in `plugins/`, automation in `scripts/`, configuration in `config/`, docs
in `docs/`, and media in `assets/`. Keep feature code within its owner; use typed ports for
cross-feature behavior.

## Common Commands

- `bun install --frozen-lockfile`: install dependencies when needed.
- `bun run dev`: desktop; `bun run dev:workspace`: workspace services.
- `bun run build`: full build; `bun run test`: full suite.
- `bun test apps/ui/src/features/chat/model/sendRefs.test.ts`: focused test from the root.

## Coding Style

Oxfmt: two-space indentation, 100-column width, single quotes, no semicolons, trailing commas.
Format edited files. Use Oxlint, `PascalCase` components/types, `camelCase` functions, and `useX`
hooks. New source files stay under 300 lines.

Use `packages/kit` for UI. First read `.claude/skills/localix-ui-kit/SKILL.md` and
`docs/internals/visual-system.md`; repository components and tokens take precedence over generic
skills.

## Testing

Use Bun Test with colocated `*.test.ts`/`*.test.tsx`; use `*.dom.test.tsx` for interaction or
accessibility evidence. Add meaningful regression tests for behavior changes and failure cases for
guards. No coverage threshold. Child-process tests require a timeout and `killSignal: 'SIGKILL'`.

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
