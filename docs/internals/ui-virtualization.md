# UI virtualization

Localix mounts a bounded row window for chat, file trees, tables, the usage requests log, live logs,
and external-agent rosters. This bounds mounted DOM rows while feature models retain paging,
selection, navigation, and follow state. Where a window would break a gesture the surface owns — the
Kanban mini app board's drop index — the board is bounded by a rendered cap with a **Show more**
tail instead.

**Boundary:** Virtualization changes rendering only. It does not cap retained data or replace server
paging.

## Contract

| Surface                | Mechanism                                                                                                   | Boundary                                                                                           |
| ---------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Chat transcript        | Variable-height rows use `renderKey`, end anchoring, measured-height snapshots, and an eight-row overscan   | `useAutoScroll` owns follow and explicit user intent; the virtualizer owns row geometry            |
| File tree              | A flat `FileTreeRow[]` drives 24-pixel estimated rows, semantic navigation, and scroll-to-path              | Content search has its own renderer and virtualizer; the tree virtualizer is disabled in that mode |
| Content search         | A flat `SearchRow[]` drives per-kind estimates and measured rows for folder, file, and match rows           | `useContentSearch` owns results, expansion, and replace preview; the virtualizer owns row geometry |
| Data tables            | `TableGrid` renders 30-pixel rows and requests another page near the loaded tail                            | The caller owns paging, sorting, editing, and the total row count                                  |
| Usage requests log     | `LogsTable` mounts a window of 36-pixel table rows between two spacer rows inside the same `<table>`        | `useUsageLogs` owns paging; the sentinel below the spacers still pages at the true tail            |
| DevOps live logs       | Measured rows use end anchoring and `followOnAppend` while the viewer is live                               | Upward wheel or keyboard intent pauses live mode; resume returns to the tail                       |
| External-agent history | Core virtualizes 28-pixel day headers and 32-pixel agent/session rows; 8-row overscan and 200-session pages | The External history tab and resource container views share this surface                           |
| Source Control tree    | A flat `ChangesTreeRow[]` per section drives measured 28-pixel rows against the panel's one scroll area     | One delegated context menu per tree; the roving Tab stop is pinned into the rendered range         |
| Diff views             | One flat document of file, hunk and line rows with exact per-kind heights and a pinned-header overlay       | The document owns parsing and change runs; highlight and word marks run per mounted line           |

## How it works

### Row geometry

Each surface gives `@tanstack/react-virtual` a row count, scroll element, size estimate, and
overscan. The virtualizer sizes one relative spacer with `getTotalSize()` and positions the mounted
rows with absolute transforms. The usage requests log is the one exception: it stays a real
`<table>` so its columns, sticky header, and cross-row text selection are unchanged, so its window
sits between a top and a bottom spacer `<tr>` that carry the height of the unmounted rows instead.

Changing collections provide domain keys: chat uses `renderKey`, the tree uses its flat-row key,
logs use the parsed line key, and the roster uses its session key. Content-search rows key on the
node path, and match rows qualify that with the match index so two hits on one line stay distinct.
`TableGrid` uses the loaded row index because pages append without reordering inside the grid, and
the usage requests log keys on the ledger message id.

Chat and log rows attach `measureElement` to rendered rows. Tables and roster rows keep fixed
heights. The file tree also measures its flat rows so inline edit and status rows remain in the same
layout model.

Content-search rows are genuinely variable-height, so `estimateSearchRowSize` seeds each row from
its kind — a folder or file header is one header line box, and a match row is its match line plus
every context line rendered inside it — and `measureElement` corrects each row once it mounts. A
fixed estimate would misplace the scrollbar as soon as context lines are switched on.

### Reverse feeds and follow policy

`anchorTo: 'end'` retains a visible keyed row when chat history or log rows change. `scrollToEnd()`
reconciles estimates after measurement, and `followOnAppend` keeps live logs at the tail only when
they were already there.

Chat deliberately keeps a second policy layer. `useAutoScroll` distinguishes programmatic movement
from wheel, touch, keyboard, pointer, and nested-scroll input. Opening a session starts at its live
tail; temporary geometry loss in the same open surface restores the saved reading position.

Measured chat rows are cached for at most eight sessions, with at most 20,000 measurements per
session. Position and follow state are cached for at most 64 sessions.

### Hidden work items and logical navigation

Warm workspace items remain mounted under `display: none`. `WorkItemVisibilityProvider` supplies
synchronous visibility so chat, logs, and tables can disable measurement before a hidden surface
publishes zero-sized geometry. Chat and logs retain cached measurements while hidden.

The file tree computes arrow navigation, typeahead, selection, and reveal from the complete flat
model. Its range extractor keeps the active row and inline editor mounted when either falls outside
the normal virtual window.

### The Store's lists

A Store shelf, search result or collection is read by keyset cursor, a page at a time, and rendered
through `features/store/ui/PagedList`: a `@tanstack/react-virtual` window over the loaded rows, two
columns at a wide pane, one at a narrow one. The next page is asked when the window comes within a
screen of the end, so a shelf of thousands of plugins mounts about a screenful of rows. The scroller
reports its own size, so a test that renders it stubs `clientHeight` and `clientWidth`
(`apps/ui/src/testing/storeLayout.ts`).

## Configuration

These values are implementation constants, not Settings controls.

| Surface               | Estimate | Overscan | Additional policy                                                                    |
| --------------------- | -------: | -------: | ------------------------------------------------------------------------------------ |
| Chat transcript       |   220 px |   8 rows | End threshold 80 px; dynamic measurement; cached snapshots                           |
| File tree             |    24 px |  12 rows | Active and edit rows can be pinned outside the visible range                         |
| Content search        | Per kind |  12 rows | 23 px header rows; 19 px match line plus 18 px per context line; measured            |
| Data tables           |    30 px |  16 rows | Requests another page within 12 rows of the loaded tail                              |
| Usage requests log    |    36 px |  16 rows | Spacer rows carry the unmounted height; measurement is gated on work-item visibility |
| DevOps live logs      |    18 px |  12 rows | End threshold 32 px; dynamic measurement when rows wrap                              |
| External-agent roster |    46 px |  10 rows | Initial geometry is seeded at 720 × 640 px                                           |
| Diff views            | Per kind |  16 rows | 20 px line, 24 px hunk, 28 px file rows, scaled by root font size; exact, unmeasured |

## Terminology

| Term               | Meaning in this subsystem                                                     |
| ------------------ | ----------------------------------------------------------------------------- |
| Logical collection | The rows currently available to the feature model, including unmounted rows   |
| Virtual row        | Geometry for one logical row, whether or not its DOM node is mounted          |
| Estimate           | Initial row size used before measurement or for a fixed-height surface        |
| Measurement        | Observed size of a mounted row, keyed for later reconciliation                |
| Overscan           | Rows mounted beyond the visible range to absorb nearby scrolling              |
| End anchoring      | Adjustment that preserves the tail or a visible keyed row as geometry changes |

## Limits

- `LogsTable` uses auto table layout, so column widths are computed from the mounted window rather
  than from every loaded row.
- Kanban mini app columns are bounded by a cap, not a window. `capColumn` renders the first
  `KANBAN_COLUMN_CAP` cards of a column and offers **Show more**; the rest are counted, not mounted.
  The cap exists because `useKanbanDrag` derives a drop index by counting the column's rendered
  `[data-task-card]` nodes and applies it to the logical section list — that mapping holds only
  while the rendered cards are the logical list's prefix, which a window would break. Shift-range
  selection spans the rendered cards; the column header count keeps describing every card.
- The event journal is bounded by retention: `NOTIFICATIONS_CAP` (200) caps the store, the popover
  is behind a dynamic import, and 200 rows of that complexity mount about 5.4k DOM elements (counted
  in the DOM test environment) once per open. It is not virtualized.
  `NotificationCenter.bound.dom.test.tsx` pins the rendered row count to the cap, so raising the cap
  forces that decision to be made again.
- Expanding **See all** in `ChatSidebar` renders every root session and its disclosed descendants.
  The default view caps root sessions at 40.
- Diff rows are fixed-height and never wrap: a long line scrolls sideways instead. A line past
  10,000 characters mounts its first 10,000 and counts the rest.
- Chat has two cooperating scroll layers: `MessageList` owns virtual geometry and `useAutoScroll`
  owns reader intent. A change to either layer must preserve the chat scroll DOM tests.
- Offscreen rows do not exist in the DOM. Browser find and DOM queries cannot discover them unless
  the owning feature materializes the target from its logical model.
- The repository has deterministic model and DOM tests for current surfaces, but no committed
  browser performance benchmark. Do not attach a numeric speed or memory claim to virtualization.

## Related guides

- [Workspace](../features/workspace.md)
- [Architecture](architecture.md)
- [Data-view subsystem](subsystems/data-view.md)

## Source of truth

- [Chat rows and geometry](../../apps/ui/src/entities/chat/ui/MessageList.tsx) ·
  [scroll policy](../../apps/ui/src/shared/hooks/useAutoScroll.ts) ·
  [snapshot cache](../../apps/ui/src/shared/hooks/chatScrollState.ts)
- [Content-search flattening](../../apps/ui/src/features/inspector/ui/search/searchTreeRows.ts) ·
  [results geometry](../../apps/ui/src/features/inspector/ui/search/SearchResultsTree.tsx) ·
  [row renderer](../../apps/ui/src/features/inspector/ui/search/SearchTreeView.tsx)
- [File-tree flattening and rendering](../../apps/ui/src/features/inspector/ui/fileTreeRows.ts) ·
  [tree controller](../../apps/ui/src/features/inspector/ui/FileTreeSidebar.tsx) ·
  [row renderer](../../apps/ui/src/features/inspector/ui/FileTreeEntries.tsx)
- [Data tables](../../apps/ui/src/features/inspector/ui/table/TableGrid.tsx)
- [Usage requests log](../../apps/ui/src/features/stats/ui/LogsTable.tsx) ·
  [row renderer](../../apps/ui/src/features/stats/ui/LogRow.tsx)
- [Kanban column cap](../../mini-apps/kanban/ui/board/columnCap.ts) ·
  [board](../../mini-apps/kanban/ui/board/board.tsx) ·
  [drop index](../../mini-apps/kanban/ui/board/useKanbanDrag.ts)
- [Event journal retention cap](../../apps/ui/src/shared/lib/notifications/core.ts)
- [Live logs](../../mini-apps/devops/ui/LiveLogViewport.tsx)
- [External-agent history](../../apps/ui/src/features/external-agents/ui/ExternalHistoryList.tsx)
- [Changes-tree rows](../../mini-apps/git-workspace/ui/source-control/ui/changes-tree/changesTreeRows.ts)
  · [tree](../../mini-apps/git-workspace/ui/source-control/ui/changes-tree/ChangesTree.tsx) ·
  [shared scroll area](../../mini-apps/git-workspace/ui/source-control/ui/changes-tree/ChangesScrollArea.tsx)
- [Diff document](../../apps/ui/src/shared/ui/diff/document/diffDocument.ts) ·
  [row layout](../../apps/ui/src/shared/ui/diff/document/diffRows.ts) ·
  [pinned headers](../../apps/ui/src/shared/ui/diff/document/diffSticky.ts) ·
  [renderer](../../apps/ui/src/shared/ui/diff/VirtualDiff.tsx)
- [Warm-item visibility](../../packages/mini-app-sdk/src/ui/visibility.tsx)
- [Dependency versions](../../apps/ui/package.json) · [lockfile](../../bun.lock)
