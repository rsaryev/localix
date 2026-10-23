# Project Space

One spatial board per project: notes, shapes, frames and connectors beside live references to the
project's files, folders, code, images and documents, edited by the person and the agent. User
documentation is [docs/features/project-space.md](../../docs/features/project-space.md); this file
is for working on the mini app.

## Layout

| Path                | Answers                                                                                                                                                                      |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shared/format/`    | The board file: its schema, the reader that never throws or loses a record, the writer.                                                                                      |
| `shared/registry/`  | What an element TYPE is (`contract.ts`) and the registry every core question goes through.                                                                                   |
| `shared/types/`     | The element types' data halves — the one list a new type is added to.                                                                                                        |
| `shared/ops/`       | The operations every change is spoken in, applied pointwise, with the undo patch: create, update, delete, connect, edge, order, group, ungroup, align, distribute, arrange.  |
| `shared/agent/`     | The roster the agent reads.                                                                                                                                                  |
| `shared/graph/`     | The board read as a graph: what an element is called, which way a connector runs, neighbourhood and reach, and the one search rule the person and the agent share.           |
| `shared/content/`   | What pasted text becomes.                                                                                                                                                    |
| `shared/camera*.ts` | The agent's camera moves and what the tab reports back; where a request frames.                                                                                              |
| `backend/`          | The store (one board per project, atomic writes, per-actor undo), routes, the camera hub, and the agent tools `space_read`, `space_apply`, `space_view`.                     |
| `ui/elements/`      | The element types' view halves — the second list a new type is added to.                                                                                                     |
| `ui/board/`         | The editable board on `@localixai/kit/canvas`: nodes, selection and groups, live drags and snapping, keys, the selection bar, the layers panel.                              |
| `ui/board/` reading | Over the drawing: connections and traces (`useReading.ts`), depth by zoom, find, the shortcuts sheet (`shortcuts.ts`), the right-click menu, copy as image, the live region. |
| `ui/camera/`        | Where the camera goes and how: one framing policy, flights, history, following the focus and the agent's changes, the agent's `space_view`.                                  |
| `ui/content/`       | Drops and pastes as operations; copy and paste of elements; conversion of app links into file, code, or host-rendered app-link cards.                                        |

Nested controls keep their double-clicks and keys (`ui/board/interaction.ts`); camera focus is
captured before a control can stop its click from bubbling. The transparent multi-selection
rectangle passes pointer events through to the cards, which still drag a selection together. The
shared Canvas uses matching five-pixel drag and click tolerances to absorb small pointer movements
without losing the click. `ui/content/links.ts` converts app links into file, code, or app-link
cards.

Chat fragment actions and the board share `ui/spaceUpdates.ts`: saved answers publish immediately,
writes are ordered, and stale reads cannot overwrite them. One socket subscription per watched chat
follows changes to its project after HTTP advertises `liveUpdates`, and the host's workspace watcher
carries hand edits of the board file (`ui/spaceStream.ts`). Ten-second reconciliation runs only
while either signal is not live — an older backend, a dropped socket, an unwatched chat
(`ui/spaceUpdates.dom.test.ts`).

The optional `ActionContribution.subscribe` seam lets the mini app update action visibility without
teaching the host about boards. Fragment ids are content-derived, so concurrent adds converge and
deletion allows the same fragment to be added again. `ui/useSpace.dom.test.tsx` and
`ui/content-action.test.ts` exercise this chain. Backend shutdown releases existing listeners, and a
resubscription after reload replaces the old socket handle through the SDK's generic stream
registry.

## Add an element type

1. A spec in `shared/types/` (props schema, size, `text`, optional `claims` for the files or URLs it
   takes) added to `ELEMENT_TYPES`.
2. A view in `ui/elements/` (content only; the node draws selection, resizing and connectors) added
   to `ELEMENT_VIEWS`. `elements.test.ts` fails until both lists name the type.
3. Changing a type's props later means bumping its `version` and adding one migration. A new
   optional prop with a default needs neither: an older board reads as it drew, and an older build
   carries the prop through.

A type can say more, all as data the core reads without learning its name:

| Field                         | Where | Does                                                                                          |
| ----------------------------- | ----- | --------------------------------------------------------------------------------------------- |
| `fromText`, `text`, `measure` | spec  | Written and read as text (Mermaid for `sequence`, `flow`, `quadrant`), sized by its content.  |
| `exactText`                   | spec  | `fromText` refuses what it cannot keep, so a whole pasted Mermaid block may become the type.  |
| `summary`                     | spec  | What a person reads in a list (no `**` marks, no Mermaid); `text` stays what the agent reads. |
| `controls` (`group: 'text'`)  | view  | Bar pickers; the text group gathers into the one **Text** menu.                               |
| `actions`                     | view  | Operations offered on the bar and the right-click menu (Convert to shapes, Draw natively).    |
| `insert.variants`             | view  | Rail variants that are not the element's own values (the pen's eraser).                       |

Text styles (`font`, `align`, `valign`, `ink`) are `shared/types/text-style.ts`; light marks in
notes and labels are read by `shared/content/rich-text.ts` and typed by `rich-edit.ts`.

Nothing else changes: the agent's tool descriptions, the tool rail and the drop pipeline read the
registry.

## Rules this mini app keeps

- **The file is the truth.** Every change re-reads it and writes it whole, atomically; an unreadable
  file refuses writes instead of being replaced by an empty board.
- **Preserve unrecognized records.** On a writable board, unknown types, newer props, undrawable
  records, and unknown keys are carried through serialization. An invalid whole-file envelope
  refuses writes.
- **References, not copies.** A path stays a path, project-relative inside the project; only content
  without a path (a pasted screenshot) is kept in `.localix/project-space/files/`.
- **Membership is geometry.** A frame holds what is inside it; nothing stores a parent. A group is
  only the id its members list (innermost first); a group of one is no group.
- **The camera is the person's, not the file's.** Moving it — the person's hand, a focus, the
  agent's `space_view` — writes nothing and has no undo; it has its own history (⌥← / ⌥→).
- **One framing policy.** Every deliberate move frames by `ui/camera/framing.ts`, whoever asked.
- **A link is the app's link.** Anything the chat can link lands as that link
  (`shared/types/app-links.ts`), read by the host's grammar (`@localixai/kit/context-links`) and
  drawn by the host (`ContextBindingPreview`); the board never re-implements a session or a tool
  call card.
- **Reading never writes.** A trace, the depth by zoom and a search change what is shown, never the
  file; they follow drawn connectors only, by the arrowheads the person sees
  (`shared/graph/links.ts`), the same arrows the agent's roster prints.
- **One list of keys.** A binding is added to `ui/board/shortcuts.ts` and answered in
  `boardKeys.ts`; `shortcuts.test.ts` fails when a row of the sheet does nothing.

## Storage and operation boundaries

The board lives at `.localix/project-space/space.json`; pasted file content lives beside it under
`files/`. Paths inside the project are stored project-relative; references outside it stay absolute.
A file route can read a path inside the project or one covered by an explicit board reference.
Containment checks are lexical, not a filesystem sandbox.

| Tool          | Effect and boundary                                                               |
| ------------- | --------------------------------------------------------------------------------- |
| `space_read`  | `read`: inspect the roster; linked files are named rather than rewritten.         |
| `space_apply` | `files`: writes the declared board file; referenced source files are not changed. |
| `space_view`  | `view`: moves the camera or reads the visible report without saving board layout. |

A batch applies operations individually: a refused operation appears in the results, while
successful operations still commit. Inspect each result before reporting the entire batch as
successful.

Undo and redo belong to the actor (`user` or `agent`). The backend retains at most 100 undo patches
per actor in memory; a runtime restart clears that history. Undo preserves records changed since the
patch and reports conflicts instead of overwriting those changes.

## Checks

```bash
bun test mini-apps/project-space
bun run --cwd mini-apps/project-space type-check
```

## Source of truth

- [Mini app manifest](mini-app.json) and [agent guide](guide.md)
- [Ordered file storage and actor history](backend/space-store.ts)
- [Path normalization and file-route access](backend/paths.ts)
- [File envelope and record preservation](shared/format/parse.ts)
- [Serialization](shared/format/serialize.ts)
- [Operation application](shared/ops/apply.ts)
- [Read/write tool classification](backend/tools.ts)
- [Camera tool classification](backend/view-tool.ts)
- [Shared UI snapshot ownership](ui/spaceUpdates.ts)
- [Stream and file-watcher health](ui/spaceStream.ts)
