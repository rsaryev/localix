# Product screenshots

This is the single source folder for Localix captures used by the README, documentation, and landing
page. Dated PNG files are real product media. A reserved `--placeholder.png` slot is a clearly
labelled stand-in, excluded from the dated capture manifest and replaced by the next dated capture
of the same surface. It must not depict a fabricated product screen. Keep a reserved slot only when
it has an active consumer and a defined capture purpose; unused future slots are not documentation
evidence. External history has a [real dated capture](external-agents/history--2026-10-08.png).

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

The initial eight homepage captures are unretouched 4800×3000 PNGs, captured natively at 3× density
with a 1600×1000 viewport. Composition is set in the product by arranging panels and scrolling the
transcript.

The composer-context frame shows automatic open-file and terminal links, their sources and sizes. It
belongs to workspace context guidance; it does not show a context checkpoint or a selected code
snippet. The Source Control review frame shows an actual working-tree diff beside commit controls.
The 9 October context refresh checks two automatic sources and their estimated sizes in the popup;
the source file remains in an inactive tab beside the terminal, with no vertical editor split. The
Release Checklist frame shows a functioning fixture whose counter was checked by a UI toggle, with a
seeded conversation. These placements describe what is visible rather than implying an
agent-generated plugin or completed commit/push.

The 9 October browser refresh opens the local fixture through the address field and checks the
status change from its Review release button; it does not demonstrate feedback attachment.

The 9 October Kanban figures use four seeded cards in the dedicated fixture chat. A real keyboard
move places the release-notes card in Ready, and the assertions check the saved status and all four
cards fully inside the viewport. Empty columns are collapsed through their controls. Done states and
the adjacent transcript are illustrative fixture data, not evidence of an agent run.

The Reader frame uses a generated Markdown release review guide. Its scenario opens the selected
chapter and checks the chapter heading and two paragraph fragments. The image demonstrates chapter
navigation and rendered text; other supported document formats require their own evidence.

The Trading frame shows Kraken BTC/USD one-hour candles, volume bars, and a public order book on 8
October 2026. Its scenario reads the live candle response and checks more than 50 candles with valid
high/low ordering and positive closes. It does not assert order-book contents or exercise indicator
settings. The prices belong to the dated capture.

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
Guide board contains interactive components whose tab switching is checked. The optional Docker
capture opens only the dedicated demo container and shows actual logs and controls.

Historical light-theme demonstrations, old landing frames, before/after comparisons and transient
startup/error captures stay on disk as history, but are excluded from the current public manifest.
The CLI capture shows the real executable's startup screen with unauthenticated fixture
configuration; it does not prove a model run. Unused workspace-craft and autonomy placeholder slots
have been removed. Do not create replacement figures from an empty screen or a simulated running
task.
