# Product screenshots

This is the single source folder for Localix captures used by the README, documentation, and landing
page. Dated PNG files are real product media. A reserved `--placeholder.png` slot is a clearly
labelled stand-in, excluded from the dated capture manifest and replaced by the next dated capture
of the same surface. It must not depict a fabricated product screen. The External history slot is
reserved at `external-agents/history--placeholder.png` until its real capture is supplied.

## Naming

Use a semantic directory and a dated filename:

```text
docs/assets/screenshots/<feature>/<surface>--YYYY-MM-DD.png
```

Examples:

```text
docs/assets/screenshots/task-board/board--2026-08-06.png
docs/assets/screenshots/workspace/editor-grid--2026-08-06.png
docs/assets/screenshots/providers/connections--2026-08-06.png
```

The path identifies what the image proves. The date records when the UI was captured. Do not store
either value in a second hand-maintained manifest.

## Capture standard

- PNG, a **1600×1000 CSS-pixel** composition. Capture natively at 1×, 2×, or 3× density (1600×1000,
  3200×2000, or 4800×3000 physical pixels). Use 3× for homepage media; never upscale an existing
  capture. Placeholder slots remain 1600×1000.
- English UI and deterministic demo data.
- Dark appearance unless the feature is specifically about the light one.
- Capture the real product. A fixture project is acceptable; a fabricated product screen is not.
- No personal names, private paths, real conversations, secrets, keys, tokens, unrelated apps, or
  desktop chrome.
- Inspect the final file at full size before committing it.

## Release Studio captures

The 2026-10-07 and 2026-10-08 homepage captures use the running Localix web UI with a separate demo
database, English fixture conversations, and the Release Studio project. They show the real editor,
terminal, browser, Project Space, Kanban, and context controls. The terminal's two passing tests
were run in the fixture project. No model response was generated during capture.

The preview project and the working Release Checklist demo plugin are preserved under
`fixtures/release-studio/`. The plugin uses the host's UI kit; its completion counter and progress
bar were checked by toggling a checklist item before capture. It is a capture fixture, not an
included workbench. Databases, provider credentials, generated plugin bundles, and local runtime
paths are not stored here.

All eight captures are unretouched 4800×3000 PNGs, captured natively at 3× density with a 1600×1000
viewport. Composition is set in the product by arranging panels and scrolling the transcript. The
homepage's generator preserves the original pixels and selects the dated images in place of their
placeholder slots.

## Freshness check

The date is a review trigger, not an automatic expiry.

1. Read the semantic path to identify the feature and surface.
2. Run `git log --since=<capture-date> -- <related source paths>`.
3. Inspect only commits that could change visible behavior.
4. Recreate the scenario and compare it with the capture.
5. Add a new dated file only when the visible product changed; keep history rather than overwriting
   the old capture.
6. Update consuming Markdown to the new dated path. The landing generator selects the newest dated
   capture for a semantic key.

Do not hardcode a feature-to-source map: the owning paths move, and the agent doing the review must
resolve them from current docs, code search, and git history.

## Optional capture tests

[The capture workflow](../../../scripts/screenshots/README.md) preserves the demo setup, native UI
compositions, readiness checks and feature assertions. It is an opt-in Playwright suite, excluded
from the ordinary Bun suite and CI. `plan.mjs` records each image's purpose, owning guide and stable
semantic key, plus reviewed existing captures and archive-only comparisons.

Use `bun run test:screenshots --grep '<semantic-key>'` for a reviewed capture. Use
`bun run screenshots:update --grep '<semantic-key>'` to test, refresh its dated PNG, update existing
public Markdown references and regenerate the landing after a successful run. New figures still need
a deliberate placement in the relevant guide. Failed runs cannot automatically publish.

The 2026-10-08 documentation refresh uses the same dark product appearance and 3× standard. Agent
profiles focus on standing instructions, context and turn limits. Resumes show a populated PDF
beside its fields. SQLite results come from querying the fixture's release checks. The Markdown
Guide board contains interactive components whose tab switching is checked. Queued questions are
restored from deterministic fixture records; they are not attributed to a live model. The optional
Docker capture opens only the dedicated demo container and shows actual logs and controls.

Historical light-theme demonstrations, old landing frames, before/after comparisons and transient
startup/error captures stay on disk as history, but are excluded from the current public manifest.
Reserved autonomy and external CLI slots remain unpublished until a real, useful scenario is
available. Do not fill them with an empty screen or a simulated running task.
