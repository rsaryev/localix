# Project Space

One spatial board per project: notes, shapes, frames and connectors beside live references to the
project's files, folders, code, images and documents, edited by the person and the agent. User
documentation is [docs/features/project-space.md](../../docs/features/project-space.md); this file
is for working on the plugin.

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
(`ui/spaceUpdates.dom.test.ts`). The optional `ActionContribution.subscribe` seam lets the plugin
update action visibility without teaching the host about boards. Fragment ids are content-derived,
so concurrent adds converge and deletion allows the same fragment to be added again.
`ui/useSpace.dom.test.tsx` and `ui/content-action.test.ts` exercise this chain. Backend shutdown
releases existing listeners, and a resubscription after reload replaces the old socket handle
through the SDK's generic stream registry.

## Add an element type

1. A spec in `shared/types/` (props schema, size, `text`, optional `claims` for the files or URLs it
   takes) added to `ELEMENT_TYPES`.
2. A view in `ui/elements/` (content only; the node draws selection, resizing and connectors) added
   to `ELEMENT_VIEWS`. `elements.test.ts` fails until both lists name the type.
3. Changing a type's props later means bumping its `version` and adding one migration.

Nothing else changes: the agent's tool descriptions, the tool rail and the drop pipeline read the
registry.

## Rules this plugin keeps

- **The file is the truth.** Every change re-reads it and writes it whole, atomically; an unreadable
  file refuses writes instead of being replaced by an empty board.
- **Nothing is lost.** An unknown type, a newer build's props, an undrawable record and unknown keys
  are carried through a write unchanged.
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

## Checks

```bash
bun test plugins/project-space
bun run --cwd plugins/project-space type-check
```
