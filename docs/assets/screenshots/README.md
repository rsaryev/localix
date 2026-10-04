# Product screenshots

This is the single source folder for Localix captures used by the README, documentation, and landing
page. Uncaptured slots are omitted; dated PNG files are the only product media.

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

- PNG, exactly **1600×1000**.
- English UI and deterministic demo data.
- Dark appearance unless the feature is specifically about the light one.
- Capture the real product. A fixture project is acceptable; a fabricated product screen is not.
- No personal names, private paths, real conversations, secrets, keys, tokens, unrelated apps, or
  desktop chrome.
- Inspect the final file at full size before committing it.

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
