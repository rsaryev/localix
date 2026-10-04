# Reader Workspace

Reader turns books and long-form documents into first-class Localix context. Open **Reader** from
the navigation rail and choose a book, open it from the file tree, or drop it into the workspace.

## Supported documents

Reader recognizes `.epub`, `.pdf`, `.mobi`, `.azw3`, `.fb2`, `.cbz`, `.md`, `.markdown`, `.html`,
`.htm`, and `.txt`. Reader is a read-only viewer and does not copy or alter the source file. An
explicitly selected absolute path may be anywhere on the computer; it does not have to live in the
active project. Dropped books also open directly through Localix's media store; the file does not
need an on-disk project path.

PDFs are exposed as bounded, selectable, searchable pages while Localix's exact-layout PDF viewer
remains available through the shared **Open With** chooser. MOBI and KF8/AZW3 use a pinned format
engine, preserve metadata and TOC labels, and inline bounded book images and covers. Reader rejects
DRM/password-protected or structurally invalid input rather than rendering active content.

The library never scans the workspace or home directory. It lists only books explicitly opened or
dropped by the user. EPUB archives and extracted chapter content have size and entry limits.

The gallery supports persistent multi-book collections, including empty shelves; a book may belong
to more than one collection. Selection mode provides bulk collection assignment and bulk removal.
Catalog title/author edits are stored as reversible overrides over parsed metadata, so restoring the
book's original metadata is one action and neither editing nor library removal changes the source
file.

The book segment in the reading breadcrumb is a searchable switcher for the explicit library. For
long shelves it focuses the filter as soon as the menu opens, announces the result count, moves from
the filter into the result list with Arrow keys, and selects the first match with Enter. Opening the
switcher revalidates the explicit shelf; concurrent requests use latest-response ownership and a
transient refresh failure preserves the last usable list instead of flashing empty.

## Reading and annotations

The center column is the reading surface. Switch between continuous scrolling and a paginated,
viewport-aligned column layout. The footer and left/right arrow keys turn pages in page mode and
cross chapter boundaries at either end. Font size, view mode, and reading position are restored
locally; switching modes and resizing the pane preserve the same relative passage while snapping to
a complete page instead of leaving two partial columns on screen.

For long sessions, Reader provides three local focus aids. Paragraph focus follows the block nearest
the reading line and exposes roving Arrow/Home/End keyboard navigation; the reading ruler follows
the pointer; and user-started auto-scroll supports pause, stop, selectable pace, and automatic
chapter continuation. The visual speed-reading view starts at the current passage, aligns each word
on its recognition point, adds punctuation-aware pauses, supports keyboard pacing and stepping, and
returns to the corresponding book position. These modes use Localix theme tokens and never send book
text to an external service.

The table of contents is a single-tab-stop tree with Arrow/Home/End navigation, and the cover
gallery uses the same roving spatial model. Internal links, search hits, and saved annotations move
focus to the revealed passage after layout settles. Position announcements report chapter/page
changes without announcing every scroll pixel; the reading viewport is a named keyboard stop, and
paginated mode keeps links, code scrollers, and annotations from off-screen columns out of the
sequential Tab order. The panel drawer and breadcrumb book switcher restore trigger focus when
dismissed.

EPUB cross-chapter and percent-encoded fragments resolve through Reader anchors; MOBI `filepos` and
KF8 Kindle positions are translated by the format engine into the same bounded chapter/fragment
contract before sanitization. Unsupported or unresolved schemes never reach the reading DOM.
Browser, mail, and telephone links route through the desktop host on primary or middle click;
delegated events already handled by the shared Markdown renderer are never opened twice, and
book-authored attributes cannot impersonate Reader's internal chapter route.

The status bar keeps a bounded browser-style Back/Forward trail (`Alt+Arrow` or `Mod+Bracket`) so a
link jump can return to the exact prior page fraction and revisit the resolved anchor. In paginated
mode an exact-link jump snaps the revealed anchor to one complete viewport page instead of leaving
two partial columns.

EPUB/DPUB footnotes, endnotes, definitions, and references keep their safe semantic metadata.
Activating a note reference opens a collision-aware Localix popover at the reference without losing
the reading position; it supports exact navigation, copy, and focus return. **Add context** attaches
the note as a bounded snippet beside its canonical chapter resource, without writing prompt text.
Semantic note, tip, caution, and warning callouts inherit the current Localix theme.

Safe embedded illustrations stay inline and bounded by the reading measure. Reader does not add a
second image-viewer surface or image-specific toolbar; linked illustrations keep ordinary in-book or
external-link navigation.

Select text to open a compact, collision-aware Localix toolbar beside the complete visible range. It
stays inside the reading surface, follows scroll/reflow, preserves the native selection while a menu
or popover owns focus, and uses Left/Right/Home/End without leaking those keys into page turns. From
the toolbar the reader can highlight in one of five theme-aware colors, attach an editable note, or
copy.

Clicking elsewhere simply clears the toolbar and native selection without moving the reading
position or rewriting surrounding text. The same anchors disambiguate repeated passages when
reopening annotations. Saving the same anchor updates the existing annotation instead of creating a
duplicate. Notes and highlights persist locally, can be removed without changing the book, and can
be exported per book as versioned JSON.

Search is available inside the open book (whole book or current chapter) and across the explicitly
opened shelf. Contains, whole-word, nearby-word, case/diacritic, and bounded regular-expression
modes share one platform-agnostic search engine. Results are grouped by chapter and reopen the exact
passage with a transient highlight.

## Agent context and links

Reader uses the same context model as the rest of Localix:

- The visible chapter is published as a `reader` resource binding, accompanied by a bounded snippet
  of the actual visible passage (or numbered page in page mode).
- A text selection adds a bounded snippet binding beside the chapter resource.
- The user asks naturally in the shared chat. Reader does not manufacture prompt text or duplicate
  chat actions in its toolbar; the agent receives the current resource and snippets through the
  normal context pipeline. Whole-book work can use the read-only `reader_research` tool to inspect
  the explicit shelf, outline, bounded chapters, and exact search passages.
- Books and chapters have stable `localix://resource/reader/...` links that can reopen the exact
  surface.
- The agent can browse the Reader resource tree and expand a library, book, or chapter through the
  context fabric.
- Titles and paths of explicitly opened books participate in global search.

This keeps one conversation and one binding system across code, documents, and reading material;
there is no separate assistant history inside Reader.

## Capability matrix

This table is evidence-based. “Partial” means the current UI and tests prove only the listed subset.

| Capability                   | Current state | Evidence / remaining work                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Formats                      | Implemented   | EPUB, PDF, MOBI/KF8/AZW3, FB2, CBZ, Markdown, HTML, and TXT. EPUB fragment/cross-chapter and MOBI/KF8 file-position links resolve into safe Reader navigation; host-routed browser/mail/telephone activation supports primary and middle click without duplicate Markdown opens. PDF pages remain searchable/selectable with the exact-layout native viewer available; archive, text, page, image, and decompression budgets are enforced.        |
| Scroll / page modes          | Implemented   | Continuous and viewport-aligned paginated layouts, resize-safe page snapping, exact page counter, keyboard/footer turns, cross-chapter boundaries, and mode-preserving progress.                                                                                                                                                                                                                                                                  |
| Full-text search             | Implemented   | Book, chapter, and explicit-shelf search; grouped results, exact navigation, contains/whole/nearby/regex options.                                                                                                                                                                                                                                                                                                                                 |
| Annotations                  | Implemented   | Durable contextual anchors, dedupe, five colored highlights, editable notes, instant creation, exact navigation, deletion, chapter bookmarks, agent bindings, bounded JSON import/export, semantic EPUB footnote/endnote previews, and a reflow-safe collision-aware selection toolbar with exact chapter-plus-snippet context.                                                                                                                   |
| Dictionary / Wikipedia       | Not included  | Removed from Reader to keep selection focused on annotations and copying; no external lookup surface or network adapter ships in the plugin.                                                                                                                                                                                                                                                                                                      |
| Parallel read                | Implemented   | A responsive two-pane reader keeps independent books, chapters, positions, controls, keyboard ownership, and merges both visible passages into one bounded agent context.                                                                                                                                                                                                                                                                         |
| Font and layout              | Implemented   | The appearance menu (one submenu per setting) controls typeface, font size, line spacing, measure, page margins, natural/justified alignment, and reset; scroll/page mode and reading position persist.                                                                                                                                                                                                                                           |
| Code highlighting            | Implemented   | Markdown uses the shared renderer; EPUB/HTML preserves bounded `language-*` hints and highlights common languages with Localix semantic color tokens and block limits.                                                                                                                                                                                                                                                                            |
| File association / Open With | Implemented   | EPUB/MOBI/AZW3/FB2/CBZ open in Reader; PDF, Markdown, HTML, and TXT are alternate reading views. Native and multi-plugin collisions use the same chooser and remembered choice.                                                                                                                                                                                                                                                                   |
| Library management           | Implemented   | Explicit add, identity dedupe, remove-without-file-delete, covers, responsive gallery, title/author/path/content search, persisted sorting, multi-membership collections (including empty shelves), reversible metadata overrides, bulk collection assignment/removal, and a revalidating keyboard-first breadcrumb book switcher.                                                                                                                |
| OPDS / Calibre               | Missing       | External catalog/source adapters are not implemented.                                                                                                                                                                                                                                                                                                                                                                                             |
| Translation                  | Deferred      | Removed pending a separate product-level translation design; Reader currently exposes no translation button, dialog, intent, or provider adapter.                                                                                                                                                                                                                                                                                                 |
| TTS / read-along             | Missing       | Browser/native speech and EPUB 3 Media Overlays are not implemented.                                                                                                                                                                                                                                                                                                                                                                              |
| Sync / KOReader              | Missing       | Progress, annotation, and file synchronization adapters remain.                                                                                                                                                                                                                                                                                                                                                                                   |
| Accessibility                | Partial       | Browser accessibility-tree, keyboard, narrow-pane, and 320 CSS px reflow audits cover named regions/controls, active-book breadcrumb semantics/focus return, visible-page-only Tab stops, roving TOC/gallery/paragraph/selection-toolbar focus, overlay-owned Escape, exact target focus, quiet live position, drawer restoration, inert reading overlays, and reduced-motion-safe transitions. Manual VoiceOver/NVDA/Orca compatibility remains. |
| Visual focus aids            | Implemented   | Theme-native reading ruler, viewport-following paragraph focus with roving keyboard navigation, user-controlled auto-scroll with chapter continuation, and local punctuation-paced RSVP/speed reading with exact position return.                                                                                                                                                                                                                 |
| AI summarization             | Implemented   | The shared agent receives the visible chapter/page/selection through automatic context, so the user can ask naturally without Reader-specific prompt buttons. Whole-book work uses the read-only explicit-library research tool with bounded outline/read/search results and chapter resource provenance.                                                                                                                                         |
| Reading stats                | Implemented   | Local idempotent active-reading events drive per-book time, sessions, positions, active days, 14-day activity, current/longest streak, average session, and progress. Idle/background time is capped and no external analytics service is used.                                                                                                                                                                                                   |
| Audiobooks / handwriting     | Missing       | Planned after core text-reader and annotation architecture is complete.                                                                                                                                                                                                                                                                                                                                                                           |

## Layering

- `shared/` owns bounded identities, contracts, and pure document/search policy.
- `backend/` owns untrusted file parsing, explicit-library and private statistics persistence,
  resource expansion and read-only agent retrieval.
- `ui/` owns workbench state and rendering; pure pagination and selection geometry are separated
  from their DOM lifecycle adapters, and neither reads arbitrary files or imports backend/agent
  state directly.
- Localix host services remain the ports for files, media, clipboard, composer bindings, search, and
  context. External providers must be added behind ports rather than imported into the reading UI.
