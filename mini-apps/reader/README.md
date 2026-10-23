# Reader Workspace

Reader is a focused local reading surface for EPUB, PDF, MOBI/KF8/AZW3, FB2, CBZ, Markdown, HTML,
and plain-text documents. It stores reading preferences, annotations, and progress in the browser;
its backend persists the explicit shelf and reading statistics. It exposes books, chapters, and
selected passages through Localix's native resource, binding, search, and context systems.

## What it provides

- An explicit-only library: only documents the user opens or drops are added.
- A responsive cover gallery with search/sort, persistent multi-book collections, reversible catalog
  title/author overrides, bulk assignment/removal, roving spatial keyboard navigation, and a
  searchable book switcher in the breadcrumb with type-first focus, result announcements, and
  Arrow/Enter keyboard selection. Opening the switcher revalidates the shelf with latest-request
  ownership, so additions, removals, and metadata edits do not require a mini app restart.
- EPUB spine/navigation parsing; selectable, reflowed PDF text; MOBI/KF8 metadata, TOC, cover, text,
  and bounded images plus resolved `filepos`/Kindle position links; browser/mail/telephone links use
  the desktop host for primary and middle click without duplicate delegated opens; FB2 sections;
  naturally ordered CBZ pages with ComicInfo metadata; Markdown headings, HTML, and plain text.
- Path-backed books from anywhere on the computer and media-backed files opened by drag-and-drop.
- A distraction-light reader with table of contents, progress restoration, typeface, spacing,
  measure, margin, and alignment choices, contextual colored highlights, editable notes, annotation
  export, a collision-aware selection toolbar that survives reflow and toolbar focus, a semantic
  roving TOC, quiet page/chapter announcements, exact link-target focus, keyboard navigation,
  visible-page-only Tab stops, resize-safe page snapping, and responsive sidebars.
- Safe EPUB/DPUB note semantics, theme-native callouts, and anchored footnote/endnote previews with
  exact navigation, copy, focus return, and chapter-plus-snippet agent bindings.
- Book illustrations remain safe, bounded inline content; Reader does not add a competing image
  viewer or image-specific toolbar.
- Theme-native paragraph focus, reading ruler, safe auto-scroll with chapter continuation, and a
  local punctuation-paced speed-reading view that returns to the corresponding passage.
- Responsive parallel reading with independent navigation and combined, bounded agent context.
- Native `localix://resource/reader/...` links for books and chapters.
- Safe in-book navigation for exact and percent-encoded fragments, cross-chapter EPUB links, and
  format-resolved MOBI/KF8 destinations, with settled focus, transient target highlighting, and a
  bounded Back/Forward trail that preserves exact anchors or the latest page fraction.
- Live message context for the canonical chapter, actual visible passage/page, and text selection.
- Natural shared-chat agent work without Reader-specific prompt buttons: current resources and
  snippets flow through the ordinary automatic context pipeline instead of mutating the draft.
- A read-only `reader_research` tool that can inspect outlines, bounded chapters, and exact passages
  only for books already on the explicit shelf; long chapters continue through contiguous UTF-16
  offsets that preserve surrogate pairs.
- Private local reading insights for active time, sessions, positions, streaks, and a trail of the
  latest 14 active dates; background/idle segments are bounded and retries are idempotent.
- Search hits for explicitly opened books and a resource tree the agent can browse or expand.

Reader never modifies source documents or scans folders. Parsed content, archive expansion, and
agent context are bounded. Explicit absolute paths may point anywhere on the computer; relative
paths are still contained inside the active workspace. Active content is removed from HTML before
rendering.

The workbench has no private theme. It inherits Localix surface, text, border, selection, accent,
font, radius, and light/dark tokens so it stays visually aligned with the active UI theme.

## Persistence and limits

- The backend stores `library.json` and `stats.json` in the mini app data directory. The shelf
  records source identities, metadata overrides, and collections; it does not copy path-backed
  books. Removing a shelf entry leaves its source document intact.
- Preferences, highlights/notes, bookmarks, sorting, and per-book progress use browser
  `localStorage`. They follow that browser storage context; clearing it removes those records.
- Sources are limited to 64 MiB. EPUB/CBZ archive parsing accepts at most 3,000 entries and 160 MiB
  of uncompressed content. Parsed documents retain at most 400 chapters; PDF inputs above 400 pages
  are rejected. Large chapter text is truncated, and oversized chapter markup falls back to bounded
  text.
- PDF support extracts existing text into a reflowed reading view. It does not render the original
  page layout or provide OCR for scanned pages.
- Resource expansion is capped at 48,000 characters. `reader_research` reads at most 32,000
  characters per call and returns a continuation offset when more remains.
- Reading events are capped at two minutes each, deduplicated by event ID, and retained up to 50,000
  events. Aggregate history reflects the retained events; the daily trail lists active dates rather
  than filling every calendar day.

## Architecture

- `backend/library.ts` — path safety and format parsers.
- `backend/pdf.ts` / `backend/mobi.ts` — lazy, bounded PDF and Mobipocket engine adapters.
- `backend/resource-provider.ts` — browseable books/chapters and model-facing expansion.
- `backend/service.ts` — explicit-library identity, versioned persistence, metadata overrides, and
  collection/bulk operations without source-file mutation.
- `backend/context-provider.ts` — shared context-fabric adapter.
- `backend/search-provider.ts` — global search integration.
- `backend/research-tool.ts` — bounded, read-only agent retrieval for linked books.
- `backend/stats.ts` — private local reading-event persistence and derived insights.
- `ui/ReaderWorkspace.tsx` — library and reader workbench.
- `ui/pagination.ts` — pure viewport/page math and visible-page keyboard focus policy.
- `ui/useReaderPageLayout.ts` — DOM layout adapter for reflow, resize snapping, and tab stops.
- `ui/selection.ts` — pure selection-toolbar geometry and visible-range edge policy.
- `ui/useReaderTextSelection.ts` — native selection lifecycle and quote-anchor rehydration adapter.
- `ui/ReaderSelectionToolbar.tsx` — compact Localix actions for highlighting, notes, and copying.
- `ui/ReaderReadingToolsMenu.tsx` — progressive disclosure for layout, focus, playback, and
  parallel-reading modes.
- `shared/resource-uri.ts` — stable book/chapter resource identifiers.

MOBI/KF8 parsing uses the MIT-licensed `foliate-js` package, pinned in `package.json`; the Localix
workbench, context integration, persistence, and safety policy are independent.

## Development

```sh
bun run --cwd mini-apps/reader type-check
bun test mini-apps/reader
```

## Source of truth

- [Mini app manifest](mini-app.json)
- [Backend registration and storage paths](./backend/index.ts)
- [Explicit shelf and collections](./backend/service.ts)
- [Format parsing and path containment](./backend/library.ts)
- [PDF text extraction](./backend/pdf.ts)
- [MOBI/KF8 adapter](./backend/mobi.ts)
- [Research tool and continuation offsets](./backend/research-tool.ts)
- [Resource expansion](./backend/resource-provider.ts)
- [Reading events and aggregates](./backend/stats.ts)
- [Browser storage](./ui/readerStorage.ts)
- [Reading interactions](./ui/ReaderReadingPane.tsx)
